/**
 * @vitest-environment node
 *
 * Node's WebCrypto (subtle / TextEncoder / Uint8Array.buffer slice) is
 * stricter than jsdom about ArrayBuffer realm identity, but it is
 * spec-correct for everything keys.ts uses. Pure-crypto tests don't need
 * DOM, so opt out of the suite-wide jsdom default for this file.
 */
import { describe, it, expect } from 'vitest'
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generatePQSignedPreKey,
  verifySignedPreKey,
  verifyPQSignedPreKey,
  x25519KeyAgreement,
  mlkemEncapsulate,
  mlkemDecapsulate,
  deriveMessageKey,
  deriveHybridMessageKey,
  encryptMessage,
  decryptMessage,
  generateSafetyNumber,
  toBase64,
  fromBase64,
} from './keys'

describe('generateIdentityKeyPair', () => {
  it('returns 32-byte ed25519 keys', () => {
    const { publicKey, privateKey } = generateIdentityKeyPair()
    expect(publicKey).toBeInstanceOf(Uint8Array)
    expect(privateKey).toBeInstanceOf(Uint8Array)
    expect(publicKey.length).toBe(32)
    expect(privateKey.length).toBe(32)
  })

  it('produces a unique pair per call', () => {
    const a = generateIdentityKeyPair()
    const b = generateIdentityKeyPair()
    expect(a.privateKey).not.toEqual(b.privateKey)
    expect(a.publicKey).not.toEqual(b.publicKey)
  })
})

describe('generateSignedPreKey + verifySignedPreKey', () => {
  it('signs the X25519 public prekey with the identity key and verifies', () => {
    const identity = generateIdentityKeyPair()
    const spk = generateSignedPreKey(identity.privateKey)
    expect(spk.keyPair.publicKey.length).toBe(32)
    expect(spk.signature.length).toBe(64) // ed25519 sig
    expect(
      verifySignedPreKey(identity.publicKey, spk.keyPair.publicKey, spk.signature),
    ).toBe(true)
  })

  it('fails verification on a different identity key', () => {
    const identity = generateIdentityKeyPair()
    const other    = generateIdentityKeyPair()
    const spk = generateSignedPreKey(identity.privateKey)
    expect(
      verifySignedPreKey(other.publicKey, spk.keyPair.publicKey, spk.signature),
    ).toBe(false)
  })

  it('fails verification when the signed prekey bytes are tampered', () => {
    const identity = generateIdentityKeyPair()
    const spk = generateSignedPreKey(identity.privateKey)
    const tampered = new Uint8Array(spk.keyPair.publicKey)
    tampered[0] ^= 0xff
    expect(
      verifySignedPreKey(identity.publicKey, tampered, spk.signature),
    ).toBe(false)
  })
})

describe('generatePQSignedPreKey + verifyPQSignedPreKey', () => {
  it('signs the ML-KEM-768 encapsulation key with the identity key and verifies', () => {
    const identity = generateIdentityKeyPair()
    const pq = generatePQSignedPreKey(identity.privateKey)
    expect(pq.keyPair.encapsulationKey.length).toBe(1184) // ML-KEM-768 public
    expect(pq.keyPair.decapsulationKey.length).toBe(2400) // ML-KEM-768 secret
    expect(pq.signature.length).toBe(64)
    expect(
      verifyPQSignedPreKey(identity.publicKey, pq.keyPair.encapsulationKey, pq.signature),
    ).toBe(true)
  })

  it('fails verification on a different identity key', () => {
    const identity = generateIdentityKeyPair()
    const other    = generateIdentityKeyPair()
    const pq = generatePQSignedPreKey(identity.privateKey)
    expect(
      verifyPQSignedPreKey(other.publicKey, pq.keyPair.encapsulationKey, pq.signature),
    ).toBe(false)
  })
})

describe('x25519KeyAgreement', () => {
  it('produces a symmetric shared secret on both sides', () => {
    const alice = generateSignedPreKey(generateIdentityKeyPair().privateKey).keyPair
    const bob   = generateSignedPreKey(generateIdentityKeyPair().privateKey).keyPair
    const aliceShared = x25519KeyAgreement(alice.privateKey, bob.publicKey)
    const bobShared   = x25519KeyAgreement(bob.privateKey, alice.publicKey)
    expect(aliceShared).toEqual(bobShared)
    expect(aliceShared.length).toBe(32)
  })
})

describe('mlkemEncapsulate + mlkemDecapsulate', () => {
  it('round-trips the shared secret', () => {
    const identity = generateIdentityKeyPair()
    const pq = generatePQSignedPreKey(identity.privateKey)
    const { ciphertext, sharedSecret } = mlkemEncapsulate(pq.keyPair.encapsulationKey)
    const recovered = mlkemDecapsulate(ciphertext, pq.keyPair.decapsulationKey)
    expect(recovered).toEqual(sharedSecret)
    expect(sharedSecret.length).toBe(32)
  })
})

describe('deriveMessageKey + encryptMessage + decryptMessage', () => {
  it('round-trips a string through AES-256-GCM', async () => {
    const shared = new Uint8Array(32).fill(7)
    const key = await deriveMessageKey(shared)
    const { ciphertext, nonce } = await encryptMessage(key, 'hello jolkr')
    expect(nonce.length).toBe(12)
    expect(ciphertext.length).toBeGreaterThan(0)
    expect(await decryptMessage(key, ciphertext, nonce)).toBe('hello jolkr')
  })

  it('produces different ciphertext on each call (random nonce)', async () => {
    const shared = new Uint8Array(32).fill(3)
    const key = await deriveMessageKey(shared)
    const a = await encryptMessage(key, 'same plaintext')
    const b = await encryptMessage(key, 'same plaintext')
    expect(a.nonce).not.toEqual(b.nonce)
    expect(a.ciphertext).not.toEqual(b.ciphertext)
  })
})

describe('deriveHybridMessageKey', () => {
  it('produces a functional AES key from classical + PQ shared secrets', async () => {
    const classical = new Uint8Array(32).fill(1)
    const pq        = new Uint8Array(32).fill(2)
    const key = await deriveHybridMessageKey(classical, pq)
    const { ciphertext, nonce } = await encryptMessage(key, 'hybrid e2ee')
    expect(await decryptMessage(key, ciphertext, nonce)).toBe('hybrid e2ee')
  })

  it('produces a different key from the classical-only derivation', async () => {
    const classical = new Uint8Array(32).fill(1)
    const pq        = new Uint8Array(32).fill(2)
    const classicalOnly = await deriveMessageKey(classical)
    const hybrid        = await deriveHybridMessageKey(classical, pq)
    const { ciphertext, nonce } = await encryptMessage(classicalOnly, 'cross-key check')
    await expect(decryptMessage(hybrid, ciphertext, nonce)).rejects.toThrow()
  })
})

describe('generateSafetyNumber', () => {
  it('returns 12 groups of 5 digits separated by spaces', async () => {
    const a = generateIdentityKeyPair()
    const b = generateIdentityKeyPair()
    const num = await generateSafetyNumber(a.publicKey, b.publicKey)
    expect(num).toMatch(/^\d{5}( \d{5}){11}$/)
  })

  it('is symmetric — both sides compute the same number', async () => {
    const a = generateIdentityKeyPair()
    const b = generateIdentityKeyPair()
    const fromA = await generateSafetyNumber(a.publicKey, b.publicKey)
    const fromB = await generateSafetyNumber(b.publicKey, a.publicKey)
    expect(fromA).toBe(fromB)
  })

  it('changes when either identity changes', async () => {
    const a = generateIdentityKeyPair()
    const b = generateIdentityKeyPair()
    const c = generateIdentityKeyPair()
    expect(await generateSafetyNumber(a.publicKey, b.publicKey))
      .not.toBe(await generateSafetyNumber(a.publicKey, c.publicKey))
  })
})

describe('toBase64 + fromBase64', () => {
  it('round-trips arbitrary byte sequences', () => {
    const data = new Uint8Array([0, 1, 2, 254, 255, 128, 64, 32])
    const b64 = toBase64(data)
    const back = fromBase64(b64)
    expect(back).toEqual(data)
  })

  it('produces standard base64 (with `+`/`/`/`=` padding)', () => {
    expect(toBase64(new Uint8Array([0xff, 0xee, 0xdd, 0xcc, 0xbb])))
      .toBe('/+7dzLs=')
  })
})
