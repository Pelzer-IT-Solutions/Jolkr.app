use sqlx::PgPool;
use uuid::Uuid;

use crate::models::BanRow;
use jolkr_common::JolkrError;

/// Repository for `ban` persistence.
pub struct BanRepo;

impl BanRepo {
    /// Create a ban and remove the user from the server members in one transaction.
    pub async fn create_ban(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        banned_by: Uuid,
        reason: Option<&str>,
    ) -> Result<BanRow, JolkrError> {
        let mut tx = pool.begin().await?;

        let ban = sqlx::query_as::<_, BanRow>(
            "INSERT INTO server_bans (server_id, user_id, banned_by, reason)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (server_id, user_id) DO NOTHING
               RETURNING *",
        )
        .bind(server_id)
        .bind(user_id)
        .bind(banned_by)
        .bind(reason)
        .fetch_optional(&mut *tx)
        .await?;

        let ban = match ban {
            Some(b) => b,
            None => return Err(JolkrError::Conflict("User is already banned".into())),
        };

        // Remove from members
        sqlx::query("DELETE FROM members WHERE server_id = $1 AND user_id = $2")
            .bind(server_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(ban)
    }

    /// Remove a ban (unban).
    pub async fn remove_ban(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let result = sqlx::query(
            "DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2",
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

    /// Check if a user is banned from a server.
    pub async fn is_banned(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, JolkrError> {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM server_bans WHERE server_id = $1 AND user_id = $2)",
        )
        .bind(server_id)
        .bind(user_id)
        .fetch_one(pool)
        .await?;

        Ok(exists)
    }

    /// List all bans for a server.
    pub async fn list_bans(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<BanRow>, JolkrError> {
        let bans = sqlx::query_as::<_, BanRow>(
            "SELECT * FROM server_bans WHERE server_id = $1 ORDER BY created_at DESC",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(bans)
    }
}
