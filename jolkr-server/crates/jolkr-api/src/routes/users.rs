use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::UserService;
use jolkr_core::services::user::{UpdateProfileRequest, UserProfile};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub user: UserProfile,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMeRequest {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub bio: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub struct BatchUsersRequest {
    pub ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct UsersResponse {
    pub users: Vec<UserProfile>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// Re-presign avatar_url if it looks like an S3 key (not a full URL).
async fn presign_avatar(state: &AppState, profile: &mut UserProfile) {
    if let Some(ref avatar) = profile.avatar_url {
        // S3 keys start with "uploads/" or similar, not "http"
        if !avatar.starts_with("http") {
            if let Ok(url) = state.storage.presign_get(avatar, 7 * 24 * 3600).await {
                profile.avatar_url = Some(url);
            }
        }
    }
}

/// GET /api/users/@me
pub async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<UserResponse>, AppError> {
    let mut profile = UserService::get_profile(&state.pool, auth.user_id).await?;
    presign_avatar(&state, &mut profile).await;
    Ok(Json(UserResponse { user: profile }))
}

/// PATCH /api/users/@me
pub async fn update_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateMeRequest>,
) -> Result<Json<UserResponse>, AppError> {
    let mut profile = UserService::update_profile(
        &state.pool,
        auth.user_id,
        UpdateProfileRequest {
            display_name: body.display_name,
            avatar_url: body.avatar_url,
            status: body.status,
            bio: body.bio,
        },
    )
    .await?;

    presign_avatar(&state, &mut profile).await;
    Ok(Json(UserResponse { user: profile }))
}

/// GET /api/users/:id
pub async fn get_user(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<UserResponse>, AppError> {
    let mut profile = UserService::get_profile(&state.pool, id).await?;
    presign_avatar(&state, &mut profile).await;
    Ok(Json(UserResponse { user: profile }))
}

/// POST /api/users/batch
pub async fn get_users_batch(
    State(state): State<AppState>,
    _auth: AuthUser,
    Json(body): Json<BatchUsersRequest>,
) -> Result<Json<UsersResponse>, AppError> {
    let ids: Vec<Uuid> = body.ids.into_iter().collect();
    let mut users = UserService::get_profiles_batch(&state.pool, &ids).await?;
    for user in &mut users {
        presign_avatar(&state, user).await;
    }
    Ok(Json(UsersResponse { users }))
}

/// GET /api/users/search?q=<query>
pub async fn search_users(
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
