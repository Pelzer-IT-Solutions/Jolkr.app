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
use crate::ws::events::{FriendshipUpdateKind, GatewayEvent};

/// Response payload carrying a single friendship row.
#[derive(Serialize)]
pub(crate) struct FriendshipResponse {
    pub friendship: FriendshipInfo,
}

/// Response payload for GET /api/friends and GET /api/friends/pending.
#[derive(Serialize)]
pub(crate) struct FriendshipsResponse {
    pub friendships: Vec<FriendshipInfo>,
}

/// Request body for POST /api/friends (send request) and POST /api/friends/block.
#[derive(Deserialize)]
pub(crate) struct SendRequestBody {
    /// The user to send the request to / block.
    pub user_id: Uuid,
}

pub(crate) async fn send_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<SendRequestBody>,
) -> Result<Json<FriendshipResponse>, AppError> {
    let friendship =
        FriendshipService::send_request(&state.pool, auth.user_id, body.user_id).await?;
    let event = GatewayEvent::FriendshipUpdate {
        friendship: friendship.clone(),
        kind: FriendshipUpdateKind::Created,
    };
    state.nats.publish_to_user(friendship.requester_id, &event).await;
    state.nats.publish_to_user(friendship.addressee_id, &event).await;
    Ok(Json(FriendshipResponse { friendship }))
}

pub(crate) async fn accept_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<FriendshipResponse>, AppError> {
    let friendship = FriendshipService::accept_request(&state.pool, id, auth.user_id).await?;
    let event = GatewayEvent::FriendshipUpdate {
        friendship: friendship.clone(),
        kind: FriendshipUpdateKind::Accepted,
    };
    state.nats.publish_to_user(friendship.requester_id, &event).await;
    state.nats.publish_to_user(friendship.addressee_id, &event).await;
    Ok(Json(FriendshipResponse { friendship }))
}

pub(crate) async fn decline_or_remove(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    // Service returns the deleted row so we can notify both participants.
    // `Declined` is used for both decline-pending and unfriend-accepted; the
    // distinction doesn't matter for the panel — clients just refresh either
    // way.
    let friendship = FriendshipService::decline_or_remove(&state.pool, id, auth.user_id).await?;
    let event = GatewayEvent::FriendshipUpdate {
        friendship: friendship.clone(),
        kind: FriendshipUpdateKind::Declined,
    };
    state.nats.publish_to_user(friendship.requester_id, &event).await;
    state.nats.publish_to_user(friendship.addressee_id, &event).await;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn block_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<SendRequestBody>,
) -> Result<Json<FriendshipResponse>, AppError> {
    let friendship =
        FriendshipService::block_user(&state.pool, auth.user_id, body.user_id).await?;
    // Only the actor learns about the block; the blocked user must not be
    // told they were blocked (that's the whole point of blocking).
    let event = GatewayEvent::FriendshipUpdate {
        friendship: friendship.clone(),
        kind: FriendshipUpdateKind::Blocked,
    };
    state.nats.publish_to_user(auth.user_id, &event).await;
    Ok(Json(FriendshipResponse { friendship }))
}

pub(crate) async fn list_friends(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<FriendshipsResponse>, AppError> {
    let friendships = FriendshipService::list_friends(&state.pool, auth.user_id).await?;
    Ok(Json(FriendshipsResponse { friendships }))
}

pub(crate) async fn list_pending(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<FriendshipsResponse>, AppError> {
    let friendships = FriendshipService::list_pending(&state.pool, auth.user_id).await?;
    Ok(Json(FriendshipsResponse { friendships }))
}
