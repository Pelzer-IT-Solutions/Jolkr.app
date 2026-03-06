export type {
  IdentityKeyPair,
  X25519KeyPair,
  MLKEMKeyPair,
  SignedPreKey,
  PQSignedPreKey,
  LocalKeySet,
  PreKeyBundle,
} from './keys';

export {
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

export {
  encryptChannelMessage,
  decryptChannelMessage,
  getChannelKey,
  generateAndDistributeChannelKey,
  invalidateChannelKey,
  clearAllChannelKeys,
} from './channelKeys';
