use axum::{
    extract::{Path, State},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use jolkr_core::services::poll::{CreatePollRequest, PollInfo, PollService, VoteRequest};
use jolkr_core::services::message::MessageInfo;
use jolkr_core::MessageService;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

#[derive(Debug, Serialize)]
pub struct CreatePollResponse {
    pub poll: PollInfo,
    pub message: MessageInfo,
}

#[derive(Debug, Serialize)]
pub struct PollResponse {
    pub poll: PollInfo,
}

/// POST /api/channels/:id/polls — create a poll
pub async fn create_poll(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreatePollRequest>,
) -> Result<Json<CreatePollResponse>, AppError> {
    let (poll, message_id) = PollService::create_poll(&state.pool, channel_id, auth.user_id, body).await?;

    // Get the enriched message
    let message = MessageService::get_message_by_id(&state.pool, message_id).await?;

    // Publish MessageCreate via NATS
    let event = crate::ws::events::GatewayEvent::MessageCreate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    Ok(Json(CreatePollResponse { poll, message }))
}

/// POST /api/polls/:id/vote — vote on a poll
pub async fn vote_poll(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(poll_id): Path<Uuid>,
    Json(body): Json<VoteRequest>,
) -> Result<Json<PollResponse>, AppError> {
    let poll = PollService::vote(&state.pool, poll_id, auth.user_id, body.option_id).await?;

    // Broadcast PollUpdate
    let event = crate::ws::events::GatewayEvent::PollUpdate {
        poll: serde_json::to_value(&poll).unwrap_or_default(),
        channel_id: poll.channel_id,
        message_id: poll.message_id,
    };
    state.nats.publish_to_channel(poll.channel_id, &event).await;

    Ok(Json(PollResponse { poll }))
}

/// DELETE /api/polls/:id/vote — remove a vote
pub async fn unvote_poll(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(poll_id): Path<Uuid>,
    Json(body): Json<VoteRequest>,
) -> Result<Json<PollResponse>, AppError> {
    let poll = PollService::unvote(&state.pool, poll_id, auth.user_id, body.option_id).await?;

    let event = crate::ws::events::GatewayEvent::PollUpdate {
        poll: serde_json::to_value(&poll).unwrap_or_default(),
        channel_id: poll.channel_id,
        message_id: poll.message_id,
    };
    state.nats.publish_to_channel(poll.channel_id, &event).await;

    Ok(Json(PollResponse { poll }))
}

/// GET /api/polls/:id — get a poll
pub async fn get_poll(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(poll_id): Path<Uuid>,
) -> Result<Json<PollResponse>, AppError> {
    let poll = PollService::get_poll(&state.pool, poll_id, auth.user_id).await?;
    Ok(Json(PollResponse { poll }))
}
