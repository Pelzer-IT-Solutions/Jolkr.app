use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::UserKeyRow;
use jolkr_common::JolkrError;

/// Repository for `key` persistence.
pub struct KeyRepo;

/// A bundle of keys that a client needs to start an E2EE session with a target device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PreKeyBundle {
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Device identifier.
    pub device_id: Uuid,
    /// Identity key.
    pub identity_key: Vec<u8>,
    /// Signed prekey.
    pub signed_prekey: Vec<u8>,
    /// Signed prekey signature.
    pub signed_prekey_signature: Vec<u8>,
    /// One time prekey.
    pub one_time_prekey: Option<Vec<u8>>,
    /// Pq signed prekey.
    pub pq_signed_prekey: Option<Vec<u8>>,
    /// Pq signed prekey signature.
    pub pq_signed_prekey_signature: Option<Vec<u8>>,
}

impl KeyRepo {
    /// Upload a batch of one-time prekeys for a device, along with the identity + signed prekey.
    pub async fn upload_prekeys(
        pool: &PgPool,
        user_id: Uuid,
        device_id: Uuid,
        identity_key: &[u8],
        signed_prekey: &[u8],
        signed_prekey_signature: &[u8],
        one_time_prekeys: &[Vec<u8>],
        pq_signed_prekey: Option<&[u8]>,
        pq_signed_prekey_signature: Option<&[u8]>,
    ) -> Result<(), JolkrError> {
        let now = Utc::now();

        // Upsert the identity key + signed prekey row (one per device, no one_time_prekey)
        sqlx::query(
            "
            INSERT INTO user_keys (id, user_id, device_id, identity_key, signed_prekey, signed_prekey_signature, pq_signed_prekey, pq_signed_prekey_signature, is_used, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
            ON CONFLICT (user_id, device_id) WHERE one_time_prekey IS NULL
            DO UPDATE SET
                identity_key                = EXCLUDED.identity_key,
                signed_prekey               = EXCLUDED.signed_prekey,
                signed_prekey_signature     = EXCLUDED.signed_prekey_signature,
                pq_signed_prekey            = EXCLUDED.pq_signed_prekey,
                pq_signed_prekey_signature  = EXCLUDED.pq_signed_prekey_signature,
                created_at                  = EXCLUDED.created_at
            ",
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(device_id)
        .bind(identity_key)
        .bind(signed_prekey)
        .bind(signed_prekey_signature)
        .bind(pq_signed_prekey)
        .bind(pq_signed_prekey_signature)
        .bind(now)
        .execute(pool)
        .await?;

        // Insert each one-time prekey as its own row
        for otpk in one_time_prekeys {
            sqlx::query(
                "
                INSERT INTO user_keys (id, user_id, device_id, identity_key, signed_prekey, signed_prekey_signature, one_time_prekey, is_used, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
                ",
            )
            .bind(Uuid::new_v4())
            .bind(user_id)
            .bind(device_id)
            .bind(identity_key)
            .bind(signed_prekey)
            .bind(signed_prekey_signature)
            .bind(otpk.as_slice())
            .bind(now)
            .execute(pool)
            .await?;
        }

        Ok(())
    }

    /// Fetch a prekey bundle for a target user/device.
    /// If a one-time prekey is available it will be included and marked as used (consumed).
    pub async fn get_prekey_bundle(
        pool: &PgPool,
        target_user_id: Uuid,
        target_device_id: Uuid,
    ) -> Result<PreKeyBundle, JolkrError> {
        // Fetch the base identity + signed prekey
        let base = sqlx::query_as::<_, UserKeyRow>(
            "
            SELECT * FROM user_keys
            WHERE user_id = $1 AND device_id = $2 AND one_time_prekey IS NULL AND is_used = false
            LIMIT 1
            ",
        )
        .bind(target_user_id)
        .bind(target_device_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        // Try to claim a one-time prekey (mark used atomically)
        let otpk_row = sqlx::query_as::<_, UserKeyRow>(
            "
            UPDATE user_keys
            SET is_used = true
            WHERE id = (
                SELECT id FROM user_keys
                WHERE user_id = $1 AND device_id = $2 AND one_time_prekey IS NOT NULL AND is_used = false
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING *
            ",
        )
        .bind(target_user_id)
        .bind(target_device_id)
        .fetch_optional(pool)
        .await?;

        Ok(PreKeyBundle {
            user_id: target_user_id,
            device_id: target_device_id,
            identity_key: base.identity_key,
            signed_prekey: base.signed_prekey,
            signed_prekey_signature: base.signed_prekey_signature,
            one_time_prekey: otpk_row.and_then(|r| r.one_time_prekey),
            pq_signed_prekey: base.pq_signed_prekey,
            pq_signed_prekey_signature: base.pq_signed_prekey_signature,
        })
    }

    /// Fetch prekey bundle for a user's most recent device (any device).
    /// Useful when the caller doesn't know the recipient's `device_id`.
    pub async fn get_prekey_bundle_for_user(
        pool: &PgPool,
        target_user_id: Uuid,
    ) -> Result<PreKeyBundle, JolkrError> {
        // Find the most recent base key row for this user
        let base = sqlx::query_as::<_, UserKeyRow>(
            "
            SELECT * FROM user_keys
            WHERE user_id = $1 AND one_time_prekey IS NULL AND is_used = false
            ORDER BY created_at DESC LIMIT 1
            ",
        )
        .bind(target_user_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        // Delegate to existing method for OTP claiming
        Self::get_prekey_bundle(pool, target_user_id, base.device_id).await
    }

    /// Delete all used one-time prekeys older than a threshold (cleanup job).
    pub async fn delete_used_prekeys(pool: &PgPool) -> Result<u64, JolkrError> {
        let result = sqlx::query(
            "DELETE FROM user_keys WHERE is_used = true AND one_time_prekey IS NOT NULL",
        )
        .execute(pool)
        .await?;

        Ok(result.rows_affected())
    }

    /// Count remaining unused one-time prekeys for a device.
    pub async fn count_remaining_prekeys(
        pool: &PgPool,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<i64, JolkrError> {
        let row: (i64,) = sqlx::query_as(
            "
            SELECT COUNT(*) FROM user_keys
            WHERE user_id = $1 AND device_id = $2 AND one_time_prekey IS NOT NULL AND is_used = false
            ",
        )
        .bind(user_id)
        .bind(device_id)
        .fetch_one(pool)
        .await?;

        Ok(row.0)
    }
}
