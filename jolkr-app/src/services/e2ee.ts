import { ed25519 } from '@noble/curves/ed25519.js';
import type { LocalKeySet, PreKeyBundle, EncryptedPayload } from '../crypto';
import {
  generateKeySetFromSeed,
  encryptForRecipient,
  decryptFromSender,
  toBase64,
  fromBase64,
} from '../crypto';
import { clearKeySet } from '../crypto/keyStore';
import { storage } from '../platform/storage';
import * as api from '../api/client';
import type { PreKeyBundleResponse } from '../api/types';
import { log } from '../utils/log';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { createTtlCache } from '../utils/cache';

// ── Seed storage ─────────────────────────────────────────────────
// Goes through `storage` so on Tauri desktop the seed lives in the
// Stronghold encrypted vault, not plain localStorage.

const SEED_KEY = STORAGE_KEYS.E2EE_SEED;
/** Legacy plain-localStorage key used before this seed moved to Stronghold. */
const LEGACY_SEED_KEY = STORAGE_KEYS.E2EE_SEED_LEGACY;

async function storeSeed(seed: Uint8Array): Promise<void> {
  await storage.set(SEED_KEY, toBase64(seed));
}

async function loadSeed(): Promise<Uint8Array | null> {
  const b64 = await storage.get(SEED_KEY);
  if (b64) {
    try { return fromBase64(b64); } catch { return null; }
  }
  // One-time migration from old plain-localStorage location.
  const legacy = localStorage.getItem(LEGACY_SEED_KEY);
  if (legacy) {
    try {
      const seed = fromBase64(legacy);
      await storage.set(SEED_KEY, legacy);
      localStorage.removeItem(LEGACY_SEED_KEY);
      return seed;
    } catch {
      localStorage.removeItem(LEGACY_SEED_KEY);
      return null;
    }
  }
  return null;
}

// ── State ──────────────────────────────────────────────────────────

let localKeys: LocalKeySet | null = null;

/** Cache TTL for successful bundles: 5 minutes. Failed/null bundles use 10s
 *  so recipients who log in shortly after a failure are picked up quickly. */
const bundleCache = createTtlCache<string, PreKeyBundle | null>({
  ttl: 5 * 60 * 1000,
  nullTtl: 10 * 1000,
});

// ── Public API ─────────────────────────────────────────────────────

/**
 * Initialize E2EE: derive keys on-the-fly from seed.
 *
 * - Login/register: seed is provided → stored in localStorage, keys derived in memory.
 * - Page reload: seed loaded from localStorage → keys derived in memory.
 *
 * Private keys never touch disk — only the 32-byte seed is persisted.
 */
export async function initE2EE(deviceId: string, seed?: Uint8Array): Promise<void> {
  // Use provided seed (login) or load from secure storage (page reload)
  const activeSeed = seed ?? await loadSeed();
  if (!activeSeed) return; // No seed available — E2EE unavailable until next login

  if (seed) {
    // Fresh login — persist seed and force re-upload of public keys
    await storeSeed(seed);
    await storage.remove('e2ee_keys_uploaded');
  }

  // Derive keys on-the-fly (never stored)
  const keys = await generateKeySetFromSeed(activeSeed);
  localKeys = keys;

  // Clean up legacy encrypted key entries from localStorage (one-time migration)
  cleanupLegacyKeys();

  await ensureKeysUploaded(deviceId, keys);
}

/** Remove old per-key entries + storage encryption key from previous versions. */
function cleanupLegacyKeys(): void {
  const legacyKeys = [
    'e2ee_identity_pub', 'e2ee_identity_priv',
    'e2ee_signed_prekey_pub', 'e2ee_signed_prekey_priv', 'e2ee_signed_prekey_sig',
    'e2ee_pq_encapsulation_key', 'e2ee_pq_decapsulation_key', 'e2ee_pq_signature',
    'jolkr_storage_enc_key',
  ];
  for (const key of legacyKeys) {
    localStorage.removeItem(key);
  }
  // Also remove from sessionStorage (older versions stored enc key there)
  sessionStorage.removeItem('jolkr_storage_enc_key');
}

/** Upload prekeys to server. Backend is idempotent (ON CONFLICT DO UPDATE),
 *  so we run on every init — that way a stale `e2ee_keys_uploaded` flag
 *  pointing at a server row that was wiped (account migration, manual DB
 *  cleanup) self-heals on the next app start instead of leaving the user
 *  silently locked out of SEC-013 sig-check. */
async function ensureKeysUploaded(deviceId: string, keys: LocalKeySet): Promise<void> {
  const uploadedKey = 'e2ee_keys_uploaded';
  try {
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
      pq_signed_prekey: keys.pqSignedPreKey ? toBase64(keys.pqSignedPreKey.keyPair.encapsulationKey) : undefined,
      pq_signed_prekey_signature: keys.pqSignedPreKey ? toBase64(keys.pqSignedPreKey.signature) : undefined,
    });
    await storage.set(uploadedKey, 'true');
  } catch {
    log.warn('e2ee', 'prekey upload deferred to next init');
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
 * Sign a byte buffer with the local identity ed25519 private key. Used by
 * the WS handshake (SEC-013) to prove possession of the device identity
 * key when answering the server-issued Hello challenge. Returns `null`
 * when E2EE isn't initialised yet — callers must fall back to legacy
 * bearer-only Identify (until JOLKR_WS_REQUIRE_SIG flips to true).
 */
export function signWithIdentity(message: Uint8Array): Uint8Array | null {
  if (!localKeys) return null;
  return ed25519.sign(message, localKeys.identity.privateKey);
}


/**
 * Fetch and cache a recipient's prekey bundle. Returns null if no keys available.
 */
export async function getRecipientBundle(userId: string): Promise<PreKeyBundle | null> {
  // TTL handled by the cache (shorter for null results so we retry quickly).
  // `has()` distinguishes "fresh null cached" from "miss".
  if (bundleCache.has(userId)) {
    const cached = bundleCache.get(userId);
    return cached === undefined ? null : cached;
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
    bundleCache.set(userId, bundle);
    return bundle;
  } catch {
    // Cache null result to prevent repeated 404 requests (browser still shows red 404 once)
    bundleCache.set(userId, null);
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
  // Remove seed from secure storage — keys can no longer be derived
  await storage.remove(SEED_KEY);
  // Belt-and-braces: also clear any legacy plain-localStorage seed
  localStorage.removeItem(LEGACY_SEED_KEY);
  // Clean up any other legacy key entries
  cleanupLegacyKeys();
  // Legacy: clear old keyStore entries via storage abstraction (Stronghold on desktop)
  await clearKeySet();
  // Clear upload flag so next login re-uploads keys; keep device ID to reuse the same device row.
  await storage.remove('e2ee_keys_uploaded');
}
