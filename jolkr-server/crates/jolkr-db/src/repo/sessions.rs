use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::SessionRow;
use jolkr_common::JolkrError;

pub struct SessionRepo;

impl SessionRepo {
    /// Create a new session (stores a hashed refresh token).
    pub async fn create_session(
        pool: &PgPool,
        id: Uuid,
        user_id: Uuid,
        device_id: Option<Uuid>,
        refresh_token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<SessionRow, JolkrError> {
        let now = Utc::now();
        let session = sqlx::query_as::<_, SessionRow>(
            r#"
            INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(user_id)
        .bind(device_id)
        .bind(refresh_token_hash)
        .bind(expires_at)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(session)
    }

    /// Look up a session by its hashed refresh token.
    pub async fn get_by_token(
        pool: &PgPool,
        refresh_token_hash: &str,
    ) -> Result<SessionRow, JolkrError> {
        let session = sqlx::query_as::<_, SessionRow>(
            r#"
            SELECT * FROM sessions
            WHERE refresh_token_hash = $1 AND expires_at > NOW()
            "#,
        )
        .bind(refresh_token_hash)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::Unauthorized)?;

        Ok(session)
    }

    /// Delete a single session.
    pub async fn delete_session(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        sqlx::query(r#"DELETE FROM sessions WHERE id = $1"#)
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Delete all sessions for a given user (e.g. password change, logout-all).
    pub async fn delete_all_for_user(pool: &PgPool, user_id: Uuid) -> Result<(), JolkrError> {
        sqlx::query(r#"DELETE FROM sessions WHERE user_id = $1"#)
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
