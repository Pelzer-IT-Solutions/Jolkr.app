use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ChannelEncryptionKeyRow;
use jolkr_common::JolkrError;

pub struct ChannelEncryptionRepo;

impl ChannelEncryptionRepo {
    /// Store encrypted channel key copies for multiple recipients (batch upsert).
    pub async fn distribute_keys(
        pool: &PgPool,
        channel_id: Uuid,
        distributor_user_id: Uuid,
        key_generation: i32,
        recipients: &[(Uuid, String, String)], // (recipient_user_id, encrypted_key, nonce)
    ) -> Result<(), JolkrError> {
        for (recipient_id, encrypted_key, nonce) in recipients {
            sqlx::query(
                r#"
                INSERT INTO channel_encryption_keys
                    (id, channel_id, recipient_user_id, encrypted_key, nonce, key_generation, distributor_user_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (channel_id, recipient_user_id, key_generation)
                DO UPDATE SET
                    encrypted_key = EXCLUDED.encrypted_key,
                    nonce = EXCLUDED.nonce,
                    distributor_user_id = EXCLUDED.distributor_user_id,
                    created_at = now()
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(channel_id)
            .bind(recipient_id)
            .bind(encrypted_key)
            .bind(nonce)
            .bind(key_generation)
            .bind(distributor_user_id)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    /// Get the latest encrypted channel key for a specific recipient.
    pub async fn get_key_for_recipient(
        pool: &PgPool,
        channel_id: Uuid,
        recipient_user_id: Uuid,
    ) -> Result<Option<ChannelEncryptionKeyRow>, JolkrError> {
        let row = sqlx::query_as::<_, ChannelEncryptionKeyRow>(
            r#"
            SELECT * FROM channel_encryption_keys
            WHERE channel_id = $1 AND recipient_user_id = $2
            ORDER BY key_generation DESC
            LIMIT 1
            "#,
        )
        .bind(channel_id)
        .bind(recipient_user_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// Delete all keys for a channel (used before rekey distribution).
    pub async fn delete_old_generations(
        pool: &PgPool,
        channel_id: Uuid,
        keep_generation: i32,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            r#"DELETE FROM channel_encryption_keys WHERE channel_id = $1 AND key_generation < $2"#,
        )
        .bind(channel_id)
        .bind(keep_generation)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Increment the channel's e2ee key generation and return the new value.
    pub async fn increment_key_generation(
        pool: &PgPool,
        channel_id: Uuid,
    ) -> Result<i32, JolkrError> {
        let row: (i32,) = sqlx::query_as(
            r#"
            UPDATE channels SET e2ee_key_generation = e2ee_key_generation + 1
            WHERE id = $1
            RETURNING e2ee_key_generation
            "#,
        )
        .bind(channel_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0)
    }

    /// Get the current key generation for a channel.
    pub async fn get_key_generation(
        pool: &PgPool,
        channel_id: Uuid,
    ) -> Result<i32, JolkrError> {
        let row: (i32,) = sqlx::query_as(
            r#"SELECT e2ee_key_generation FROM channels WHERE id = $1"#,
        )
        .bind(channel_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0)
    }
}
