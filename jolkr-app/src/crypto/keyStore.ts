import { storage } from '../platform/storage';
import type { LocalKeySet } from './keys';
import { toBase64, fromBase64 } from './keys';

const KEYS = {
  identityPub: 'e2ee_identity_pub',
  identityPriv: 'e2ee_identity_priv',
  signedPrekeyPub: 'e2ee_signed_prekey_pub',
  signedPrekeyPriv: 'e2ee_signed_prekey_priv',
  signedPrekeySig: 'e2ee_signed_prekey_sig',
  pqEncapsulationKey: 'e2ee_pq_encapsulation_key',
  pqDecapsulationKey: 'e2ee_pq_decapsulation_key',
  pqSignature: 'e2ee_pq_signature',
} as const;

export async function saveKeySet(keys: LocalKeySet): Promise<void> {
  const ops = [
    storage.set(KEYS.identityPub, toBase64(keys.identity.publicKey)),
    storage.set(KEYS.identityPriv, toBase64(keys.identity.privateKey)),
    storage.set(KEYS.signedPrekeyPub, toBase64(keys.signedPreKey.keyPair.publicKey)),
    storage.set(KEYS.signedPrekeyPriv, toBase64(keys.signedPreKey.keyPair.privateKey)),
    storage.set(KEYS.signedPrekeySig, toBase64(keys.signedPreKey.signature)),
  ];
  if (keys.pqSignedPreKey) {
    ops.push(
      storage.set(KEYS.pqEncapsulationKey, toBase64(keys.pqSignedPreKey.keyPair.encapsulationKey)),
      storage.set(KEYS.pqDecapsulationKey, toBase64(keys.pqSignedPreKey.keyPair.decapsulationKey)),
      storage.set(KEYS.pqSignature, toBase64(keys.pqSignedPreKey.signature)),
    );
  }
  await Promise.all(ops);
}

export async function loadKeySet(): Promise<LocalKeySet | null> {
  const [idPub, idPriv, spPub, spPriv, spSig, pqEncap, pqDecap, pqSig] = await Promise.all([
    storage.get(KEYS.identityPub),
    storage.get(KEYS.identityPriv),
    storage.get(KEYS.signedPrekeyPub),
    storage.get(KEYS.signedPrekeyPriv),
    storage.get(KEYS.signedPrekeySig),
    storage.get(KEYS.pqEncapsulationKey),
    storage.get(KEYS.pqDecapsulationKey),
    storage.get(KEYS.pqSignature),
  ]);

  if (!idPub || !idPriv || !spPub || !spPriv || !spSig) {
    return null;
  }

  const keySet: LocalKeySet = {
    identity: {
      publicKey: fromBase64(idPub),
      privateKey: fromBase64(idPriv),
    },
    signedPreKey: {
      keyPair: {
        publicKey: fromBase64(spPub),
        privateKey: fromBase64(spPriv),
      },
      signature: fromBase64(spSig),
    },
  };

  // Load PQ keys if available
  if (pqEncap && pqDecap && pqSig) {
    keySet.pqSignedPreKey = {
      keyPair: {
        encapsulationKey: fromBase64(pqEncap),
        decapsulationKey: fromBase64(pqDecap),
      },
      signature: fromBase64(pqSig),
    };
  }

  return keySet;
}

export async function clearKeySet(): Promise<void> {
  await Promise.all(
    Object.values(KEYS).map((key) => storage.remove(key)),
  );
}

export async function hasKeySet(): Promise<boolean> {
  const val = await storage.get(KEYS.identityPub);
  return val !== null;
}
