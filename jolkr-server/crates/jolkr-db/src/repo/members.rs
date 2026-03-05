use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::MemberRow;
use jolkr_common::JolkrError;

pub struct MemberRepo;

impl MemberRepo {
    /// Add a user as a member of a server.
    pub async fn add_member(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<MemberRow, JolkrError> {
        let id = Uuid::new_v4();
        let now = Utc::now();

        // Use INSERT ON CONFLICT to avoid TOCTOU race condition
        let member = sqlx::query_as::<_, MemberRow>(
            r#"
            INSERT INTO members (id, server_id, user_id, joined_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (server_id, user_id) DO NOTHING
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(server_id)
        .bind(user_id)
        .bind(now)
        .fetch_optional(pool)
        .await?;

        match member {
            Some(m) => Ok(m),
            None => Err(JolkrError::Conflict("User is already a member".into())),
        }
    }

    /// Remove a member from a server.
    pub async fn remove_member(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let result = sqlx::query(
            r#"DELETE FROM members WHERE server_id = $1 AND user_id = $2"#,
        )
        .bind(server_id)
        .bind(user_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    /// Get a specific member record.
    pub async fn get_member(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<MemberRow, JolkrError> {
        let member = sqlx::query_as::<_, MemberRow>(
            r#"SELECT * FROM members WHERE server_id = $1 AND user_id = $2"#,
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(member)
    }

    /// List all members in a server.
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<MemberRow>, JolkrError> {
        let members = sqlx::query_as::<_, MemberRow>(
            r#"
            SELECT * FROM members
            WHERE server_id = $1
            ORDER BY joined_at ASC
            "#,
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(members)
    }

    /// List all server IDs a user is a member of (for WS auto-subscribe).
    pub async fn list_server_ids_for_user(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<Uuid>, JolkrError> {
        let ids: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT server_id FROM members WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(ids.into_iter().map(|(id,)| id).collect())
    }

    /// Update a member's nickname.
    pub async fn update_nickname(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        nickname: Option<&str>,
    ) -> Result<MemberRow, JolkrError> {
        let member = sqlx::query_as::<_, MemberRow>(
            r#"
            UPDATE members SET nickname = $3
            WHERE server_id = $1 AND user_id = $2
            RETURNING *
            "#,
        )
        .bind(server_id)
        .bind(user_id)
        .bind(nickname)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(member)
    }

    /// Set a timeout on a member (restricts sending messages, reactions, voice).
    pub async fn set_timeout(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        timeout_until: Option<DateTime<Utc>>,
    ) -> Result<MemberRow, JolkrError> {
        let member = sqlx::query_as::<_, MemberRow>(
            r#"
            UPDATE members SET timeout_until = $3
            WHERE server_id = $1 AND user_id = $2
            RETURNING *
            "#,
        )
        .bind(server_id)
        .bind(user_id)
        .bind(timeout_until)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(member)
    }

    /// Check if a member is currently timed out.
    pub async fn is_timed_out(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, JolkrError> {
        let row: Option<(bool,)> = sqlx::query_as(
            r#"
            SELECT timeout_until IS NOT NULL AND timeout_until > NOW() as timed_out
            FROM members
            WHERE server_id = $1 AND user_id = $2
            "#,
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| r.0).unwrap_or(false))
    }
}
