use sqlx::PgPool;
use uuid::Uuid;

use crate::models::AttachmentRow;
use jolkr_common::JolkrError;

pub struct AttachmentRepo;

impl AttachmentRepo {
    /// Insert a new attachment linked to a message.
    pub async fn create(
        pool: &PgPool,
        id: Uuid,
        message_id: Uuid,
        filename: &str,
        content_type: &str,
        size_bytes: i64,
        url: &str,
        encrypted_key: Option<&[u8]>,
    ) -> Result<AttachmentRow, JolkrError> {
        let row = sqlx::query_as::<_, AttachmentRow>(
            r#"
            INSERT INTO attachments
                (id, message_id, filename, content_type, size_bytes, url, encrypted_key)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(message_id)
        .bind(filename)
        .bind(content_type)
        .bind(size_bytes)
        .bind(url)
        .bind(encrypted_key)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Get all attachments for a message.
    pub async fn list_for_message(
        pool: &PgPool,
        message_id: Uuid,
    ) -> Result<Vec<AttachmentRow>, JolkrError> {
        let rows = sqlx::query_as::<_, AttachmentRow>(
            r#"SELECT * FROM attachments WHERE message_id = $1 ORDER BY created_at"#,
        )
        .bind(message_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Get attachments for multiple messages in a single query.
    pub async fn list_for_messages(
        pool: &PgPool,
        message_ids: &[Uuid],
    ) -> Result<Vec<AttachmentRow>, JolkrError> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, AttachmentRow>(
            r#"SELECT * FROM attachments WHERE message_id = ANY($1) ORDER BY created_at"#,
        )
        .bind(message_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Get a single attachment by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<AttachmentRow, JolkrError> {
        let row = sqlx::query_as::<_, AttachmentRow>(
            r#"SELECT * FROM attachments WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Delete an attachment by ID.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query(r#"DELETE FROM attachments WHERE id = $1"#)
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }
}
