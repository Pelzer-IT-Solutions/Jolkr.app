use sqlx::PgPool;
use uuid::Uuid;

use crate::models::WebhookRow;
use jolkr_common::JolkrError;

pub struct WebhookRepo;

impl WebhookRepo {
    /// Create a new webhook.
    pub async fn create(
        pool: &PgPool,
        id: Uuid,
        channel_id: Uuid,
        server_id: Uuid,
        creator_id: Uuid,
        name: &str,
        avatar_url: Option<&str>,
        token: &str,
    ) -> Result<WebhookRow, JolkrError> {
        let webhook = sqlx::query_as::<_, WebhookRow>(
            r#"
            INSERT INTO webhooks (id, channel_id, server_id, creator_id, name, avatar_url, token)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(channel_id)
        .bind(server_id)
        .bind(creator_id)
        .bind(name)
        .bind(avatar_url)
        .bind(token)
        .fetch_one(pool)
        .await?;

        Ok(webhook)
    }

    /// Get a webhook by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<WebhookRow, JolkrError> {
        sqlx::query_as::<_, WebhookRow>("SELECT * FROM webhooks WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or(JolkrError::NotFound)
    }

    /// Get a webhook by token.
    pub async fn get_by_token(pool: &PgPool, token: &str) -> Result<WebhookRow, JolkrError> {
        sqlx::query_as::<_, WebhookRow>("SELECT * FROM webhooks WHERE token = $1")
            .bind(token)
            .fetch_optional(pool)
            .await?
            .ok_or(JolkrError::NotFound)
    }

    /// List webhooks for a channel.
    pub async fn list_for_channel(pool: &PgPool, channel_id: Uuid) -> Result<Vec<WebhookRow>, JolkrError> {
        let webhooks = sqlx::query_as::<_, WebhookRow>(
            "SELECT * FROM webhooks WHERE channel_id = $1 ORDER BY created_at ASC"
        )
        .bind(channel_id)
        .fetch_all(pool)
        .await?;
        Ok(webhooks)
    }

    /// Update a webhook.
    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        name: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Result<WebhookRow, JolkrError> {
        let now = chrono::Utc::now();
        let webhook = sqlx::query_as::<_, WebhookRow>(
            r#"
            UPDATE webhooks SET
                name = COALESCE($2, name),
                avatar_url = COALESCE($3, avatar_url),
                updated_at = $4
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(avatar_url)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(webhook)
    }

    /// Delete a webhook.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query("DELETE FROM webhooks WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    /// Regenerate token.
    pub async fn regenerate_token(pool: &PgPool, id: Uuid, new_token: &str) -> Result<WebhookRow, JolkrError> {
        let now = chrono::Utc::now();
        let webhook = sqlx::query_as::<_, WebhookRow>(
            r#"UPDATE webhooks SET token = $2, updated_at = $3 WHERE id = $1 RETURNING *"#,
        )
        .bind(id)
        .bind(new_token)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(webhook)
    }
}
