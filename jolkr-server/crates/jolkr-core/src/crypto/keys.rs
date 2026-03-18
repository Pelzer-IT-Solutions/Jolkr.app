//! E2EE Key management utilities.
//!
//! Implements X3DH-style key exchange using:
//! - Ed25519 for identity keys and signatures (ed25519-dalek)
//! - X25519 for ephemeral key agreement (x25519-dalek)
//! - AES-256-GCM for message encryption (aes-gcm)

use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};
use x25519_dalek::{StaticSecret, PublicKey as X25519PublicKey};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};

/// An Ed25519 identity key pair (long-lived, one per device).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityKeyPair {
    /// Ed25519 public key (32 bytes).
    pub public_key: Vec<u8>,
    /// Ed25519 secret key (32 bytes).
    pub private_key: Vec<u8>,
}

/// An X25519 key pair used for signed prekeys and one-time prekeys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPair {
    /// X25519 public key (32 bytes).
    pub public_key: Vec<u8>,
    /// X25519 secret key (32 bytes).
    pub private_key: Vec<u8>,
}

/// A signed prekey with its Ed25519 signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedPreKey {
    pub key_pair: KeyPair,
    /// Ed25519 signature over the public prekey (64 bytes).
    pub signature: Vec<u8>,
}

/// A bundle of prekeys ready to be uploaded to the server.
/// Only contains public keys — private keys stay on the client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreKeyUploadBundle {
    pub identity_key: Vec<u8>,
    pub signed_prekey: Vec<u8>,
    pub signed_prekey_signature: Vec<u8>,
    pub one_time_prekeys: Vec<Vec<u8>>,
}

// ── Key generation functions ───────────────────────────────────────────

/// Generate an Ed25519 identity key pair (long-lived, one per device).
pub fn generate_identity_keypair() -> IdentityKeyPair {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    IdentityKeyPair {
        public_key: verifying_key.to_bytes().to_vec(),
        private_key: signing_key.to_bytes().to_vec(),
    }
}

/// Generate a signed X25519 prekey (medium-lived, rotated periodically).
/// The prekey's public half is signed with the Ed25519 identity key.
pub fn generate_signed_prekey(identity_private_key: &[u8]) -> SignedPreKey {
    // Generate X25519 key pair
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = X25519PublicKey::from(&secret);

    // Sign the X25519 public key with the Ed25519 identity key
    let signing_bytes: [u8; 32] = identity_private_key
        .try_into()
        .expect("identity key must be 32 bytes");
    let signing_key = SigningKey::from_bytes(&signing_bytes);
    let signature = signing_key.sign(public.as_bytes());

    SignedPreKey {
        key_pair: KeyPair {
            public_key: public.as_bytes().to_vec(),
            private_key: secret.to_bytes().to_vec(),
        },
        signature: signature.to_bytes().to_vec(),
    }
}

/// Verify a signed prekey against an Ed25519 identity public key.
pub fn verify_signed_prekey(
    identity_public_key: &[u8],
    signed_prekey: &[u8],
    signature: &[u8],
) -> bool {
    let Ok(pk_bytes) = <[u8; 32]>::try_from(identity_public_key) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&pk_bytes) else {
        return false;
    };
    let Ok(sig_bytes) = <[u8; 64]>::try_from(signature) else {
        return false;
    };
    let sig = Signature::from_bytes(&sig_bytes);
    verifying_key.verify(signed_prekey, &sig).is_ok()
}

/// Generate a batch of one-time X25519 prekeys (ephemeral, consumed on first use).
pub fn generate_one_time_prekeys(count: usize) -> Vec<KeyPair> {
    (0..count)
        .map(|_| {
            let secret = StaticSecret::random_from_rng(OsRng);
            let public = X25519PublicKey::from(&secret);
            KeyPair {
                public_key: public.as_bytes().to_vec(),
                private_key: secret.to_bytes().to_vec(),
            }
        })
        .collect()
}

/// Build a `PreKeyUploadBundle` from a freshly generated key set.
/// Returns: (upload_bundle, identity_keypair, signed_prekey, one_time_prekeys)
pub fn generate_upload_bundle(
    one_time_count: usize,
) -> (PreKeyUploadBundle, IdentityKeyPair, SignedPreKey, Vec<KeyPair>) {
    let identity = generate_identity_keypair();
    let signed = generate_signed_prekey(&identity.private_key);
    let one_time = generate_one_time_prekeys(one_time_count);

    let bundle = PreKeyUploadBundle {
        identity_key: identity.public_key.clone(),
        signed_prekey: signed.key_pair.public_key.clone(),
        signed_prekey_signature: signed.signature.clone(),
        one_time_prekeys: one_time.iter().map(|kp| kp.public_key.clone()).collect(),
    };

    (bundle, identity, signed, one_time)
}

// ── Message encryption ─────────────────────────────────────────────────

/// Encrypt a plaintext message with AES-256-GCM.
/// Returns (ciphertext, nonce).
pub fn encrypt_message(key: &[u8; 32], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    use aes_gcm::aead::Aead;
    use rand::RngCore;

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Invalid AES key: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypt a ciphertext with AES-256-GCM.
pub fn decrypt_message(
    key: &[u8; 32],
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Vec<u8>, String> {
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
    use aes_gcm::aead::Aead;

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| format!("Invalid AES key: {e}"))?;

    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {e}"))
}

/// Perform X25519 Diffie-Hellman key agreement.
/// Returns a 32-byte shared secret.
pub fn x25519_key_agreement(private_key: &[u8; 32], public_key: &[u8; 32]) -> [u8; 32] {
    let secret = StaticSecret::from(*private_key);
    let public = X25519PublicKey::from(*public_key);
    *secret.diffie_hellman(&public).as_bytes()
}

/// Derive an AES-256 encryption key from a shared secret using HKDF-SHA256.
/// Uses RFC 5869 HKDF with empty salt (extract) and info context (expand).
pub fn derive_message_key(shared_secret: &[u8; 32], info: &[u8]) -> [u8; 32] {
    use hkdf::Hkdf;
    use sha2::Sha256;

    let hk = Hkdf::<Sha256>::new(None, shared_secret);
    let mut key = [0u8; 32];
    hk.expand(info, &mut key).expect("32 bytes is a valid HKDF-SHA256 output length");
    key
}
