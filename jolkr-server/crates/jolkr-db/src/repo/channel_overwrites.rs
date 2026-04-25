use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ChannelOverwriteRow;
use jolkr_common::JolkrError;

/// Repository for `channeloverwrite` persistence.
pub struct ChannelOverwriteRepo;

impl ChannelOverwriteRepo {
    /// List all overwrites for a specific channel.
    pub async fn list_for_channel(
        pool: &PgPool,
        channel_id: Uuid,
    ) -> Result<Vec<ChannelOverwriteRow>, JolkrError> {
        let rows = sqlx::query_as::<_, ChannelOverwriteRow>(
            "SELECT * FROM channel_permission_overwrites WHERE channel_id = $1 ORDER BY target_type, created_at",
        )
        .bind(channel_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Batch-fetch all overwrites for all channels in a server (JOIN via channels table).
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<ChannelOverwriteRow>, JolkrError> {
        let rows = sqlx::query_as::<_, ChannelOverwriteRow>(
            "
            SELECT cpo.*
            FROM channel_permission_overwrites cpo
            JOIN channels c ON c.id = cpo.channel_id
            WHERE c.server_id = $1
            ",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Upsert (insert or update) a channel overwrite.
    pub async fn upsert(
        pool: &PgPool,
        channel_id: Uuid,
        target_type: &str,
        target_id: Uuid,
        allow: i64,
        deny: i64,
    ) -> Result<ChannelOverwriteRow, JolkrError> {
        let now = Utc::now();
        let row = sqlx::query_as::<_, ChannelOverwriteRow>(
            "
            INSERT INTO channel_permission_overwrites (channel_id, target_type, target_id, allow, deny, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            ON CONFLICT (channel_id, target_type, target_id)
            DO UPDATE SET allow = $4, deny = $5, updated_at = $6
            RETURNING *
            ",
        )
        .bind(channel_id)
        .bind(target_type)
        .bind(target_id)
        .bind(allow)
        .bind(deny)
        .bind(now)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Delete a specific overwrite by channel + target.
    pub async fn delete(
        pool: &PgPool,
        channel_id: Uuid,
        target_type: &str,
        target_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "DELETE FROM channel_permission_overwrites WHERE channel_id = $1 AND target_type = $2 AND target_id = $3",
        )
        .bind(channel_id)
        .bind(target_type)
        .bind(target_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Delete all overwrites for a given target (cleanup on role/member delete).
    pub async fn delete_by_target(
        pool: &PgPool,
        target_type: &str,
        target_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "DELETE FROM channel_permission_overwrites WHERE target_type = $1 AND target_id = $2",
        )
        .bind(target_type)
        .bind(target_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}
