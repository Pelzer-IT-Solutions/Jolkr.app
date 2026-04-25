use sqlx::PgPool;
use uuid::Uuid;

use crate::models::PinRow;
use jolkr_common::JolkrError;

/// Repository for `pin` persistence.
pub struct PinRepo;

impl PinRepo {
    /// Pin a message in a channel.
    pub async fn pin(
        pool: &PgPool,
        channel_id: Uuid,
        message_id: Uuid,
        pinned_by: Uuid,
    ) -> Result<PinRow, JolkrError> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, PinRow>(
            "INSERT INTO pins (id, channel_id, message_id, pinned_by)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (channel_id, message_id) DO UPDATE SET id = pins.id
               RETURNING *",
        )
        .bind(id)
        .bind(channel_id)
        .bind(message_id)
        .bind(pinned_by)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    /// Unpin a message.
    pub async fn unpin(
        pool: &PgPool,
        channel_id: Uuid,
        message_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "DELETE FROM pins WHERE channel_id = $1 AND message_id = $2",
        )
        .bind(channel_id)
        .bind(message_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// List all pinned message IDs for a channel (ordered by pin time).
    pub async fn list_for_channel(
        pool: &PgPool,
        channel_id: Uuid,
    ) -> Result<Vec<PinRow>, JolkrError> {
        let rows = sqlx::query_as::<_, PinRow>(
            "SELECT * FROM pins
               WHERE channel_id = $1
               ORDER BY pinned_at DESC",
        )
        .bind(channel_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
