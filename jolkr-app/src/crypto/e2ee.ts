import { x25519 } from '@noble/curves/ed25519.js';
import type { LocalKeySet, PreKeyBundle } from './keys';
import {
  verifySignedPreKey,
  x25519KeyAgreement,
  deriveMessageKey,
  encryptMessage,
  decryptMessage,
  toBase64,
  fromBase64,
  generateIdentityKeyPair,
  generateSignedPreKey,
} from './keys';

// ── Encrypt ────────────────────────────────────────────────────────

export interface EncryptedPayload {
  encryptedContent: string; // base64(ephemeral_pub(32) || ciphertext)
  nonce: string;            // base64(12-byte nonce)
}

/**
 * Encrypt a plaintext message for a recipient using their prekey bundle.
 * Uses ephemeral X25519 keys for forward secrecy per message.
 */
export async function encryptForRecipient(
  bundle: PreKeyBundle,
  plaintext: string,
): Promise<EncryptedPayload | null> {
  // Verify the signed prekey signature
  if (!verifySignedPreKey(bundle.identityKey, bundle.signedPrekey, bundle.signedPrekeySignature)) {
    console.warn('E2EE: Invalid signed prekey signature for', bundle.userId);
    return null;
  }

  // Generate fresh ephemeral X25519 keypair
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // X25519 DH: ephemeral_priv × recipient_signed_prekey_pub
  const shared = x25519KeyAgreement(ephemeralPriv, bundle.signedPrekey);

  // Derive AES-256-GCM key
  const messageKey = await deriveMessageKey(shared);

  // Encrypt
  const { ciphertext, nonce } = await encryptMessage(messageKey, plaintext);

  // Pack: ephemeral_pub(32) || ciphertext
  const packed = new Uint8Array(32 + ciphertext.length);
  packed.set(ephemeralPub);
  packed.set(ciphertext, 32);

  return {
    encryptedContent: toBase64(packed),
    nonce: toBase64(nonce),
  };
}

// ── Decrypt ────────────────────────────────────────────────────────

/**
 * Decrypt an incoming encrypted message using our signed prekey private key.
 */
export async function decryptFromSender(
  localKeys: LocalKeySet,
  encryptedContentB64: string,
  nonceB64: string,
): Promise<string> {
  const packed = fromBase64(encryptedContentB64);
  const nonce = fromBase64(nonceB64);

  // 32 bytes ephemeral pub + at least 16 bytes AES-GCM auth tag = 48 minimum
  if (packed.length < 48) {
    throw new Error('Invalid encrypted content: too short');
  }

  // Unpack: ephemeral_pub(32) || ciphertext
  const ephemeralPub = packed.slice(0, 32);
  const ciphertext = packed.slice(32);

  // X25519 DH: my_signed_prekey_priv × ephemeral_pub
  const shared = x25519KeyAgreement(localKeys.signedPreKey.keyPair.privateKey, ephemeralPub);

  // Derive AES-256-GCM key
  const messageKey = await deriveMessageKey(shared);

  // Decrypt
  return decryptMessage(messageKey, ciphertext, nonce);
}

// ── Key generation ─────────────────────────────────────────────────

/**
 * Generate a complete local key set: Ed25519 identity + X25519 signed prekey.
 */
export function generateKeySet(): LocalKeySet {
  const identity = generateIdentityKeyPair();
  const signedPreKey = generateSignedPreKey(identity.privateKey);
  return { identity, signedPreKey };
}
