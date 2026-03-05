use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::UserRow;
use jolkr_db::repo::UserRepo;

/// Public user profile DTO (hides password_hash and other internals).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub bio: Option<String>,
    pub is_online: bool,
}

impl From<UserRow> for UserProfile {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            status: row.status,
            bio: row.bio,
            is_online: row.is_online,
        }
    }
}

/// Fields that may be updated on a user profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub bio: Option<String>,
}

pub struct UserService;

impl UserService {
    /// Fetch the full profile for the given user ID.
    pub async fn get_profile(pool: &PgPool, user_id: Uuid) -> Result<UserProfile, JolkrError> {
        let row = UserRepo::get_by_id(pool, user_id).await?;
        Ok(UserProfile::from(row))
    }

    /// Update mutable profile fields for the calling user.
    pub async fn update_profile(
        pool: &PgPool,
        user_id: Uuid,
        req: UpdateProfileRequest,
    ) -> Result<UserProfile, JolkrError> {
        if let Some(ref name) = req.display_name {
            if name.len() > 100 {
                return Err(JolkrError::Validation("display_name must be at most 100 characters".into()));
            }
        }
        if let Some(ref status) = req.status {
            if status.len() > 128 {
                return Err(JolkrError::Validation("status must be at most 128 characters".into()));
            }
        }
        if let Some(ref bio) = req.bio {
            if bio.len() > 2000 {
                return Err(JolkrError::Validation("bio must be at most 2000 characters".into()));
            }
        }
        let row = UserRepo::update_user(
            pool,
            user_id,
            req.display_name.as_deref(),
            req.avatar_url.as_deref(),
            req.status.as_deref(),
            req.bio.as_deref(),
        )
        .await?;
        Ok(UserProfile::from(row))
    }

    /// Fetch profiles for multiple user IDs in a single query (batch).
    pub async fn get_profiles_batch(
        pool: &PgPool,
        user_ids: &[Uuid],
    ) -> Result<Vec<UserProfile>, JolkrError> {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }
        // Cap at 100 to prevent abuse
        let ids: &[Uuid] = if user_ids.len() > 100 { &user_ids[..100] } else { user_ids };
        let rows = UserRepo::get_by_ids(pool, ids).await?;
        Ok(rows.into_iter().map(UserProfile::from).collect())
    }

    /// Search users by username prefix (returns max 25 results).
    pub async fn search_users(
        pool: &PgPool,
        query: &str,
    ) -> Result<Vec<UserProfile>, JolkrError> {
        if query.is_empty() {
            return Err(JolkrError::Validation("Search query is required".into()));
        }
        let rows = UserRepo::search_by_username(pool, query).await?;
        Ok(rows.into_iter().map(UserProfile::from).collect())
    }
}
