use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::EmailVerificationRow;
use jolkr_common::JolkrError;

/// Repository for `emailverification` persistence.
pub struct EmailVerificationRepo;

impl EmailVerificationRepo {
    /// Insert a new email verification token (hashed).
    pub async fn create(
        pool: &PgPool,
        user_id: Uuid,
        token_hash: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<EmailVerificationRow, JolkrError> {
        let row = sqlx::query_as::<_, EmailVerificationRow>(
            "
            INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
            VALUES ($1, $2, $3)
            RETURNING *
            ",
        )
        .bind(user_id)
        .bind(token_hash)
        .bind(expires_at)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Look up a valid (not expired, not used) token by its hash.
    pub async fn get_by_token_hash(
        pool: &PgPool,
        token_hash: &str,
    ) -> Result<EmailVerificationRow, JolkrError> {
        let row = sqlx::query_as::<_, EmailVerificationRow>(
            "
            SELECT * FROM email_verification_tokens
            WHERE token_hash = $1
              AND expires_at > NOW()
              AND used_at IS NULL
            ",
        )
        .bind(token_hash)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Mark a token as used.
    pub async fn mark_used(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        sqlx::query(
            "UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1",
        )
        .bind(id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Delete all tokens for a user (cleanup after successful verification).
    pub async fn delete_for_user(pool: &PgPool, user_id: Uuid) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM email_verification_tokens WHERE user_id = $1")
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Mark a user's email as verified.
    pub async fn verify_user(pool: &PgPool, user_id: Uuid) -> Result<(), JolkrError> {
        sqlx::query("UPDATE users SET email_verified = true WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
