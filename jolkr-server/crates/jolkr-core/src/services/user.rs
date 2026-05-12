use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use ts_rs::TS;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::UserRow;
use jolkr_db::repo::UserRepo;

/// Public user profile DTO (hides `password_hash`, `email` and other
/// internals). Returned by `/users/:id`, `/users/search`, `/users/batch`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename = "User")]
pub struct UserProfile {
    /// Unique identifier.
    pub id: Uuid,
    /// Login username.
    pub username: String,
    /// Optional display name shown in the UI.
    pub display_name: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
    /// Current status.
    pub status: Option<String>,
    /// Bio.
    pub bio: Option<String>,
    /// Whether the user is currently online.
    pub is_online: bool,
    /// Show read receipts.
    pub show_read_receipts: bool,
    /// Whether this is a system-generated entity.
    pub is_system: bool,
    /// Email verified.
    pub email_verified: bool,
    /// Banner color.
    pub banner_color: Option<String>,
    /// Privacy: who can start a new DM with this user (`all` | `friends` | `none`).
    pub dm_filter: String,
    /// Privacy: whether others can send friend requests to this user.
    pub allow_friend_requests: bool,
    /// Account creation timestamp. Public — drives the "joined" date in
    /// profile cards. Discord exposes the same; not privacy-sensitive.
    pub created_at: DateTime<Utc>,
    /// Preferred UI language (BCP-47 lite). Public so peer surfaces *could*
    /// adapt — but in practice consumers use it only for the self-profile
    /// to drive the FE locale store.
    pub preferred_language: Option<String>,
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
            show_read_receipts: row.show_read_receipts,
            is_system: row.is_system,
            email_verified: row.email_verified,
            banner_color: row.banner_color,
            dm_filter: row.dm_filter,
            allow_friend_requests: row.allow_friend_requests,
            created_at: row.created_at,
            preferred_language: row.preferred_language,
        }
    }
}

/// Self-profile DTO returned exclusively by `/users/@me` (GET + PATCH). Adds
/// the privacy-sensitive `email` on top of the public `UserProfile` so it
/// never leaks via lookups for other users.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct MeProfile {
    /// Unique identifier.
    pub id: Uuid,
    /// Email address (only exposed for the authenticated user).
    pub email: String,
    /// Login username.
    pub username: String,
    /// Optional display name shown in the UI.
    pub display_name: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
    /// Current status.
    pub status: Option<String>,
    /// Bio.
    pub bio: Option<String>,
    /// Whether the user is currently online.
    pub is_online: bool,
    /// Show read receipts.
    pub show_read_receipts: bool,
    /// Whether this is a system-generated entity.
    pub is_system: bool,
    /// Email verified.
    pub email_verified: bool,
    /// Banner color.
    pub banner_color: Option<String>,
    /// Privacy: who can start a new DM with this user (`all` | `friends` | `none`).
    pub dm_filter: String,
    /// Privacy: whether others can send friend requests to this user.
    pub allow_friend_requests: bool,
    /// Account creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Preferred UI language (BCP-47 lite) — drives the FE locale store on
    /// boot and is mirrored into all the user's sessions via WS UserUpdate.
    pub preferred_language: Option<String>,
}

impl From<UserRow> for MeProfile {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            email: row.email,
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            status: row.status,
            bio: row.bio,
            is_online: row.is_online,
            show_read_receipts: row.show_read_receipts,
            is_system: row.is_system,
            email_verified: row.email_verified,
            banner_color: row.banner_color,
            dm_filter: row.dm_filter,
            allow_friend_requests: row.allow_friend_requests,
            created_at: row.created_at,
            preferred_language: row.preferred_language,
        }
    }
}

/// Fields that may be updated on a user profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    /// Optional display name shown in the UI.
    pub display_name: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
    /// Current status.
    pub status: Option<String>,
    /// Bio.
    pub bio: Option<String>,
    /// Show read receipts.
    pub show_read_receipts: Option<bool>,
    /// Banner color.
    pub banner_color: Option<String>,
    /// Privacy: DM filter (`all` | `friends` | `none`).
    pub dm_filter: Option<String>,
    /// Privacy: whether others can send friend requests to this user.
    pub allow_friend_requests: Option<bool>,
    /// Preferred UI language (BCP-47 lite). Whitelist enforcement happens
    /// at the API layer before this struct is built; the service trusts it.
    pub preferred_language: Option<String>,
}

/// Domain service for `user` operations.
pub struct UserService;

impl UserService {
    /// Fetch the full profile for the given user ID.
    #[tracing::instrument(skip(pool))]
    pub async fn get_profile(pool: &PgPool, user_id: Uuid) -> Result<UserProfile, JolkrError> {
        let row = UserRepo::get_by_id(pool, user_id).await?;
        Ok(UserProfile::from(row))
    }

    /// Fetch the self-profile (includes `email`) for the authenticated user.
    #[tracing::instrument(skip(pool))]
    pub async fn get_me(pool: &PgPool, user_id: Uuid) -> Result<MeProfile, JolkrError> {
        let row = UserRepo::get_by_id(pool, user_id).await?;
        Ok(MeProfile::from(row))
    }

    /// Update mutable profile fields and return the self-profile shape so the
    /// caller can refresh its own auth state without a follow-up `get_me`.
    #[tracing::instrument(skip(pool, req))]
    pub async fn update_me(
        pool: &PgPool,
        user_id: Uuid,
        req: UpdateProfileRequest,
    ) -> Result<MeProfile, JolkrError> {
        Self::update_profile(pool, user_id, req).await?;
        Self::get_me(pool, user_id).await
    }

    /// Update mutable profile fields for the calling user.
    #[tracing::instrument(skip(pool, req))]
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
        if let Some(ref dm_filter) = req.dm_filter {
            if !matches!(dm_filter.as_str(), "all" | "friends" | "none") {
                return Err(JolkrError::Validation(
                    "dm_filter must be one of: all, friends, none".into(),
                ));
            }
        }
        let row = UserRepo::update_user(
            pool,
            user_id,
            req.display_name.as_deref(),
            req.avatar_url.as_deref(),
            req.status.as_deref(),
            req.bio.as_deref(),
            req.show_read_receipts,
            req.banner_color.as_deref(),
            req.dm_filter.as_deref(),
            req.allow_friend_requests,
            req.preferred_language.as_deref(),
        )
        .await?;
        Ok(UserProfile::from(row))
    }

    /// Fetch profiles for multiple user IDs in a single query (batch).
    #[tracing::instrument(skip(pool, user_ids), fields(count = user_ids.len()))]
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

    /// Search users by exact username or email match.
    #[tracing::instrument(skip(pool, query))]
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
