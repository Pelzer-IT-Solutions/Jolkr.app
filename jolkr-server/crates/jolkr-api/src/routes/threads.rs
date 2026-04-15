use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::ThreadService;
use jolkr_core::services::message::{MessageInfo, SendMessageRequest};
use jolkr_core::services::thread::{
    CreateThreadRequest, ThreadInfo, ThreadMessageQuery, UpdateThreadRequest,
};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ThreadResponse {
    pub thread: ThreadInfo,
}

#[derive(Debug, Serialize)]
pub struct ThreadsResponse {
    pub threads: Vec<ThreadInfo>,
}

#[derive(Debug, Serialize)]
pub struct ThreadCreatedResponse {
    pub thread: ThreadInfo,
    pub message: MessageInfo,
}

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub message: MessageInfo,
}

#[derive(Debug, Serialize)]
pub struct MessagesResponse {
    pub messages: Vec<MessageInfo>,
}

#[derive(Debug, Deserialize)]
pub struct ListThreadsQuery {
    pub include_archived: Option<bool>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/channels/:channel_id/threads
pub async fn create_thread(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<CreateThreadRequest>,
) -> Result<Json<ThreadCreatedResponse>, AppError> {
    let (thread, message) =
        ThreadService::create_thread(&state.pool, channel_id, auth.user_id, body).await?;

    // Broadcast ThreadCreate event to channel subscribers
    let event = crate::ws::events::GatewayEvent::ThreadCreate {
        thread: thread.clone(),
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    // Broadcast MessageUpdate for the starter message (so clients update thread_id + thread_reply_count)
    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    Ok(Json(ThreadCreatedResponse { thread, message }))
}

/// GET /api/channels/:channel_id/threads
pub async fn list_threads(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<ListThreadsQuery>,
) -> Result<Json<ThreadsResponse>, AppError> {
    let include_archived = query.include_archived.unwrap_or(false);
    let threads =
        ThreadService::list_threads(&state.pool, channel_id, auth.user_id, include_archived)
            .await?;
    Ok(Json(ThreadsResponse { threads }))
}

/// GET /api/threads/:thread_id
pub async fn get_thread(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(thread_id): Path<Uuid>,
) -> Result<Json<ThreadResponse>, AppError> {
    let thread = ThreadService::get_thread(&state.pool, thread_id, auth.user_id).await?;
    Ok(Json(ThreadResponse { thread }))
}

/// PATCH /api/threads/:thread_id
pub async fn update_thread(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<UpdateThreadRequest>,
) -> Result<Json<ThreadResponse>, AppError> {
    let thread =
        ThreadService::update_thread(&state.pool, thread_id, auth.user_id, body).await?;

    // Broadcast ThreadUpdate to the parent channel
    let event = crate::ws::events::GatewayEvent::ThreadUpdate {
        thread: thread.clone(),
    };
    state.nats.publish_to_channel(thread.channel_id, &event).await;

    Ok(Json(ThreadResponse { thread }))
}

/// GET /api/threads/:thread_id/messages
pub async fn get_thread_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(thread_id): Path<Uuid>,
    Query(query): Query<ThreadMessageQuery>,
) -> Result<Json<MessagesResponse>, AppError> {
    let messages =
        ThreadService::get_thread_messages(&state.pool, thread_id, auth.user_id, query).await?;

    Ok(Json(MessagesResponse { messages }))
}

/// POST /api/threads/:thread_id/messages
pub async fn send_thread_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(thread_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    let message =
        ThreadService::send_thread_message(&state.pool, thread_id, auth.user_id, body).await?;

    // Broadcast via parent channel (thread messages route through parent channel's WS)
    let event = crate::ws::events::GatewayEvent::MessageCreate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(message.channel_id, &event).await;

    Ok(Json(MessageResponse { message }))
}
