use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::UserRow;
use jolkr_common::JolkrError;

/// Escape SQL LIKE metacharacters (`%`, `_`, `\`) in user input.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub struct UserRepo;

impl UserRepo {
    /// Insert a new user row.
    pub async fn create_user(
        pool: &PgPool,
        id: Uuid,
        email: &str,
        username: &str,
        password_hash: &str,
    ) -> Result<UserRow, JolkrError> {
        let now = Utc::now();
        let user = sqlx::query_as::<_, UserRow>(
            r#"
            INSERT INTO users (id, email, username, password_hash, is_online, created_at, updated_at)
            VALUES ($1, $2, $3, $4, false, $5, $5)
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(email)
        .bind(username)
        .bind(password_hash)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(user)
    }

    /// Find a user by their UUID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<UserRow, JolkrError> {
        let user = sqlx::query_as::<_, UserRow>(
            r#"SELECT * FROM users WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(user)
    }

    /// Find a user by email address (case-insensitive).
    pub async fn get_by_email(pool: &PgPool, email: &str) -> Result<UserRow, JolkrError> {
        let user = sqlx::query_as::<_, UserRow>(
            r#"SELECT * FROM users WHERE LOWER(email) = LOWER($1)"#,
        )
        .bind(email)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(user)
    }

    /// Find a user by username.
    pub async fn get_by_username(pool: &PgPool, username: &str) -> Result<UserRow, JolkrError> {
        let user = sqlx::query_as::<_, UserRow>(
            r#"SELECT * FROM users WHERE username = $1"#,
        )
        .bind(username)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(user)
    }

    /// Update mutable user profile fields.
    pub async fn update_user(
        pool: &PgPool,
        id: Uuid,
        display_name: Option<&str>,
        avatar_url: Option<&str>,
        status: Option<&str>,
        bio: Option<&str>,
        show_read_receipts: Option<bool>,
    ) -> Result<UserRow, JolkrError> {
        let now = Utc::now();
        let user = sqlx::query_as::<_, UserRow>(
            r#"
            UPDATE users
            SET display_name       = COALESCE($2, display_name),
                avatar_url         = COALESCE($3, avatar_url),
                status             = COALESCE($4, status),
                bio                = COALESCE($5, bio),
                show_read_receipts = COALESCE($6, show_read_receipts),
                updated_at         = $7
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(display_name)
        .bind(avatar_url)
        .bind(status)
        .bind(bio)
        .bind(show_read_receipts)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(user)
    }

    /// Update a user's password hash.
    pub async fn update_password(
        pool: &PgPool,
        id: Uuid,
        password_hash: &str,
    ) -> Result<(), JolkrError> {
        let now = Utc::now();
        let result = sqlx::query(
            r#"UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1"#,
        )
        .bind(id)
        .bind(password_hash)
        .bind(now)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    /// Delete a user (hard delete).
    pub async fn delete_user(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query(r#"DELETE FROM users WHERE id = $1"#)
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    /// Find multiple users by their UUIDs (batch fetch).
    pub async fn get_by_ids(pool: &PgPool, ids: &[Uuid]) -> Result<Vec<UserRow>, JolkrError> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let users = sqlx::query_as::<_, UserRow>(
            r#"SELECT * FROM users WHERE id = ANY($1)"#,
        )
        .bind(ids)
        .fetch_all(pool)
        .await?;

        Ok(users)
    }

    /// Search users by username prefix (LIKE) or exact email match.
    /// Returns results only when specific enough (≤ 3 matches), otherwise empty.
    pub async fn search_by_username(
        pool: &PgPool,
        query: &str,
    ) -> Result<Vec<UserRow>, JolkrError> {
        let pattern = format!("{}%", escape_like(query));
        let users = sqlx::query_as::<_, UserRow>(
            r#"
            SELECT * FROM users
            WHERE LOWER(username) LIKE LOWER($1)
               OR LOWER(email) = LOWER($2)
            ORDER BY username ASC
            LIMIT 4
            "#,
        )
        .bind(&pattern)
        .bind(query)
        .fetch_all(pool)
        .await?;

        // Too many matches → query not specific enough
        if users.len() > 3 {
            return Ok(vec![]);
        }

        Ok(users)
    }

    /// Set the online status and last_seen timestamp.
    pub async fn set_online_status(
        pool: &PgPool,
        id: Uuid,
        is_online: bool,
    ) -> Result<(), JolkrError> {
        let now = Utc::now();
        sqlx::query(
            r#"
            UPDATE users SET is_online = $2, last_seen_at = $3, updated_at = $3
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(is_online)
        .bind(now)
        .execute(pool)
        .await?;

        Ok(())
    }
}
