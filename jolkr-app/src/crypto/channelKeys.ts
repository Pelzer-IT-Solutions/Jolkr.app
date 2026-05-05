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
import { useMessagesStore } from '../stores/messages';
import { wsClient } from '../api/ws';
import { log } from '../utils/log';

/** Create a clean ArrayBuffer copy (TS strict ArrayBufferLike compat). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

// ── In-memory channel key cache ────────────────────────────────────

interface CachedChannelKey {
  key: CryptoKey;
  keyGeneration: number;
  rawKey: Uint8Array;
}

const channelKeyCache = new Map<string, CachedChannelKey>();

// ── Public API ─────────────────────────────────────────────────────

/** Sentinel: a key exists on the server but we couldn't decrypt it. */
export class ChannelKeyDecryptError extends Error {
  constructor(channelId: string, cause?: unknown) {
    super(`Channel key for ${channelId} exists but could not be decrypted`);
    this.name = 'ChannelKeyDecryptError';
    this.cause = cause;
  }
}

/**
 * Get the channel encryption key, fetching from server if not cached.
 * Returns null if no key has been distributed yet.
 * Throws ChannelKeyDecryptError if a key exists but can't be decrypted
 * (prevents accidental re-keying that would destroy old messages).
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
  const serverKey = await api.getMyChannelKey(channelId, isDm);
  if (!serverKey) return null; // No key distributed yet

  // Key exists — attempt decrypt. Let errors propagate so callers
  // know the key exists but is undecryptable (don't silently overwrite).
  try {
    const rawKeyB64 = await decryptFromSender(localKeys, serverKey.encrypted_key, serverKey.nonce);
    const rawKeyBytes = fromBase64(rawKeyB64);

    const key = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(rawKeyBytes),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );

    const entry: CachedChannelKey = { key, keyGeneration: serverKey.key_generation, rawKey: rawKeyBytes };
    channelKeyCache.set(channelId, entry);
    return entry;
  } catch (e) {
    log.warn('channel-e2ee', 'key exists but decrypt failed for channel', channelId, e);
    throw new ChannelKeyDecryptError(channelId, e);
  }
}

export async function redistributeChannelKey(
  channelId: string,
  memberUserIds: string[],
  rawKeyBytes: Uint8Array,
  keyGeneration: number,
  isDm?: boolean,
): Promise<void> {
  if (!isE2EEReady()) return;
  if (memberUserIds.length === 0) return;

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
      log.warn('channel-e2ee', 'failed to re-wrap key for member', userId);
    }
  }

  if (recipients.length === 0) return;

  try {
    await api.distributeChannelKeys(channelId, { key_generation: keyGeneration, recipients }, isDm);
  } catch (e) {
    log.warn('channel-e2ee', 'failed to re-distribute channel keys:', e);
  }
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
      log.warn('channel-e2ee', 'failed to encrypt key for member', userId);
    }
  }

  if (recipients.length === 0) {
    log.warn('channel-e2ee', 'no recipients could receive the key');
    return null;
  }

  // Upload to server
  try {
    await api.distributeChannelKeys(channelId, {
      key_generation: keyGeneration,
      recipients,
    }, isDm);
  } catch (e) {
    log.warn('channel-e2ee', 'failed to upload channel keys:', e);
    return null;
  }

  // Import as CryptoKey for local use
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawKeyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );

  const entry: CachedChannelKey = { key, keyGeneration, rawKey: rawKeyBytes };
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
  let channelKey: CachedChannelKey | null = null;

  try {
    channelKey = await getChannelKey(channelId, localKeys, isDm);
  } catch (e) {
    if (e instanceof ChannelKeyDecryptError) {
      // A key exists on the server but we can't decrypt it.
      // Don't generate a new key — that would overwrite the existing one
      // and make old messages permanently undecryptable.
      log.error('channel-e2ee', 'cannot send — existing key undecryptable; re-login may fix this');
      return null;
    }
    throw e;
  }

  if (!channelKey) {
    if (isDm) {
      const dmMsgs = useMessagesStore.getState().messages[channelId] ?? [];
      const hasHistory = dmMsgs.some(m => !!m.nonce);
      if (hasHistory) {
        wsClient.requestKeyRedistribute(channelId);
        log.error('channel-e2ee', 'cannot send DM — wrap missing; requested redistribute from counterparty');
        return null;
      }
      const memberIds = await getMemberIds();
      channelKey = await generateAndDistributeChannelKey(channelId, memberIds, 0, isDm);
      if (!channelKey) return null;
    } else {
      let generation = 0;
      try {
        const genResp = await api.getChannelKeyGeneration(channelId);
        generation = genResp.key_generation;
      } catch { /* Fallback to 0 */ }
      const memberIds = await getMemberIds();
      channelKey = await generateAndDistributeChannelKey(channelId, memberIds, generation, isDm);
      if (!channelKey) return null;
    }
  }

  const { ciphertext, nonce } = await encryptMessage(channelKey.key, plaintext);

  if (isDm) {
    const memberIds = await getMemberIds();
    redistributeChannelKey(channelId, memberIds, channelKey.rawKey, channelKey.keyGeneration, isDm)
      .catch(() => { /* best-effort heal of missing wraps */ });
  }

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
