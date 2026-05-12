use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::FriendshipRow;
use jolkr_db::repo::friendships::FriendshipWithUsersRow;
use jolkr_db::repo::FriendshipRepo;

/// Minimal public profile fields embedded inside a `FriendshipInfo` so the
/// frontend can render names + avatars in one round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendshipUser {
    /// User identifier.
    pub id: Uuid,
    /// Login username.
    pub username: String,
    /// Optional display name.
    pub display_name: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
}

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
    /// Requester public profile (populated on list endpoints; `None` for
    /// row-only conversions such as the response of `send_request`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requester: Option<FriendshipUser>,
    /// Addressee public profile (populated on list endpoints).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addressee: Option<FriendshipUser>,
}

impl From<FriendshipRow> for FriendshipInfo {
    fn from(row: FriendshipRow) -> Self {
        Self {
            id: row.id,
            requester_id: row.requester_id,
            addressee_id: row.addressee_id,
            status: row.status,
            requester: None,
            addressee: None,
        }
    }
}

impl From<FriendshipWithUsersRow> for FriendshipInfo {
    fn from(row: FriendshipWithUsersRow) -> Self {
        let requester = row.req_username.map(|username| FriendshipUser {
            id: row.requester_id,
            username,
            display_name: row.req_display_name,
            avatar_url: row.req_avatar_url,
        });
        let addressee = row.addr_username.map(|username| FriendshipUser {
            id: row.addressee_id,
            username,
            display_name: row.addr_display_name,
            avatar_url: row.addr_avatar_url,
        });
        Self {
            id: row.id,
            requester_id: row.requester_id,
            addressee_id: row.addressee_id,
            status: row.status,
            requester,
            addressee,
        }
    }
}

/// Domain service for `friendship` operations.
pub struct FriendshipService;

impl FriendshipService {
    /// Sends request.
    #[tracing::instrument(skip(pool))]
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

        // Verify addressee exists + enforce their friend-request privacy gate.
        // BadRequest is used (instead of unit-only Forbidden) so the message
        // reaches the user-facing toast.
        let addressee = jolkr_db::repo::UserRepo::get_by_id(pool, addressee_id).await?;
        if !addressee.allow_friend_requests {
            return Err(JolkrError::BadRequest(
                "This user is not accepting friend requests".into(),
            ));
        }

        let row = FriendshipRepo::send_request(pool, requester_id, addressee_id).await?;
        Ok(FriendshipInfo::from(row))
    }

    /// Accept request.
    #[tracing::instrument(skip(pool))]
    pub async fn accept_request(
        pool: &PgPool,
        friendship_id: Uuid,
        caller_id: Uuid,
    ) -> Result<FriendshipInfo, JolkrError> {
        let row = FriendshipRepo::accept_request(pool, friendship_id, caller_id).await?;
        Ok(FriendshipInfo::from(row))
    }

    /// Decline or remove. Returns the deleted friendship so the caller can
    /// publish a WS event to both participants before forgetting about it.
    #[tracing::instrument(skip(pool))]
    pub async fn decline_or_remove(
        pool: &PgPool,
        friendship_id: Uuid,
        caller_id: Uuid,
    ) -> Result<FriendshipInfo, JolkrError> {
        let row = FriendshipRepo::decline_or_remove(pool, friendship_id, caller_id).await?;
        Ok(FriendshipInfo::from(row))
    }

    /// Block user.
    #[tracing::instrument(skip(pool))]
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
    #[tracing::instrument(skip(pool))]
    pub async fn list_friends(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipInfo>, JolkrError> {
        let rows = FriendshipRepo::list_friends(pool, user_id).await?;
        Ok(rows.into_iter().map(FriendshipInfo::from).collect())
    }

    /// Lists pending.
    #[tracing::instrument(skip(pool))]
    pub async fn list_pending(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<FriendshipInfo>, JolkrError> {
        let rows = FriendshipRepo::list_pending(pool, user_id).await?;
        Ok(rows.into_iter().map(FriendshipInfo::from).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_with_users_row_populates_both_participants() {
        let req_id = Uuid::new_v4();
        let addr_id = Uuid::new_v4();
        let row = FriendshipWithUsersRow {
            id: Uuid::new_v4(),
            requester_id: req_id,
            addressee_id: addr_id,
            status: "accepted".into(),
            req_username: Some("alice".into()),
            req_display_name: Some("Alice".into()),
            req_avatar_url: Some("https://cdn/a.png".into()),
            addr_username: Some("bob".into()),
            addr_display_name: None,
            addr_avatar_url: None,
        };
        let info = FriendshipInfo::from(row);
        let req = info.requester.expect("requester populated");
        assert_eq!(req.id, req_id);
        assert_eq!(req.username, "alice");
        assert_eq!(req.display_name.as_deref(), Some("Alice"));
        assert_eq!(req.avatar_url.as_deref(), Some("https://cdn/a.png"));
        let addr = info.addressee.expect("addressee populated");
        assert_eq!(addr.id, addr_id);
        assert_eq!(addr.username, "bob");
        assert!(addr.display_name.is_none());
        assert!(addr.avatar_url.is_none());
    }

    #[test]
    fn from_with_users_row_handles_deleted_user() {
        let row = FriendshipWithUsersRow {
            id: Uuid::new_v4(),
            requester_id: Uuid::new_v4(),
            addressee_id: Uuid::new_v4(),
            status: "pending".into(),
            req_username: Some("alice".into()),
            req_display_name: None,
            req_avatar_url: None,
            // addressee user was deleted -> all join columns NULL
            addr_username: None,
            addr_display_name: None,
            addr_avatar_url: None,
        };
        let info = FriendshipInfo::from(row);
        assert!(info.requester.is_some());
        assert!(info.addressee.is_none(), "deleted user yields None");
    }

    #[test]
    fn from_friendship_row_leaves_users_none() {
        let row = FriendshipRow {
            id: Uuid::new_v4(),
            requester_id: Uuid::new_v4(),
            addressee_id: Uuid::new_v4(),
            status: "pending".into(),
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        let info = FriendshipInfo::from(row);
        assert!(info.requester.is_none());
        assert!(info.addressee.is_none());
    }

    #[test]
    fn serializes_with_nested_user_objects() {
        let info = FriendshipInfo {
            id: Uuid::nil(),
            requester_id: Uuid::nil(),
            addressee_id: Uuid::nil(),
            status: "accepted".into(),
            requester: Some(FriendshipUser {
                id: Uuid::nil(),
                username: "alice".into(),
                display_name: Some("Alice".into()),
                avatar_url: None,
            }),
            addressee: Some(FriendshipUser {
                id: Uuid::nil(),
                username: "bob".into(),
                display_name: None,
                avatar_url: None,
            }),
        };
        let json = serde_json::to_value(&info).expect("serialize");
        assert_eq!(json["requester"]["username"], "alice");
        assert_eq!(json["requester"]["display_name"], "Alice");
        assert_eq!(json["addressee"]["username"], "bob");
        assert!(json["addressee"]["display_name"].is_null());
    }
}
