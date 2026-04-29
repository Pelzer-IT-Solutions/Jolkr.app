use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ServerEmojiRow;
use jolkr_common::JolkrError;

/// Repository for `emoji` persistence.
pub struct EmojiRepo;

impl EmojiRepo {
    /// Create a new server emoji.
    pub async fn create(
        pool: &PgPool,
        id: Uuid,
        server_id: Uuid,
        name: &str,
        image_key: &str,
        uploader_id: Uuid,
        animated: bool,
    ) -> Result<ServerEmojiRow, JolkrError> {
        let row = sqlx::query_as::<_, ServerEmojiRow>(
            "
            INSERT INTO server_emojis (id, server_id, name, image_key, uploader_id, animated)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(server_id)
        .bind(name)
        .bind(image_key)
        .bind(uploader_id)
        .bind(animated)
        .fetch_one(pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(ref db_err) = e {
                if db_err.code().as_deref() == Some("23505") {
                    return JolkrError::Validation(
                        format!("An emoji with the name '{name}' already exists in this server"),
                    );
                }
            }
            JolkrError::from(e)
        })?;

        Ok(row)
    }

    /// List all emojis for a server.
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<ServerEmojiRow>, JolkrError> {
        let rows = sqlx::query_as::<_, ServerEmojiRow>(
            "SELECT * FROM server_emojis WHERE server_id = $1 ORDER BY name ASC",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Get a single emoji by ID.
    pub async fn get_by_id(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<ServerEmojiRow, JolkrError> {
        let row = sqlx::query_as::<_, ServerEmojiRow>(
            "SELECT * FROM server_emojis WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Count emojis in a server.
    pub async fn count_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<i64, JolkrError> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM server_emojis WHERE server_id = $1",
        )
        .bind(server_id)
        .fetch_one(pool)
        .await?;

        Ok(row.0)
    }

    /// Delete an emoji.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query("DELETE FROM server_emojis WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }

        Ok(())
    }

    /// Batch fetch emojis for multiple servers (for preloading).
    pub async fn list_for_servers(
        pool: &PgPool,
        server_ids: &[Uuid],
    ) -> Result<Vec<ServerEmojiRow>, JolkrError> {
        if server_ids.is_empty() {
            return Ok(vec![]);
        }

        let rows = sqlx::query_as::<_, ServerEmojiRow>(
            "SELECT * FROM server_emojis WHERE server_id = ANY($1) ORDER BY server_id, name ASC",
        )
        .bind(server_ids)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }
}
