import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import type { LocalKeySet, PreKeyBundle } from './keys';
import {
  verifySignedPreKey,
  verifyPQSignedPreKey,
  x25519KeyAgreement,
  mlkemEncapsulate,
  mlkemDecapsulate,
  deriveMessageKey,
  deriveHybridMessageKey,
  deriveMessageKeyLegacy,
  deriveHybridMessageKeyLegacy,
  encryptMessage,
  decryptMessage,
  toBase64,
  fromBase64,
  generateIdentityKeyPair,
  generateSignedPreKey,
  generatePQSignedPreKey,
} from './keys';

// ── Encrypt ────────────────────────────────────────────────────────

export interface EncryptedPayload {
  encryptedContent: string; // base64(version(1) || ephemeral_pub(32) || [pq_ciphertext] || ciphertext)
  nonce: string;            // base64(12-byte nonce)
}

// Version bytes for encrypted payload format
const VERSION_CLASSICAL = 0x01;       // Legacy: SHA-256 KDF, X25519 only
const VERSION_HYBRID_PQ = 0x02;       // Legacy: SHA-256 KDF, X25519 + ML-KEM-768
const VERSION_HYBRID_PQ_HKDF = 0x03;  // Current: HKDF-SHA256, X25519 + ML-KEM-768

// ML-KEM-768 ciphertext is 1088 bytes
const MLKEM768_CIPHERTEXT_SIZE = 1088;

/**
 * Encrypt a plaintext message for a recipient using their prekey bundle.
 * Uses hybrid X25519 + ML-KEM-768 when PQ keys are available (quantum-proof).
 * Falls back to classical X25519-only for recipients without PQ keys.
 */
export async function encryptForRecipient(
  bundle: PreKeyBundle,
  plaintext: string,
): Promise<EncryptedPayload | null> {
  // Verify the classical signed prekey signature
  if (!verifySignedPreKey(bundle.identityKey, bundle.signedPrekey, bundle.signedPrekeySignature)) {
    console.warn('E2EE: Invalid signed prekey signature for', bundle.userId);
    return null;
  }

  // Generate fresh ephemeral X25519 keypair
  const ephemeralPriv = x25519.utils.randomSecretKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);

  // X25519 DH: ephemeral_priv × recipient_signed_prekey_pub
  const classicalShared = x25519KeyAgreement(ephemeralPriv, bundle.signedPrekey);

  // Check if recipient has PQ keys for hybrid encryption
  const hasPQ = bundle.pqSignedPrekey && bundle.pqSignedPrekeySignature;

  if (hasPQ) {
    // Verify PQ signed prekey signature
    if (!verifyPQSignedPreKey(bundle.identityKey, bundle.pqSignedPrekey!, bundle.pqSignedPrekeySignature!)) {
      console.warn('E2EE: Invalid PQ signed prekey signature for', bundle.userId, '— falling back to classical');
    } else {
      // ML-KEM-768 encapsulation
      const { ciphertext: pqCiphertext, sharedSecret: pqShared } = mlkemEncapsulate(bundle.pqSignedPrekey!);

      // Derive hybrid key from both secrets using HKDF-SHA256
      const messageKey = await deriveHybridMessageKey(classicalShared, pqShared);
      const { ciphertext, nonce } = await encryptMessage(messageKey, plaintext);

      // Pack: version(1) || ephemeral_pub(32) || pq_ciphertext(1088) || ciphertext
      const packed = new Uint8Array(1 + 32 + pqCiphertext.length + ciphertext.length);
      packed[0] = VERSION_HYBRID_PQ_HKDF;
      packed.set(ephemeralPub, 1);
      packed.set(pqCiphertext, 33);
      packed.set(ciphertext, 33 + pqCiphertext.length);

      return {
        encryptedContent: toBase64(packed),
        nonce: toBase64(nonce),
      };
    }
  }

  // Classical-only fallback
  const messageKey = await deriveMessageKey(classicalShared);
  const { ciphertext, nonce } = await encryptMessage(messageKey, plaintext);

  // Pack: version(1) || ephemeral_pub(32) || ciphertext
  const packed = new Uint8Array(1 + 32 + ciphertext.length);
  packed[0] = VERSION_CLASSICAL;
  packed.set(ephemeralPub, 1);
  packed.set(ciphertext, 33);

  return {
    encryptedContent: toBase64(packed),
    nonce: toBase64(nonce),
  };
}

// ── Decrypt ────────────────────────────────────────────────────────

/**
 * Decrypt an incoming encrypted message using our signed prekey private key.
 * Supports versioned formats:
 *   0x03 — HKDF-SHA256, hybrid X25519 + ML-KEM-768 (current)
 *   0x02 — Legacy SHA-256 KDF, hybrid X25519 + ML-KEM-768
 *   0x01 — Legacy SHA-256 KDF, classical X25519 only
 *   other — Legacy unversioned format (pre-v0.3.0)
 */
export async function decryptFromSender(
  localKeys: LocalKeySet,
  encryptedContentB64: string,
  nonceB64: string,
): Promise<string> {
  const packed = fromBase64(encryptedContentB64);
  const nonce = fromBase64(nonceB64);

  if (packed.length < 48) {
    throw new Error('Invalid encrypted content: too short');
  }

  const version = packed[0];

  if (version === VERSION_HYBRID_PQ_HKDF || version === VERSION_HYBRID_PQ) {
    // Hybrid PQ format: version(1) || ephemeral_pub(32) || pq_ciphertext(1088) || ciphertext
    const minSize = 1 + 32 + MLKEM768_CIPHERTEXT_SIZE + 16; // 16 = min AES-GCM tag
    if (packed.length < minSize) {
      throw new Error('Invalid hybrid encrypted content: too short');
    }
    if (!localKeys.pqSignedPreKey) {
      throw new Error('Cannot decrypt hybrid message: no PQ keys available');
    }

    const ephemeralPub = packed.slice(1, 33);
    const pqCiphertext = packed.slice(33, 33 + MLKEM768_CIPHERTEXT_SIZE);
    const ciphertext = packed.slice(33 + MLKEM768_CIPHERTEXT_SIZE);

    // Classical: X25519 DH
    const classicalShared = x25519KeyAgreement(localKeys.signedPreKey.keyPair.privateKey, ephemeralPub);
    // Post-quantum: ML-KEM decapsulation
    const pqShared = mlkemDecapsulate(pqCiphertext, localKeys.pqSignedPreKey.keyPair.decapsulationKey);

    // Use HKDF for v0x03, legacy SHA-256 for v0x02
    const messageKey = version === VERSION_HYBRID_PQ_HKDF
      ? await deriveHybridMessageKey(classicalShared, pqShared)
      : await deriveHybridMessageKeyLegacy(classicalShared, pqShared);
    return decryptMessage(messageKey, ciphertext, nonce);
  }

  if (version === VERSION_CLASSICAL) {
    // Classical format: version(1) || ephemeral_pub(32) || ciphertext
    const ephemeralPub = packed.slice(1, 33);
    const ciphertext = packed.slice(33);
    const shared = x25519KeyAgreement(localKeys.signedPreKey.keyPair.privateKey, ephemeralPub);
    const messageKey = await deriveMessageKeyLegacy(shared);
    return decryptMessage(messageKey, ciphertext, nonce);
  }

  // Legacy unversioned format: ephemeral_pub(32) || ciphertext (no version byte)
  const ephemeralPub = packed.slice(0, 32);
  const ciphertext = packed.slice(32);
  const shared = x25519KeyAgreement(localKeys.signedPreKey.keyPair.privateKey, ephemeralPub);
  const messageKey = await deriveMessageKeyLegacy(shared);
  return decryptMessage(messageKey, ciphertext, nonce);
}

// ── Key generation ─────────────────────────────────────────────────

/**
 * Generate a complete local key set with random keys (including PQ keys).
 */
export function generateKeySet(): LocalKeySet {
  const identity = generateIdentityKeyPair();
  const signedPreKey = generateSignedPreKey(identity.privateKey);
  const pqSignedPreKey = generatePQSignedPreKey(identity.privateKey);
  return { identity, signedPreKey, pqSignedPreKey };
}

/**
 * Derive a deterministic E2EE seed from the user's password using PBKDF2.
 * Uses 210,000 iterations with the user's ID as salt to prevent:
 * - Brute-force attacks (work factor makes GPU attacks ~210k× slower)
 * - Rainbow tables (salt makes each user's seed unique)
 * All devices with the same password + userId produce the same seed → same keys.
 */
export async function deriveE2EESeed(password: string, userId: string): Promise<Uint8Array> {
  const salt = new TextEncoder().encode('jolkr-e2ee-v2:' + userId);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    keyMaterial, 256,
  );
  return new Uint8Array(bits);
}

/** Helper: derive bytes from seed using HKDF-SHA256. */
async function hkdfDerive(seed: Uint8Array, info: string, lengthBits = 256): Promise<Uint8Array> {
  const buf = seed.buffer.slice(seed.byteOffset, seed.byteOffset + seed.byteLength) as ArrayBuffer;
  const keyMaterial = await crypto.subtle.importKey(
    'raw', buf, 'HKDF', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    keyMaterial, lengthBits,
  );
  return new Uint8Array(bits);
}

/**
 * Generate a deterministic key set from a seed using HKDF-SHA256.
 * This ensures all devices of the same user have identical keys.
 * Includes post-quantum ML-KEM-768 keys for quantum-proof encryption.
 */
export async function generateKeySetFromSeed(seed: Uint8Array): Promise<LocalKeySet> {
  // Derive Ed25519 identity key deterministically via HKDF
  const identityPriv = await hkdfDerive(seed, 'jolkr-e2ee-identity-ed25519');
  const identityPub = ed25519.getPublicKey(identityPriv);

  // Derive X25519 signed prekey deterministically via HKDF
  const spPriv = await hkdfDerive(seed, 'jolkr-e2ee-signedprekey-x25519');
  const spPub = x25519.getPublicKey(spPriv);
  const signature = ed25519.sign(spPub, identityPriv);

  // Derive ML-KEM-768 seed deterministically via HKDF (keygen_derand needs 64 bytes)
  const pqSeed = await hkdfDerive(seed, 'jolkr-e2ee-pqprekey-mlkem768', 512);

  const { publicKey: pqPublicKey, secretKey: pqSecretKey } = ml_kem768.keygen(pqSeed);
  const pqSignature = ed25519.sign(pqPublicKey, identityPriv);

  return {
    identity: { publicKey: identityPub, privateKey: identityPriv },
    signedPreKey: { keyPair: { publicKey: spPub, privateKey: spPriv }, signature },
    pqSignedPreKey: {
      keyPair: { encapsulationKey: pqPublicKey, decapsulationKey: pqSecretKey },
      signature: pqSignature,
    },
  };
}

/**
 * Legacy seed-based key derivation using SHA-256(seed || tag).
 * Used to decrypt old messages from before the HKDF migration.
 */
export async function generateKeySetFromSeedLegacy(seed: Uint8Array): Promise<LocalKeySet> {
  const idInput = new Uint8Array(seed.length + 7);
  idInput.set(seed);
  idInput.set(new TextEncoder().encode('ed25519'), seed.length);
  const identityPriv = new Uint8Array(await crypto.subtle.digest('SHA-256', idInput));
  const identityPub = ed25519.getPublicKey(identityPriv);

  const spInput = new Uint8Array(seed.length + 6);
  spInput.set(seed);
  spInput.set(new TextEncoder().encode('x25519'), seed.length);
  const spPriv = new Uint8Array(await crypto.subtle.digest('SHA-256', spInput));
  const spPub = x25519.getPublicKey(spPriv);
  const signature = ed25519.sign(spPub, identityPriv);

  const pqInput = new Uint8Array(seed.length + 6);
  pqInput.set(seed);
  pqInput.set(new TextEncoder().encode('mlkem7'), seed.length);
  const pqHash1 = new Uint8Array(await crypto.subtle.digest('SHA-256', pqInput));
  const pqInput2 = new Uint8Array(seed.length + 7);
  pqInput2.set(seed);
  pqInput2.set(new TextEncoder().encode('mlkem72'), seed.length);
  const pqHash2 = new Uint8Array(await crypto.subtle.digest('SHA-256', pqInput2));
  const pqSeed = new Uint8Array(64);
  pqSeed.set(pqHash1);
  pqSeed.set(pqHash2, 32);

  const { publicKey: pqPublicKey, secretKey: pqSecretKey } = ml_kem768.keygen(pqSeed);
  const pqSignature = ed25519.sign(pqPublicKey, identityPriv);

  return {
    identity: { publicKey: identityPub, privateKey: identityPriv },
    signedPreKey: { keyPair: { publicKey: spPub, privateKey: spPriv }, signature },
    pqSignedPreKey: {
      keyPair: { encapsulationKey: pqPublicKey, decapsulationKey: pqSecretKey },
      signature: pqSignature,
    },
  };
}
