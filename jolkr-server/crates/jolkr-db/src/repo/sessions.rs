use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::SessionRow;
use jolkr_common::JolkrError;

/// Repository for `session` persistence.
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
            "
            INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            ",
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
            "
            SELECT * FROM sessions
            WHERE refresh_token_hash = $1 AND expires_at > NOW()
            ",
        )
        .bind(refresh_token_hash)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::Unauthorized)?;

        Ok(session)
    }

    /// Delete a single session.
    pub async fn delete_session(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM sessions WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Delete all sessions for a given user (e.g. password change, logout-all).
    pub async fn delete_all_for_user(pool: &PgPool, user_id: Uuid) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM sessions WHERE user_id = $1")
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Set a session to expire after a grace period instead of deleting it immediately.
    /// This allows the old refresh token to remain valid briefly in case the client
    /// didn't receive the new token pair (network hiccup, app backgrounded, etc.).
    pub async fn expire_session(pool: &PgPool, id: Uuid, grace_seconds: i64) -> Result<(), JolkrError> {
        sqlx::query(
            "UPDATE sessions SET expires_at = NOW() + make_interval(secs => $2) WHERE id = $1",
        )
        .bind(id)
        .bind(grace_seconds as f64)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Delete all expired sessions for a user to prevent session accumulation.
    pub async fn cleanup_expired(pool: &PgPool, user_id: Uuid) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < NOW()")
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
