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

export async function deriveMessageKey(shared: Uint8Array): Promise<CryptoKey> {
  // SHA-256(shared || context)
  const input = new Uint8Array(shared.length + CONTEXT_STRING.length);
  input.set(shared);
  input.set(CONTEXT_STRING, shared.length);

  const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(input));

  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derive a hybrid message key from both a classical and post-quantum shared secret.
 * Uses HKDF: SHA-256(classical || pqSecret || context) → AES-256-GCM key.
 * If either algorithm is broken, the other still protects the key.
 */
export async function deriveHybridMessageKey(
  classicalShared: Uint8Array,
  pqShared: Uint8Array,
): Promise<CryptoKey> {
  const input = new Uint8Array(classicalShared.length + pqShared.length + HYBRID_CONTEXT.length);
  input.set(classicalShared);
  input.set(pqShared, classicalShared.length);
  input.set(HYBRID_CONTEXT, classicalShared.length + pqShared.length);

  const hash = await crypto.subtle.digest('SHA-256', toArrayBuffer(input));

  return crypto.subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
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
