use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::repo::KeyRepo;
use jolkr_db::repo::keys::PreKeyBundle;

use crate::crypto;

pub struct KeyService;

/// Request payload for uploading prekeys.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct UploadPreKeysRequest {
    pub device_id: Uuid,
    pub identity_key: Vec<u8>,
    pub signed_prekey: Vec<u8>,
    pub signed_prekey_signature: Vec<u8>,
    pub one_time_prekeys: Vec<Vec<u8>>,
    pub pq_signed_prekey: Option<Vec<u8>>,
    pub pq_signed_prekey_signature: Option<Vec<u8>>,
}

impl KeyService {
    /// Validate and store a prekey bundle uploaded by a client.
    pub async fn upload_prekeys(
        pool: &PgPool,
        user_id: Uuid,
        req: UploadPreKeysRequest,
    ) -> Result<(), JolkrError> {
        // Validate key sizes
        if req.identity_key.len() != 32 {
            return Err(JolkrError::Validation(
                "Identity key must be 32 bytes".into(),
            ));
        }
        if req.signed_prekey.len() != 32 {
            return Err(JolkrError::Validation(
                "Signed prekey must be 32 bytes".into(),
            ));
        }
        if req.signed_prekey_signature.len() != 64 {
            return Err(JolkrError::Validation(
                "Signed prekey signature must be 64 bytes".into(),
            ));
        }
        if req.one_time_prekeys.len() > 100 {
            return Err(JolkrError::Validation(
                "Cannot upload more than 100 one-time prekeys at once".into(),
            ));
        }
        for (i, otpk) in req.one_time_prekeys.iter().enumerate() {
            if otpk.len() != 32 {
                return Err(JolkrError::Validation(
                    format!("One-time prekey {i} must be 32 bytes"),
                ));
            }
        }

        // Verify the signed prekey signature using the identity key
        if !crypto::verify_signed_prekey(
            &req.identity_key,
            &req.signed_prekey,
            &req.signed_prekey_signature,
        ) {
            return Err(JolkrError::Validation(
                "Invalid signed prekey signature".into(),
            ));
        }

        // Validate post-quantum key sizes if provided
        if let Some(ref pq_key) = req.pq_signed_prekey {
            // ML-KEM-768 encapsulation key is 1184 bytes
            if pq_key.len() != 1184 {
                return Err(JolkrError::Validation(
                    "PQ signed prekey must be 1184 bytes (ML-KEM-768)".into(),
                ));
            }
        }
        if let Some(ref pq_sig) = req.pq_signed_prekey_signature {
            if pq_sig.len() != 64 {
                return Err(JolkrError::Validation(
                    "PQ signed prekey signature must be 64 bytes".into(),
                ));
            }
        }
        // Both PQ fields must be present together or absent together
        if req.pq_signed_prekey.is_some() != req.pq_signed_prekey_signature.is_some() {
            return Err(JolkrError::Validation(
                "PQ signed prekey and signature must both be present or both absent".into(),
            ));
        }

        KeyRepo::upload_prekeys(
            pool,
            user_id,
            req.device_id,
            &req.identity_key,
            &req.signed_prekey,
            &req.signed_prekey_signature,
            &req.one_time_prekeys,
            req.pq_signed_prekey.as_deref(),
            req.pq_signed_prekey_signature.as_deref(),
        )
        .await
    }

    /// Fetch a prekey bundle for initiating an E2EE session with a target device.
    pub async fn get_prekey_bundle(
        pool: &PgPool,
        target_user_id: Uuid,
        target_device_id: Uuid,
    ) -> Result<PreKeyBundle, JolkrError> {
        KeyRepo::get_prekey_bundle(pool, target_user_id, target_device_id).await
    }

    /// Fetch a prekey bundle by user_id only (auto-selects most recent device).
    pub async fn get_prekey_bundle_for_user(
        pool: &PgPool,
        target_user_id: Uuid,
    ) -> Result<PreKeyBundle, JolkrError> {
        KeyRepo::get_prekey_bundle_for_user(pool, target_user_id).await
    }

    /// Check how many unused one-time prekeys remain for a device.
    pub async fn count_remaining_prekeys(
        pool: &PgPool,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<i64, JolkrError> {
        KeyRepo::count_remaining_prekeys(pool, user_id, device_id).await
    }

    /// Cleanup: delete all consumed one-time prekeys.
    pub async fn cleanup_used_prekeys(pool: &PgPool) -> Result<u64, JolkrError> {
        KeyRepo::delete_used_prekeys(pool).await
    }
}
