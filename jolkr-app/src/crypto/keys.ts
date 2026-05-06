import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

// ── Types ──────────────────────────────────────────────────────────

export interface IdentityKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface X25519KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface MLKEMKeyPair {
  encapsulationKey: Uint8Array; // public — used by sender to encapsulate
  decapsulationKey: Uint8Array; // private — used by recipient to decapsulate
}

export interface SignedPreKey {
  keyPair: X25519KeyPair;
  signature: Uint8Array;
}

export interface PQSignedPreKey {
  keyPair: MLKEMKeyPair;
  signature: Uint8Array; // Ed25519 signature over the encapsulation key
}

export interface LocalKeySet {
  identity: IdentityKeyPair;
  signedPreKey: SignedPreKey;
  pqSignedPreKey?: PQSignedPreKey; // post-quantum (optional for backwards compat)
}

export interface PreKeyBundle {
  userId: string;
  deviceId: string;
  identityKey: Uint8Array;
  signedPrekey: Uint8Array;
  signedPrekeySignature: Uint8Array;
  oneTimePrekey?: Uint8Array;
  // Post-quantum fields (optional — old clients may not have these)
  pqSignedPrekey?: Uint8Array;          // ML-KEM-768 encapsulation key
  pqSignedPrekeySignature?: Uint8Array; // Ed25519 sig over pq encapsulation key
}

// ── Key generation ─────────────────────────────────────────────────

export function generateIdentityKeyPair(): IdentityKeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { publicKey, privateKey };
}

export function generateSignedPreKey(identityPrivKey: Uint8Array): SignedPreKey {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const signature = ed25519.sign(publicKey, identityPrivKey);
  return {
    keyPair: { publicKey, privateKey },
    signature,
  };
}

export function generatePQSignedPreKey(identityPrivKey: Uint8Array): PQSignedPreKey {
  const { publicKey, secretKey } = ml_kem768.keygen();
  const signature = ed25519.sign(publicKey, identityPrivKey);
  return {
    keyPair: { encapsulationKey: publicKey, decapsulationKey: secretKey },
    signature,
  };
}

export function verifyPQSignedPreKey(
  identityPubKey: Uint8Array,
  pqEncapsulationKey: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, pqEncapsulationKey, identityPubKey);
  } catch {
    return false;
  }
}

export function verifySignedPreKey(
  identityPubKey: Uint8Array,
  signedPrekey: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, signedPrekey, identityPubKey);
  } catch {
    return false;
  }
}

// ── X25519 key agreement ───────────────────────────────────────────

export function x25519KeyAgreement(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

// ── ML-KEM-768 encapsulation ──────────────────────────────────────

/** Encapsulate: sender creates ciphertext + shared secret from recipient's encapsulation key. */
export function mlkemEncapsulate(
  encapsulationKey: Uint8Array,
): { ciphertext: Uint8Array; sharedSecret: Uint8Array } {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(encapsulationKey);
  return { ciphertext: cipherText, sharedSecret };
}

/** Decapsulate: recipient recovers shared secret from ciphertext using their decapsulation key. */
export function mlkemDecapsulate(
  ciphertext: Uint8Array,
  decapsulationKey: Uint8Array,
): Uint8Array {
  return ml_kem768.decapsulate(ciphertext, decapsulationKey) as Uint8Array;
}

// ── Helpers ────────────────────────────────────────────────────────

/** Create a clean ArrayBuffer copy (TS 5.9 strict ArrayBufferLike compat). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

// ── Key derivation ─────────────────────────────────────────────────

const CONTEXT_STRING = new TextEncoder().encode('jolkr-e2ee-v1');
const HYBRID_CONTEXT = new TextEncoder().encode('jolkr-e2ee-hybrid-v1');

/** Derive an AES-256-GCM key from a classical shared secret using HKDF-SHA256. */
export async function deriveMessageKey(shared: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', toArrayBuffer(shared), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: toArrayBuffer(CONTEXT_STRING) },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive a hybrid message key from both a classical and post-quantum shared secret
 * using HKDF-SHA256. If either algorithm is broken, the other still protects the key.
 */
export async function deriveHybridMessageKey(
  classicalShared: Uint8Array,
  pqShared: Uint8Array,
): Promise<CryptoKey> {
  const ikm = new Uint8Array(classicalShared.length + pqShared.length);
  ikm.set(classicalShared);
  ikm.set(pqShared, classicalShared.length);

  const keyMaterial = await crypto.subtle.importKey(
    'raw', toArrayBuffer(ikm), 'HKDF', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: toArrayBuffer(HYBRID_CONTEXT) },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── AES-256-GCM encryption ────────────────────────────────────────

export async function encryptMessage(
  key: CryptoKey,
  plaintext: string,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(encoded),
  );

  return {
    ciphertext: new Uint8Array(encrypted),
    nonce,
  };
}

export async function decryptMessage(
  key: CryptoKey,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce) },
    key,
    toArrayBuffer(ciphertext),
  );

  return new TextDecoder().decode(decrypted);
}

// ── Safety numbers ──────────────────────────────────────────────────

/**
 * Generate a safety number from two users' identity public keys.
 * SHA-256(sorted(keyA || keyB)) → formatted as groups of 5 digits.
 * Both users computing this independently will get the same result.
 */
export async function generateSafetyNumber(
  localIdentityKey: Uint8Array,
  remoteIdentityKey: Uint8Array,
): Promise<string> {
  // Sort keys lexicographically so both sides produce the same hash
  const cmp = compareBytes(localIdentityKey, remoteIdentityKey);
  const first = cmp <= 0 ? localIdentityKey : remoteIdentityKey;
  const second = cmp <= 0 ? remoteIdentityKey : localIdentityKey;

  const combined = new Uint8Array(first.length + second.length);
  combined.set(first);
  combined.set(second, first.length);

  // Double-hash for more entropy bytes (need ≥30 bytes for 60 digits)
  const hash1 = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBuffer(combined)),
  );
  const hash2 = new Uint8Array(
    await crypto.subtle.digest('SHA-256', toArrayBuffer(hash1)),
  );
  const allBytes = new Uint8Array(64);
  allBytes.set(hash1);
  allBytes.set(hash2, 32);

  // Convert to decimal digits: 2-byte pairs → mod 10000 → 4 uniform digits
  // Bias: 65536 mod 10000 = 5536, so values 0-5535 are ~0.06% more likely — negligible
  let digits = '';
  for (let i = 0; i + 1 < allBytes.length && digits.length < 60; i += 2) {
    const val = ((allBytes[i] << 8) | allBytes[i + 1]) % 10000;
    digits += val.toString().padStart(4, '0');
  }
  digits = digits.slice(0, 60);

  // Format as 12 groups of 5 digits
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) {
    groups.push(digits.slice(i, i + 5));
  }
  return groups.join(' ');
}

// Used only to lexicographically order two PUBLIC identity keys so both
// participants derive the same shared key. Operands are not secret, so a
// non-constant-time comparison is fine here. Do NOT reuse this helper for
// secret material — use a constant-time XOR-fold instead.
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// ── Base64 helpers ─────────────────────────────────────────────────

export function toBase64(data: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
