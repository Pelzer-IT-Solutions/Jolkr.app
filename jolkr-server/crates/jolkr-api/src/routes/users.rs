use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::UserService;
use crate::routes::attachments::PRESIGN_EXPIRY_SECS;
use jolkr_core::services::user::{MeProfile, UpdateProfileRequest, UserProfile};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub(crate) struct UserResponse {
    pub user: UserProfile,
}

/// Response for `/users/@me` — adds `email` on top of the public profile.
#[derive(Debug, Serialize)]
pub(crate) struct MeResponse {
    pub user: MeProfile,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateMeRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub bio: Option<String>,
    pub show_read_receipts: Option<bool>,
    pub banner_color: Option<String>,
    pub dm_filter: Option<String>,
    pub allow_friend_requests: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SearchQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BatchUsersRequest {
    pub ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub(crate) struct UsersResponse {
    pub users: Vec<UserProfile>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// Re-presign avatar_url if it looks like an S3 key (not a full URL).
async fn presign_avatar(state: &AppState, profile: &mut UserProfile) {
    if let Some(ref avatar) = profile.avatar_url {
        // S3 keys start with "uploads/" or similar, not "http"
        if !avatar.starts_with("http") {
            if let Ok(url) = state.storage.presign_get(avatar, PRESIGN_EXPIRY_SECS).await {
                profile.avatar_url = Some(url);
            }
        }
    }
}

/// Re-presign avatar_url for the self-profile shape.
async fn presign_avatar_me(state: &AppState, profile: &mut MeProfile) {
    if let Some(ref avatar) = profile.avatar_url {
        if !avatar.starts_with("http") {
            if let Ok(url) = state.storage.presign_get(avatar, PRESIGN_EXPIRY_SECS).await {
                profile.avatar_url = Some(url);
            }
        }
    }
}

/// GET /api/users/@me
pub(crate) async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<MeResponse>, AppError> {
    let mut profile = UserService::get_me(&state.pool, auth.user_id).await?;
    presign_avatar_me(&state, &mut profile).await;
    Ok(Json(MeResponse { user: profile }))
}

/// PATCH /api/users/@me
pub(crate) async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateMeRequest>,
) -> Result<Json<MeResponse>, AppError> {
    // Input length validation to prevent DB DoS
    if let Some(ref v) = body.display_name {
        if v.len() > 64 { return Err(AppError(jolkr_common::JolkrError::Validation("Display name must be 64 characters or less".into()))); }
    }
    if let Some(ref v) = body.status {
        if v.len() > 128 { return Err(AppError(jolkr_common::JolkrError::Validation("Status must be 128 characters or less".into()))); }
    }
    if let Some(ref v) = body.bio {
        if v.len() > 500 { return Err(AppError(jolkr_common::JolkrError::Validation("Bio must be 500 characters or less".into()))); }
    }
    if let Some(ref v) = body.avatar_url {
        if v.len() > 512 { return Err(AppError(jolkr_common::JolkrError::Validation("Avatar URL must be 512 characters or less".into()))); }
    }

    let mut profile = UserService::update_me(
        &state.pool,
        auth.user_id,
        UpdateProfileRequest {
            display_name: body.display_name,
            avatar_url: body.avatar_url,
            status: body.status,
            bio: body.bio,
            show_read_receipts: body.show_read_receipts,
            banner_color: body.banner_color,
            dm_filter: body.dm_filter,
            allow_friend_requests: body.allow_friend_requests,
        },
    )
    .await?;

    presign_avatar_me(&state, &mut profile).await;

    // Broadcast profile update to all sessions of this user.
    // Self-only privacy preferences (show_read_receipts, dm_filter,
    // allow_friend_requests) are included here so sibling tabs reflect the
    // settings toggle without a refresh.
    let self_event = crate::ws::events::GatewayEvent::UserUpdate {
        user_id: auth.user_id,
        status: profile.status.clone(),
        display_name: profile.display_name.clone(),
        avatar_url: profile.avatar_url.clone(),
        bio: profile.bio.clone(),
        banner_color: profile.banner_color.clone(),
        show_read_receipts: Some(profile.show_read_receipts),
        dm_filter: Some(profile.dm_filter.clone()),
        allow_friend_requests: Some(profile.allow_friend_requests),
    };
    state.nats.publish_to_user(auth.user_id, &self_event).await;

    // Fan out to every user who shares a server or DM with the updater so
    // their member lists / DM avatars / sidebar profiles refresh live without
    // a manual reload. Self is excluded (already received the event above).
    // Privacy preferences are stripped — peers have no business knowing them.
    // Errors are non-fatal — the profile change has succeeded; failed fan-out
    // just means the other side won't see the change until next refresh.
    let peer_event = crate::ws::events::GatewayEvent::UserUpdate {
        user_id: auth.user_id,
        status: profile.status.clone(),
        display_name: profile.display_name.clone(),
        avatar_url: profile.avatar_url.clone(),
        bio: profile.bio.clone(),
        banner_color: profile.banner_color.clone(),
        show_read_receipts: None,
        dm_filter: None,
        allow_friend_requests: None,
    };
    match list_mutual_user_ids(&state.pool, auth.user_id).await {
        Ok(mutual_ids) => {
            for uid in mutual_ids {
                state.nats.publish_to_user(uid, &peer_event).await;
            }
        }
        Err(e) => tracing::warn!("Failed to fan out UserUpdate to mutuals: {e}"),
    }

    Ok(Json(MeResponse { user: profile }))
}

/// Collect every distinct user_id who shares either a server membership or a
/// DM with the given user, EXCLUDING the user themselves. Used to fan out
/// profile updates so other people see new avatars/names live.
async fn list_mutual_user_ids(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<Uuid>, jolkr_common::JolkrError> {
    // Mutuals via shared server membership.
    let server_mutuals: Vec<(Uuid,)> = sqlx::query_as(
        "
        SELECT DISTINCT m2.user_id
        FROM members m1
        JOIN members m2 ON m1.server_id = m2.server_id
        WHERE m1.user_id = $1 AND m2.user_id <> $1
        ",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    // Mutuals via shared DM. dm_members is the join table.
    let dm_mutuals: Vec<(Uuid,)> = sqlx::query_as(
        "
        SELECT DISTINCT m2.user_id
        FROM dm_members m1
        JOIN dm_members m2 ON m1.dm_channel_id = m2.dm_channel_id
        WHERE m1.user_id = $1 AND m2.user_id <> $1
        ",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut set = std::collections::HashSet::new();
    for (id,) in server_mutuals { set.insert(id); }
    for (id,) in dm_mutuals     { set.insert(id); }
    Ok(set.into_iter().collect())
}

/// GET /api/users/:id
pub(crate) async fn get_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<UserResponse>, AppError> {
    let mut profile = UserService::get_profile(&state.pool, id).await?;
    presign_avatar(&state, &mut profile).await;
    Ok(Json(UserResponse { user: profile }))
}

/// POST /api/users/batch
pub(crate) async fn get_users_batch(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<BatchUsersRequest>,
) -> Result<Json<UsersResponse>, AppError> {
    if body.ids.len() > 100 {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Cannot request more than 100 users at once".into(),
        )));
    }
    let ids: Vec<Uuid> = body.ids.into_iter().collect();
    let mut users = UserService::get_profiles_batch(&state.pool, &ids).await?;
    for user in &mut users {
        presign_avatar(&state, user).await;
    }
    Ok(Json(UsersResponse { users }))
}

/// GET /api/users/search?q=<query>
pub(crate) async fn search_users(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(params): Query<SearchQuery>,
) -> Result<Json<UsersResponse>, AppError> {
    let mut users = UserService::search_users(&state.pool, &params.q).await?;
    for user in &mut users {
        presign_avatar(&state, user).await;
    }
    Ok(Json(UsersResponse { users }))
}
