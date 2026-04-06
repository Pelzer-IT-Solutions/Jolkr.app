import type { LocalKeySet, PreKeyBundle, EncryptedPayload } from '../crypto';
import {
  generateKeySetFromSeed,
  encryptForRecipient,
  decryptFromSender,
  toBase64,
  fromBase64,
} from '../crypto';
import { saveKeySet, loadKeySet, clearKeySet } from '../crypto/keyStore';
import { storage } from '../platform/storage';
import * as api from '../api/client';
import type { PreKeyBundleResponse } from '../api/types';

// ── Storage encryption ────────────────────────────────────────────

const STORAGE_KEY_SESSION = 'jolkr_storage_enc_key';

/** Derive storage encryption key from E2EE seed and store in sessionStorage. */
async function deriveAndStoreStorageKey(seed: Uint8Array): Promise<void> {
  const buf = seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength) as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey('raw', buf, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('jolkr-storage-key') },
    keyMaterial, 256,
  );
  const raw = new Uint8Array(bits);
  let b64 = '';
  for (let i = 0; i < raw.length; i++) b64 += String.fromCharCode(raw[i]);
  sessionStorage.setItem(STORAGE_KEY_SESSION, btoa(b64));
}

// ── State ──────────────────────────────────────────────────────────

let localKeys: LocalKeySet | null = null;

/** Cache TTL for successful bundles: 5 minutes. */
const BUNDLE_CACHE_TTL = 5 * 60 * 1000;
/** Cache TTL for failed/null bundles: 10 seconds (recipient may log in soon). */
const BUNDLE_NULL_CACHE_TTL = 10 * 1000;
interface CachedBundle { bundle: PreKeyBundle | null; fetchedAt: number; }
const bundleCache = new Map<string, CachedBundle>();

// ── Public API ─────────────────────────────────────────────────────

/**
 * Initialize E2EE: load keys from storage, or generate from seed if provided.
 * When seed is provided (login/register), deterministic keys are generated so
 * all devices of the same user share the same keypair.
 */
export async function initE2EE(deviceId: string, seed?: Uint8Array): Promise<void> {
  if (seed) {
    // Derive storage encryption key from seed and persist in sessionStorage
    // This protects private keys in localStorage at rest (cleared on tab close)
    await deriveAndStoreStorageKey(seed);

    // Derive deterministic keys from password seed using HKDF
    const keys = await generateKeySetFromSeed(seed);
    localKeys = keys;
    await saveKeySet(keys);
    // Force re-upload (keys may differ from what's on server)
    await storage.remove('e2ee_keys_uploaded');
    await ensureKeysUploaded(deviceId, keys);
    return;
  }

  // No seed — just load existing keys from storage
  const existing = await loadKeySet();
  if (existing) {
    localKeys = existing;
    await ensureKeysUploaded(deviceId, existing);
    return;
  }

  // No seed and no stored keys — E2EE unavailable until next login
}

/** Upload prekeys to server if not yet confirmed uploaded. */
async function ensureKeysUploaded(deviceId: string, keys: LocalKeySet): Promise<void> {
  const uploadedKey = 'e2ee_keys_uploaded';
  const alreadyUploaded = await storage.get(uploadedKey);
  if (alreadyUploaded === 'true') return;

  try {
    // Ensure device exists in DB before uploading keys (FK constraint on user_keys.device_id)
    await api.registerDevice({
      device_id: deviceId,
      device_name: 'E2EE Keys',
      device_type: 'e2ee',
    });

    await api.uploadPrekeys({
      device_id: deviceId,
      identity_key: toBase64(keys.identity.publicKey),
      signed_prekey: toBase64(keys.signedPreKey.keyPair.publicKey),
      signed_prekey_signature: toBase64(keys.signedPreKey.signature),
      one_time_prekeys: [],
      // Post-quantum keys
      pq_signed_prekey: keys.pqSignedPreKey ? toBase64(keys.pqSignedPreKey.keyPair.encapsulationKey) : undefined,
      pq_signed_prekey_signature: keys.pqSignedPreKey ? toBase64(keys.pqSignedPreKey.signature) : undefined,
    });
    await storage.set(uploadedKey, 'true');
  } catch (e) {
    console.warn('E2EE: Failed to upload prekeys (will retry next init):', e);
  }
}

/**
 * Check if E2EE keys are loaded and ready.
 */
export function isE2EEReady(): boolean {
  return localKeys !== null;
}

/**
 * Get the local key set (for channel encryption).
 */
export function getLocalKeys(): LocalKeySet | null {
  return localKeys;
}


/**
 * Fetch and cache a recipient's prekey bundle. Returns null if no keys available.
 */
export async function getRecipientBundle(userId: string): Promise<PreKeyBundle | null> {
  // Check cache with TTL (shorter TTL for null results so we retry quickly)
  const cached = bundleCache.get(userId);
  if (cached) {
    const ttl = cached.bundle ? BUNDLE_CACHE_TTL : BUNDLE_NULL_CACHE_TTL;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.bundle;
    }
  }

  try {
    const resp: PreKeyBundleResponse = await api.getPreKeyBundle(userId);
    const bundle: PreKeyBundle = {
      userId: resp.user_id,
      deviceId: resp.device_id,
      identityKey: fromBase64(resp.identity_key),
      signedPrekey: fromBase64(resp.signed_prekey),
      signedPrekeySignature: fromBase64(resp.signed_prekey_signature),
      oneTimePrekey: resp.one_time_prekey ? fromBase64(resp.one_time_prekey) : undefined,
      pqSignedPrekey: resp.pq_signed_prekey ? fromBase64(resp.pq_signed_prekey) : undefined,
      pqSignedPrekeySignature: resp.pq_signed_prekey_signature ? fromBase64(resp.pq_signed_prekey_signature) : undefined,
    };
    bundleCache.set(userId, { bundle, fetchedAt: Date.now() });
    return bundle;
  } catch {
    // Cache null result to prevent repeated 404 requests (browser still shows red 404 once)
    bundleCache.set(userId, { bundle: null, fetchedAt: Date.now() });
    return null;
  }
}

/**
 * Encrypt a DM message for a recipient. Returns null if E2EE unavailable.
 */
export async function encryptDmMessage(
  recipientUserId: string,
  plaintext: string,
): Promise<EncryptedPayload | null> {
  if (!localKeys) return null;

  const bundle = await getRecipientBundle(recipientUserId);
  if (!bundle) return null;

  return encryptForRecipient(bundle, plaintext);
}

/**
 * Decrypt an incoming encrypted DM message.
 */
export async function decryptDmMessage(
  encryptedContentB64: string,
  nonceB64: string,
): Promise<string> {
  if (!localKeys) {
    throw new Error('E2EE keys not loaded');
  }
  return decryptFromSender(localKeys, encryptedContentB64, nonceB64);
}

/** Invalidate a cached bundle so the next encryption fetches fresh keys. */
export function invalidateBundle(userId: string): void {
  bundleCache.delete(userId);
}

/**
 * Clear all E2EE state (keys + cache). Call on logout.
 */
export async function resetE2EE(): Promise<void> {
  localKeys = null;
  bundleCache.clear();
  await clearKeySet();
  // Clear upload flag so next login re-uploads keys; keep device ID to reuse the same device row
  await storage.remove('e2ee_keys_uploaded');
  localStorage.removeItem('e2ee_keys_uploaded');
}
