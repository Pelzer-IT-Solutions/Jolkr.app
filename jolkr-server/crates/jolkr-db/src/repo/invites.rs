use sqlx::PgPool;
use uuid::Uuid;

use crate::models::InviteRow;
use jolkr_common::JolkrError;

pub struct InviteRepo;

impl InviteRepo {
    pub async fn create_invite(
        pool: &PgPool,
        server_id: Uuid,
        creator_id: Uuid,
        code: &str,
        max_uses: Option<i32>,
        expires_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<InviteRow, JolkrError> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, InviteRow>(
            r#"INSERT INTO invites (id, server_id, creator_id, code, max_uses, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING *"#,
        )
        .bind(id)
        .bind(server_id)
        .bind(creator_id)
        .bind(code)
        .bind(max_uses)
        .bind(expires_at)
        .fetch_one(pool)
        .await?;
        Ok(row)
    }

    pub async fn get_by_id(
        pool: &PgPool,
        id: Uuid,
    ) -> Result<InviteRow, JolkrError> {
        let row = sqlx::query_as::<_, InviteRow>(
            r#"SELECT * FROM invites WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    pub async fn get_by_code(
        pool: &PgPool,
        code: &str,
    ) -> Result<InviteRow, JolkrError> {
        let row = sqlx::query_as::<_, InviteRow>(
            r#"SELECT * FROM invites
               WHERE code = $1
                 AND (expires_at IS NULL OR expires_at > NOW())
                 AND (max_uses IS NULL OR use_count < max_uses)"#,
        )
        .bind(code)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Atomically increment use_count only if still within limits (max_uses and expiry).
    /// Returns true if the increment succeeded, false if the invite is exhausted/expired.
    pub async fn use_invite(
        pool: &PgPool,
        invite_id: Uuid,
    ) -> Result<bool, JolkrError> {
        let result = sqlx::query(
            r#"UPDATE invites
               SET use_count = use_count + 1
               WHERE id = $1
                 AND (max_uses IS NULL OR use_count < max_uses)
                 AND (expires_at IS NULL OR expires_at > NOW())
            "#,
        )
        .bind(invite_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<InviteRow>, JolkrError> {
        let rows = sqlx::query_as::<_, InviteRow>(
            r#"SELECT * FROM invites
               WHERE server_id = $1
               ORDER BY created_at DESC"#,
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn delete_invite(
        pool: &PgPool,
        invite_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM invites WHERE id = $1")
            .bind(invite_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}
