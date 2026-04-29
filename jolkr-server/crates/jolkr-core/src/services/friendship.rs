use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::FriendshipRow;
use jolkr_db::repo::FriendshipRepo;

/// Public information about `friendship`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendshipInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Requesting user identifier.
    pub requester_id: Uuid,
    /// Addressee user identifier.
    pub addressee_id: Uuid,
    /// Current status.
    pub status: String,
}

impl From<FriendshipRow> for FriendshipInfo {
    fn from(row: FriendshipRow) -> Self {
        Self {
            id: row.id,
            requester_id: row.requester_id,
            addressee_id: row.addressee_id,
            status: row.status,
        }
    }
}

/// Domain service for `friendship` operations.
pub struct FriendshipService;

impl FriendshipService {
    /// Sends request.
    pub async fn send_request(
        pool: &PgPool,
        requester_id: Uuid,
        addressee_id: Uuid,
    ) -> Result<FriendshipInfo, JolkrError> {
        if requester_id == addressee_id {
            return Err(JolkrError::BadRequest(
                "Cannot send friend request to yourself".into(),
            ));
        }

        // Verify addressee exists
        jolkr_db::repo::UserRepo::get_by_id(pool, addressee_id).await?;

        let row = FriendshipRepo::send_request(pool, requester_id, addressee_id).await?;
        Ok(FriendshipInfo::from(row))
    }

    /// Accept request.
    pub async fn accept_request(
        pool: &PgPool,
        friendship_id: Uuid,
        caller_id: Uuid,
    ) -> Result<FriendshipInfo, JolkrError> {
        let row = FriendshipRepo::accept_request(pool, friendship_id, caller_id).await?;
        Ok(FriendshipInfo::from(row))
    }

    /// Decline or remove.
    pub async fn decline_or_remove(
        pool: &PgPool,
        friendship_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        FriendshipRepo::decline_or_remove(pool, friendship_id, caller_id).await
    }

    /// Block user.
    pub async fn block_user(
        pool: &PgPool,
        blocker_id: Uuid,
        blocked_id: Uuid,
    ) -> Result<FriendshipInfo, JolkrError> {
        if blocker_id == blocked_id {
            return Err(JolkrError::BadRequest("Cannot block yourself".into()));
        }
        let row = FriendshipRepo::block_user(pool, blocker_id, blocked_id).await?;
        Ok(FriendshipInfo::from(row))
    }

    /// Lists friends.
    pub async fn list_friends(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipInfo>, JolkrError> {
        let rows = FriendshipRepo::list_friends(pool, user_id).await?;
        Ok(rows.into_iter().map(FriendshipInfo::from).collect())
    }

    /// Lists pending.
    pub async fn list_pending(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipInfo>, JolkrError> {
        let rows = FriendshipRepo::list_pending(pool, user_id).await?;
        Ok(rows.into_iter().map(FriendshipInfo::from).collect())
    }
}
