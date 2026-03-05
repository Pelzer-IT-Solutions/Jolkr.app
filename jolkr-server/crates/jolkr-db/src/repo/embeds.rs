use sqlx::PgPool;
use uuid::Uuid;

use crate::models::{MessageEmbedRow, DmMessageEmbedRow};
use jolkr_common::JolkrError;

pub struct EmbedRepo;

impl EmbedRepo {
    /// Create a message embed.
    pub async fn create(
        pool: &PgPool,
        id: Uuid,
        message_id: Uuid,
        url: &str,
        title: Option<&str>,
        description: Option<&str>,
        image_url: Option<&str>,
        site_name: Option<&str>,
        color: Option<&str>,
    ) -> Result<MessageEmbedRow, JolkrError> {
        let row = sqlx::query_as::<_, MessageEmbedRow>(
            r#"
            INSERT INTO message_embeds (id, message_id, url, title, description, image_url, site_name, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(message_id)
        .bind(url)
        .bind(title)
        .bind(description)
        .bind(image_url)
        .bind(site_name)
        .bind(color)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// List embeds for a single message.
    pub async fn list_for_message(
        pool: &PgPool,
        message_id: Uuid,
    ) -> Result<Vec<MessageEmbedRow>, JolkrError> {
        let rows = sqlx::query_as::<_, MessageEmbedRow>(
            r#"SELECT * FROM message_embeds WHERE message_id = $1 ORDER BY created_at ASC"#,
        )
        .bind(message_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Batch list embeds for multiple messages (avoids N+1).
    pub async fn list_for_messages(
        pool: &PgPool,
        message_ids: &[Uuid],
    ) -> Result<Vec<MessageEmbedRow>, JolkrError> {
        if message_ids.is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query_as::<_, MessageEmbedRow>(
            r#"SELECT * FROM message_embeds WHERE message_id = ANY($1) ORDER BY created_at ASC"#,
        )
        .bind(message_ids)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Delete all embeds for a message.
    pub async fn delete_for_message(
        pool: &PgPool,
        message_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(r#"DELETE FROM message_embeds WHERE message_id = $1"#)
            .bind(message_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    // ── DM Embeds ──────────────────────────────────────────────────────

    /// Create a DM message embed.
    pub async fn create_dm(
        pool: &PgPool,
        id: Uuid,
        dm_message_id: Uuid,
        url: &str,
        title: Option<&str>,
        description: Option<&str>,
        image_url: Option<&str>,
        site_name: Option<&str>,
        color: Option<&str>,
    ) -> Result<DmMessageEmbedRow, JolkrError> {
        let row = sqlx::query_as::<_, DmMessageEmbedRow>(
            r#"
            INSERT INTO dm_message_embeds (id, dm_message_id, url, title, description, image_url, site_name, color)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(dm_message_id)
        .bind(url)
        .bind(title)
        .bind(description)
        .bind(image_url)
        .bind(site_name)
        .bind(color)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Batch list embeds for multiple DM messages (avoids N+1).
    pub async fn list_for_dm_messages(
        pool: &PgPool,
        dm_message_ids: &[Uuid],
    ) -> Result<Vec<DmMessageEmbedRow>, JolkrError> {
        if dm_message_ids.is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query_as::<_, DmMessageEmbedRow>(
            r#"SELECT * FROM dm_message_embeds WHERE dm_message_id = ANY($1) ORDER BY created_at ASC"#,
        )
        .bind(dm_message_ids)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }
}
