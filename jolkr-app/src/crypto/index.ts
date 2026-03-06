export type {
  IdentityKeyPair,
  X25519KeyPair,
  SignedPreKey,
  LocalKeySet,
  PreKeyBundle,
} from './keys';

export {
  generateIdentityKeyPair,
  generateSignedPreKey,
  verifySignedPreKey,
  x25519KeyAgreement,
  deriveMessageKey,
  encryptMessage,
  decryptMessage,
  toBase64,
  fromBase64,
} from './keys';

export {
  encryptForRecipient,
  decryptFromSender,
  generateKeySet,
  deriveE2EESeed,
  generateKeySetFromSeed,
} from './e2ee';

export type { EncryptedPayload } from './e2ee';

export {
  saveKeySet,
  loadKeySet,
  clearKeySet,
  hasKeySet,
} from './keyStore';
