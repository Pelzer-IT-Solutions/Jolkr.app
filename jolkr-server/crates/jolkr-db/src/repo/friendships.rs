use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::models::FriendshipRow;
use jolkr_common::JolkrError;

/// Friendship row joined with both participants' public user fields.
///
/// Used by `list_friends` / `list_pending` so the API can return embedded user
/// objects without an extra round-trip.
#[derive(Debug, Clone, FromRow)]
pub struct FriendshipWithUsersRow {
    /// Friendship identifier.
    pub id: Uuid,
    /// Requester user identifier.
    pub requester_id: Uuid,
    /// Addressee user identifier.
    pub addressee_id: Uuid,
    /// Current status.
    pub status: String,

    // ── Requester public fields (LEFT JOIN, may be NULL if user was deleted) ──
    /// Requester username.
    pub req_username: Option<String>,
    /// Requester display name.
    pub req_display_name: Option<String>,
    /// Requester avatar URL.
    pub req_avatar_url: Option<String>,

    // ── Addressee public fields ──
    /// Addressee username.
    pub addr_username: Option<String>,
    /// Addressee display name.
    pub addr_display_name: Option<String>,
    /// Addressee avatar URL.
    pub addr_avatar_url: Option<String>,
}

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

    /// Decline or remove. Returns the deleted row so callers (e.g. the API
    /// layer) can publish a WS event to both participants.
    pub async fn decline_or_remove(
        pool: &PgPool,
        friendship_id: Uuid,
        user_id: Uuid,
    ) -> Result<FriendshipRow, JolkrError> {
        let row = sqlx::query_as::<_, FriendshipRow>(
            "DELETE FROM friendships
               WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)
               RETURNING *",
        )
        .bind(friendship_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
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

    /// Lists accepted friends with both participants' public profile fields.
    pub async fn list_friends(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipWithUsersRow>, JolkrError> {
        let rows = sqlx::query_as::<_, FriendshipWithUsersRow>(
            "SELECT
                 f.id,
                 f.requester_id,
                 f.addressee_id,
                 f.status,
                 req.username      AS req_username,
                 req.display_name  AS req_display_name,
                 req.avatar_url    AS req_avatar_url,
                 addr.username     AS addr_username,
                 addr.display_name AS addr_display_name,
                 addr.avatar_url   AS addr_avatar_url
               FROM friendships f
               LEFT JOIN users req  ON req.id  = f.requester_id
               LEFT JOIN users addr ON addr.id = f.addressee_id
               WHERE (f.requester_id = $1 OR f.addressee_id = $1)
                 AND f.status = 'accepted'
               ORDER BY f.updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Returns `true` when an `accepted` friendship row exists between the
    /// two users, in either direction. Used by privacy gates such as DM
    /// filter `friends`.
    pub async fn are_friends(
        pool: &PgPool,
        user_a: Uuid,
        user_b: Uuid,
    ) -> Result<bool, JolkrError> {
        let row: Option<(Uuid,)> = sqlx::query_as(
            "SELECT id FROM friendships
               WHERE status = 'accepted'
                 AND ((requester_id = $1 AND addressee_id = $2)
                   OR (requester_id = $2 AND addressee_id = $1))
               LIMIT 1",
        )
        .bind(user_a)
        .bind(user_b)
        .fetch_optional(pool)
        .await?;
        Ok(row.is_some())
    }

    /// Lists pending requests addressed to the user, with both participants'
    /// public profile fields hydrated so the panel can render names + avatars
    /// without a follow-up batch fetch.
    pub async fn list_pending(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipWithUsersRow>, JolkrError> {
        let rows = sqlx::query_as::<_, FriendshipWithUsersRow>(
            "SELECT
                 f.id,
                 f.requester_id,
                 f.addressee_id,
                 f.status,
                 req.username      AS req_username,
                 req.display_name  AS req_display_name,
                 req.avatar_url    AS req_avatar_url,
                 addr.username     AS addr_username,
                 addr.display_name AS addr_display_name,
                 addr.avatar_url   AS addr_avatar_url
               FROM friendships f
               LEFT JOIN users req  ON req.id  = f.requester_id
               LEFT JOIN users addr ON addr.id = f.addressee_id
               WHERE (f.requester_id = $1 OR f.addressee_id = $1)
                 AND f.status = 'pending'
               ORDER BY f.created_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
