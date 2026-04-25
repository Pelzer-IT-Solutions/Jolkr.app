use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::repo::{ChannelEncryptionRepo, MemberRepo};
use jolkr_db::models::ChannelEncryptionKeyRow;

/// Domain service for `channelencryption` operations.
pub struct ChannelEncryptionService;

/// A single recipient's encrypted key copy.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct RecipientKey {
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Encrypted key.
    pub encrypted_key: String,
    /// Encryption nonce when content is encrypted.
    pub nonce: String,
}

impl ChannelEncryptionService {
    /// Distribute encrypted channel keys to members.
    /// The distributor must be a member of the channel's server.
    pub async fn distribute_keys(
        pool: &PgPool,
        channel_id: Uuid,
        distributor_user_id: Uuid,
        key_generation: i32,
        recipients: Vec<RecipientKey>,
    ) -> Result<(), JolkrError> {
        if recipients.is_empty() {
            return Err(JolkrError::Validation("No recipients provided".into()));
        }
        if recipients.len() > 1000 {
            return Err(JolkrError::Validation("Too many recipients (max 1000)".into()));
        }

        // Validate all recipients are members of the channel's server
        let server_row = sqlx::query_as::<_, (Uuid,)>(
            "SELECT server_id FROM channels WHERE id = $1",
        )
        .bind(channel_id)
        .fetch_optional(pool)
        .await?;

        if let Some((server_id,)) = server_row {
            let recipient_ids: Vec<Uuid> = recipients.iter().map(|r| r.user_id).collect();
            let member_count: (i64,) = sqlx::query_as(
                "SELECT COUNT(*) FROM members WHERE server_id = $1 AND user_id = ANY($2)",
            )
            .bind(server_id)
            .bind(&recipient_ids)
            .fetch_one(pool)
            .await?;

            if (member_count.0 as usize) != recipient_ids.len() {
                return Err(JolkrError::Validation(
                    "One or more recipients are not members of this server".into(),
                ));
            }
        }
        // If no server found, this might be a DM channel — skip member validation

        let tuples: Vec<(Uuid, String, String)> = recipients
            .into_iter()
            .map(|r| (r.user_id, r.encrypted_key, r.nonce))
            .collect();

        ChannelEncryptionRepo::distribute_keys(
            pool,
            channel_id,
            distributor_user_id,
            key_generation,
            &tuples,
        )
        .await
    }

    /// Get the encrypted channel key for the requesting user.
    pub async fn get_my_key(
        pool: &PgPool,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<Option<ChannelEncryptionKeyRow>, JolkrError> {
        ChannelEncryptionRepo::get_key_for_recipient(pool, channel_id, user_id).await
    }

    /// Trigger a rekey: increment key generation.
    /// Called when a member is removed from the server.
    pub async fn trigger_rekey(
        pool: &PgPool,
        channel_id: Uuid,
    ) -> Result<i32, JolkrError> {
        ChannelEncryptionRepo::increment_key_generation(pool, channel_id).await
    }

    /// Get current key generation.
    pub async fn get_key_generation(
        pool: &PgPool,
        channel_id: Uuid,
    ) -> Result<i32, JolkrError> {
        ChannelEncryptionRepo::get_key_generation(pool, channel_id).await
    }

    /// Check if user is a member of the channel's server.
    pub async fn verify_channel_membership(
        pool: &PgPool,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, JolkrError> {
        // Get the channel's server_id
        let channel = sqlx::query_as::<_, (Uuid,)>(
            "SELECT server_id FROM channels WHERE id = $1",
        )
        .bind(channel_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        let member = MemberRepo::get_member(pool, channel.0, user_id).await;
        Ok(member.is_ok())
    }

    /// Check if user is a member of a DM channel.
    pub async fn verify_dm_membership(
        pool: &PgPool,
        dm_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, JolkrError> {
        let row = sqlx::query_as::<_, (i64,)>(
            "SELECT COUNT(*) FROM dm_members WHERE dm_channel_id = $1 AND user_id = $2",
        )
        .bind(dm_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0 > 0)
    }
}
