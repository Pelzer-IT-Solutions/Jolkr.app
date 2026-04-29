use sqlx::PgPool;
use uuid::Uuid;

use crate::models::FriendshipRow;
use jolkr_common::JolkrError;

/// Repository for `friendship` persistence.
pub struct FriendshipRepo;

impl FriendshipRepo {
    /// Sends request.
    pub async fn send_request(
        pool: &PgPool,
        requester_id: Uuid,
        addressee_id: Uuid,
    ) -> Result<FriendshipRow, JolkrError> {
        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, FriendshipRow>(
            "INSERT INTO friendships (id, requester_id, addressee_id, status)
               VALUES ($1, $2, $3, 'pending')
               RETURNING *",
        )
        .bind(id)
        .bind(requester_id)
        .bind(addressee_id)
        .fetch_one(pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db_err) if db_err.is_unique_violation() => {
                JolkrError::Conflict("Friend request already exists".into())
            }
            _ => JolkrError::Database(e),
        })?;
        Ok(row)
    }

    /// Accept request.
    pub async fn accept_request(
        pool: &PgPool,
        friendship_id: Uuid,
        addressee_id: Uuid,
    ) -> Result<FriendshipRow, JolkrError> {
        let row = sqlx::query_as::<_, FriendshipRow>(
            "UPDATE friendships
               SET status = 'accepted', updated_at = NOW()
               WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
               RETURNING *",
        )
        .bind(friendship_id)
        .bind(addressee_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Decline or remove.
    pub async fn decline_or_remove(
        pool: &PgPool,
        friendship_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let result = sqlx::query(
            "DELETE FROM friendships
               WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)",
        )
        .bind(friendship_id)
        .bind(user_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }

    /// Block user.
    pub async fn block_user(
        pool: &PgPool,
        blocker_id: Uuid,
        blocked_id: Uuid,
    ) -> Result<FriendshipRow, JolkrError> {
        let mut tx = pool.begin().await?;

        // Remove any existing friendship first
        sqlx::query(
            "DELETE FROM friendships
               WHERE (requester_id = $1 AND addressee_id = $2)
                  OR (requester_id = $2 AND addressee_id = $1)",
        )
        .bind(blocker_id)
        .bind(blocked_id)
        .execute(&mut *tx)
        .await?;

        let id = Uuid::new_v4();
        let row = sqlx::query_as::<_, FriendshipRow>(
            "INSERT INTO friendships (id, requester_id, addressee_id, status)
               VALUES ($1, $2, $3, 'blocked')
               RETURNING *",
        )
        .bind(id)
        .bind(blocker_id)
        .bind(blocked_id)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(row)
    }

    /// Lists friends.
    pub async fn list_friends(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipRow>, JolkrError> {
        let rows = sqlx::query_as::<_, FriendshipRow>(
            "SELECT * FROM friendships
               WHERE (requester_id = $1 OR addressee_id = $1)
                 AND status = 'accepted'
               ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Lists pending.
    pub async fn list_pending(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipRow>, JolkrError> {
        let rows = sqlx::query_as::<_, FriendshipRow>(
            "SELECT * FROM friendships
               WHERE addressee_id = $1 AND status = 'pending'
               ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
