/**
 * Channel/Group E2EE — Shared Key management.
 *
 * Each channel (or group DM) has a symmetric AES-256-GCM key shared by all members.
 * The key is distributed to each member by encrypting it with their prekey bundle
 * (hybrid X25519 + ML-KEM-768), the same as DM E2EE.
 *
 * Used for:
 * - Server channel messages (Phase 2)
 * - Group DM messages (Phase 4)
 */

import * as api from '../api/client';
import { encryptForRecipient, decryptFromSender } from './e2ee';
import { encryptMessage, decryptMessage, toBase64, fromBase64 } from './keys';
import type { LocalKeySet } from './keys';
import { getRecipientBundle, isE2EEReady } from '../services/e2ee';

/** Create a clean ArrayBuffer copy (TS strict ArrayBufferLike compat). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

// ── In-memory channel key cache ────────────────────────────────────

interface CachedChannelKey {
  key: CryptoKey;
  keyGeneration: number;
}

const channelKeyCache = new Map<string, CachedChannelKey>();

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get the channel encryption key, fetching/generating as needed.
 * Returns null if E2EE is not available.
 */
export async function getChannelKey(
  channelId: string,
  localKeys: LocalKeySet,
  isDm?: boolean,
): Promise<CachedChannelKey | null> {
  // Check cache
  const cached = channelKeyCache.get(channelId);
  if (cached) return cached;

  // Try to fetch from server
  try {
    const serverKey = await api.getMyChannelKey(channelId, isDm);
    if (serverKey) {
      // Decrypt the channel key using our local keys
      const rawKeyB64 = await decryptFromSender(localKeys, serverKey.encrypted_key, serverKey.nonce);
      const rawKeyBytes = fromBase64(rawKeyB64);

      const key = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(rawKeyBytes),
        { name: 'AES-GCM' },
        true,
        ['encrypt', 'decrypt'],
      );

      const entry: CachedChannelKey = { key, keyGeneration: serverKey.key_generation };
      channelKeyCache.set(channelId, entry);
      return entry;
    }
  } catch {
    // No key on server or decrypt failed
  }

  return null;
}

/**
 * Generate a new random channel key and distribute to members.
 * @param channelId - The channel or DM channel ID
 * @param memberUserIds - User IDs to distribute the key to
 * @param keyGeneration - Key generation counter
 */
export async function generateAndDistributeChannelKey(
  channelId: string,
  memberUserIds: string[],
  keyGeneration: number,
  isDm?: boolean,
): Promise<CachedChannelKey | null> {
  if (!isE2EEReady()) return null;
  if (memberUserIds.length === 0) return null;

  // Generate random 256-bit key
  const rawKeyBytes = crypto.getRandomValues(new Uint8Array(32));

  // Encrypt the channel key for each member
  const recipients: Array<{ user_id: string; encrypted_key: string; nonce: string }> = [];
  const rawKeyB64 = toBase64(rawKeyBytes);

  for (const userId of memberUserIds) {
    try {
      const bundle = await getRecipientBundle(userId);
      if (!bundle) continue;

      const encrypted = await encryptForRecipient(bundle, rawKeyB64);
      if (!encrypted) continue;

      recipients.push({
        user_id: userId,
        encrypted_key: encrypted.encryptedContent,
        nonce: encrypted.nonce,
      });
    } catch {
      console.warn(`Channel E2EE: Failed to encrypt key for member ${userId}`);
    }
  }

  if (recipients.length === 0) {
    console.warn('Channel E2EE: No recipients could receive the key');
    return null;
  }

  // Upload to server
  try {
    await api.distributeChannelKeys(channelId, {
      key_generation: keyGeneration,
      recipients,
    }, isDm);
  } catch (e) {
    console.warn('Channel E2EE: Failed to upload channel keys:', e);
    return null;
  }

  // Import as CryptoKey for local use
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawKeyBytes),
    { name: 'AES-GCM' },
    true,
    ['encrypt', 'decrypt'],
  );

  const entry: CachedChannelKey = { key, keyGeneration };
  channelKeyCache.set(channelId, entry);
  return entry;
}

/**
 * Encrypt a channel message using the channel's shared key.
 * For server channels: fetches members via server API.
 * For group DMs: pass memberUserIds directly.
 */
export async function encryptChannelMessage(
  channelId: string,
  localKeys: LocalKeySet,
  plaintext: string,
  getMemberIds: () => Promise<string[]>,
  isDm?: boolean,
): Promise<{ encryptedContent: string; nonce: string } | null> {
  // Get or generate channel key
  let channelKey = await getChannelKey(channelId, localKeys, isDm);

  if (!channelKey) {
    // No key exists yet — we generate and distribute
    const memberIds = await getMemberIds();
    channelKey = await generateAndDistributeChannelKey(channelId, memberIds, 0, isDm);
    if (!channelKey) return null;
  }

  const { ciphertext, nonce } = await encryptMessage(channelKey.key, plaintext);

  return {
    encryptedContent: toBase64(ciphertext),
    nonce: toBase64(nonce),
  };
}

/**
 * Decrypt a channel message using the channel's shared key.
 */
export async function decryptChannelMessage(
  channelId: string,
  localKeys: LocalKeySet,
  encryptedContentB64: string,
  nonceB64: string,
  isDm?: boolean,
): Promise<string> {
  const channelKey = await getChannelKey(channelId, localKeys, isDm);
  if (!channelKey) {
    throw new Error('Channel key not available');
  }

  const ciphertext = fromBase64(encryptedContentB64);
  const nonce = fromBase64(nonceB64);

  return decryptMessage(channelKey.key, ciphertext, nonce);
}

/**
 * Invalidate a channel's cached key (on rekey event).
 */
export function invalidateChannelKey(channelId: string): void {
  channelKeyCache.delete(channelId);
}

/**
 * Clear all cached channel keys (on logout).
 */
export function clearAllChannelKeys(): void {
  channelKeyCache.clear();
}
