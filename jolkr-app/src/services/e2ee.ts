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

// ── State ──────────────────────────────────────────────────────────

let localKeys: LocalKeySet | null = null;

/** Cache TTL: 5 minutes. Stale bundles cause undecryptable messages. */
const BUNDLE_CACHE_TTL = 5 * 60 * 1000;
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
    // Derive deterministic keys from password seed — identical across all devices
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
  // Check cache with TTL
  const cached = bundleCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < BUNDLE_CACHE_TTL) {
    return cached.bundle;
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
  // Clear upload flag and device ID so next login re-generates fresh keys
  await storage.remove('e2ee_keys_uploaded');
  await storage.remove('jolkr_e2ee_device_id');
}
