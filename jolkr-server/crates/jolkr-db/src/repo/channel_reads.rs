use sqlx::PgPool;
use uuid::Uuid;

/// Repository for `channelreads` persistence.
pub struct ChannelReadsRepo;

impl ChannelReadsRepo {
    /// Mark read.
    pub async fn mark_read(
        pool: &PgPool,
        user_id: Uuid,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channel_read_states (user_id, channel_id, last_read_message_id, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, channel_id) DO UPDATE
             SET last_read_message_id = EXCLUDED.last_read_message_id,
                 updated_at = NOW()"
        )
        .bind(user_id)
        .bind(channel_id)
        .bind(message_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Mark server read.
    pub async fn mark_server_read(
        pool: &PgPool,
        user_id: Uuid,
        server_id: Uuid,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO channel_read_states (user_id, channel_id, last_read_message_id, updated_at)
             SELECT $1, c.id, m.id, NOW()
             FROM channels c
             JOIN LATERAL (
                 SELECT id FROM messages WHERE channel_id = c.id ORDER BY created_at DESC LIMIT 1
             ) m ON true
             WHERE c.server_id = $2
             ON CONFLICT (user_id, channel_id) DO UPDATE
             SET last_read_message_id = EXCLUDED.last_read_message_id,
                 updated_at = NOW()"
        )
        .bind(user_id)
        .bind(server_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}
