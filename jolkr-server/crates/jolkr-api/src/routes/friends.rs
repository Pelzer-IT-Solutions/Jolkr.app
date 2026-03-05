use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::FriendshipService;
use jolkr_core::services::friendship::FriendshipInfo;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

#[derive(Serialize)]
pub struct FriendshipResponse {
    pub friendship: FriendshipInfo,
}

#[derive(Serialize)]
pub struct FriendshipsResponse {
    pub friendships: Vec<FriendshipInfo>,
}

#[derive(Deserialize)]
pub struct SendRequestBody {
    pub user_id: Uuid,
}

pub async fn send_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<SendRequestBody>,
) -> Result<Json<FriendshipResponse>, AppError> {
    let friendship =
        FriendshipService::send_request(&state.pool, auth.user_id, body.user_id).await?;
    Ok(Json(FriendshipResponse { friendship }))
}

pub async fn accept_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<FriendshipResponse>, AppError> {
    let friendship = FriendshipService::accept_request(&state.pool, id, auth.user_id).await?;
    Ok(Json(FriendshipResponse { friendship }))
}

pub async fn decline_or_remove(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    FriendshipService::decline_or_remove(&state.pool, id, auth.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn block_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<SendRequestBody>,
) -> Result<Json<FriendshipResponse>, AppError> {
    let friendship =
        FriendshipService::block_user(&state.pool, auth.user_id, body.user_id).await?;
    Ok(Json(FriendshipResponse { friendship }))
}

pub async fn list_friends(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<FriendshipsResponse>, AppError> {
    let friendships = FriendshipService::list_friends(&state.pool, auth.user_id).await?;
    Ok(Json(FriendshipsResponse { friendships }))
}

pub async fn list_pending(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<FriendshipsResponse>, AppError> {
    let friendships = FriendshipService::list_pending(&state.pool, auth.user_id).await?;
    Ok(Json(FriendshipsResponse { friendships }))
}
