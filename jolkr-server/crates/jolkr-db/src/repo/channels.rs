use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ChannelRow;
use jolkr_common::JolkrError;

pub struct ChannelRepo;

impl ChannelRepo {
    /// Create a new channel within a server.
    pub async fn create_channel(
        pool: &PgPool,
        id: Uuid,
        server_id: Uuid,
        category_id: Option<Uuid>,
        name: &str,
        kind: &str,
        position: i32,
    ) -> Result<ChannelRow, JolkrError> {
        let now = Utc::now();
        let channel = sqlx::query_as::<_, ChannelRow>(
            r#"
            INSERT INTO channels (id, server_id, category_id, name, kind, position, is_nsfw, slowmode_seconds, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, false, 0, $7, $7)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(server_id)
        .bind(category_id)
        .bind(name)
        .bind(kind)
        .bind(position)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(channel)
    }

    /// Get a channel by its ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<ChannelRow, JolkrError> {
        let channel = sqlx::query_as::<_, ChannelRow>(
            r#"SELECT * FROM channels WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(channel)
    }

    /// List all channels in a server, ordered by position.
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<ChannelRow>, JolkrError> {
        let channels = sqlx::query_as::<_, ChannelRow>(
            r#"
            SELECT * FROM channels
            WHERE server_id = $1
            ORDER BY position ASC
            "#,
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(channels)
    }

    /// Update channel metadata.
    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        name: Option<&str>,
        topic: Option<&str>,
        position: Option<i32>,
        is_nsfw: Option<bool>,
        slowmode_seconds: Option<i32>,
    ) -> Result<ChannelRow, JolkrError> {
        let now = Utc::now();
        let channel = sqlx::query_as::<_, ChannelRow>(
            r#"
            UPDATE channels
            SET name              = COALESCE($2, name),
                topic             = COALESCE($3, topic),
                position          = COALESCE($4, position),
                is_nsfw           = COALESCE($5, is_nsfw),
                slowmode_seconds  = COALESCE($6, slowmode_seconds),
                updated_at        = $7
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(topic)
        .bind(position)
        .bind(is_nsfw)
        .bind(slowmode_seconds)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(channel)
    }

    /// Move a channel to a different category (or remove from category with None).
    pub async fn set_category(
        pool: &PgPool,
        id: Uuid,
        category_id: Option<Uuid>,
    ) -> Result<ChannelRow, JolkrError> {
        let now = Utc::now();
        let channel = sqlx::query_as::<_, ChannelRow>(
            r#"
            UPDATE channels
            SET category_id = $2,
                updated_at  = $3
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(category_id)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(channel)
    }

    /// Delete a channel.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query(r#"DELETE FROM channels WHERE id = $1"#)
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }
}
