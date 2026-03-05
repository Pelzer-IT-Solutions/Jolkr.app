use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_core::MessageService;
use jolkr_core::services::message::{
    EditMessageRequest, MessageInfo, MessageQuery, SendMessageRequest,
};
use jolkr_db::repo::{ChannelRepo, MemberRepo, RoleRepo, ServerRepo, UserRepo};
use chrono;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MessageResponse {
    pub message: MessageInfo,
}

#[derive(Debug, Serialize)]
pub struct MessagesResponse {
    pub messages: Vec<MessageInfo>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/channels/:id/messages
pub async fn send_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<SendMessageRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    let message =
        MessageService::send_message(&state.pool, channel_id, auth.user_id, body).await?;

    // Publish to NATS → all instances will broadcast to their local WebSocket clients
    let event = crate::ws::events::GatewayEvent::MessageCreate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    // Link embed processing (fire-and-forget) — fetch URL previews async
    if let Some(ref content) = message.content {
        let embed_svc = state.embed.clone();
        let embed_pool = state.pool.clone();
        let embed_nats = state.nats.clone();
        let embed_msg_id = message.id;
        let embed_channel_id = channel_id;
        let embed_content = content.clone();
        tokio::spawn(async move {
            embed_svc.process_message(&embed_pool, embed_msg_id, &embed_content, false).await;
            // After embeds are stored, send a MessageUpdate so clients get the embeds
            if let Ok(msg) = MessageService::get_message_by_id(&embed_pool, embed_msg_id).await {
                if !msg.embeds.is_empty() {
                    let event = crate::ws::events::GatewayEvent::MessageUpdate { message: msg };
                    embed_nats.publish_to_channel(embed_channel_id, &event).await;
                }
            }
        });
    }

    // Push notifications to offline channel members (fire-and-forget)
    // TODO(H2): This sends push notifications to ALL server members, but should only
    // notify members who have VIEW_CHANNELS permission for this channel and have not
    // muted the channel. The full fix requires calling compute_channel_permissions for
    // each recipient, which is expensive. Consider caching permissions or pre-computing
    // a list of eligible recipients.
    let push = state.push.clone();
    let pool = state.pool.clone();
    let msg_content = message.content.clone();
    let msg_id = message.id;
    let author_id = auth.user_id;
    tokio::spawn(async move {
        let channel = match ChannelRepo::get_by_id(&pool, channel_id).await {
            Ok(c) => c,
            Err(_) => return,
        };
        let sender = match UserRepo::get_by_id(&pool, author_id).await {
            Ok(u) => u,
            Err(_) => return,
        };
        let members = match MemberRepo::list_for_server(&pool, channel.server_id).await {
            Ok(m) => m,
            Err(_) => return,
        };
        for member in members {
            if member.user_id != author_id {
                push.notify_message(
                    member.user_id,
                    &sender.username,
                    &channel.name,
                    msg_content.as_deref().unwrap_or(""),
                    channel_id,
                    msg_id,
                ).await;
            }
        }
    });

    Ok(Json(MessageResponse { message }))
}

/// GET /api/channels/:id/messages — requires membership + VIEW_CHANNELS
pub async fn get_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<MessagesResponse>, AppError> {
    // Verify caller is a member of the channel's server + VIEW_CHANNELS
    let channel = ChannelRepo::get_by_id(&state.pool, channel_id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(JolkrError::Forbidden))?;
    let server = ServerRepo::get_by_id(&state.pool, channel.server_id).await?;
    if server.owner_id != auth.user_id {
        let perms = RoleRepo::compute_channel_permissions(
            &state.pool, channel.server_id, channel_id, member.id,
        ).await?;
        if !Permissions::from(perms).has(Permissions::VIEW_CHANNELS) {
            return Err(AppError(JolkrError::Forbidden));
        }
    }

    let mut messages = MessageService::get_messages(&state.pool, channel_id, query).await?;

    // Presign attachment URLs so clients can download them
    for msg in &mut messages {
        for att in &mut msg.attachments {
            if let Ok(url) = state.storage.presign_get(&att.url, 7 * 24 * 3600).await {
                att.url = url;
            }
        }
    }

    Ok(Json(MessagesResponse { messages }))
}

/// PATCH /api/messages/:id
pub async fn edit_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<EditMessageRequest>,
) -> Result<Json<MessageResponse>, AppError> {
    let message = MessageService::edit_message(&state.pool, id, auth.user_id, body).await?;

    // Publish to NATS → all instances will broadcast to their local WebSocket clients
    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(message.channel_id, &event).await;

    Ok(Json(MessageResponse { message }))
}

/// DELETE /api/messages/:id
pub async fn delete_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let channel_id = MessageService::delete_message(&state.pool, id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MessageDelete {
        message_id: id,
        channel_id,
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Search ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SearchMessagesQuery {
    pub q: Option<String>,
    pub from: Option<String>,
    pub has: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub limit: Option<i64>,
}

/// GET /api/channels/:id/messages/search?q=...&from=...&has=...&before=...&after=...
pub async fn search_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(params): Query<SearchMessagesQuery>,
) -> Result<Json<MessagesResponse>, AppError> {
    // Verify caller is a member of the channel's server + VIEW_CHANNELS
    let channel = ChannelRepo::get_by_id(&state.pool, channel_id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(JolkrError::Forbidden))?;
    let server = ServerRepo::get_by_id(&state.pool, channel.server_id).await?;
    if server.owner_id != auth.user_id {
        let perms = RoleRepo::compute_channel_permissions(
            &state.pool, channel.server_id, channel_id, member.id,
        ).await?;
        if !Permissions::from(perms).has(Permissions::VIEW_CHANNELS) {
            return Err(AppError(JolkrError::Forbidden));
        }
    }

    let limit = params.limit.unwrap_or(50).min(100).max(1);

    // Check if any advanced filters are used
    let has_advanced = params.from.is_some() || params.has.is_some()
        || params.before.is_some() || params.after.is_some();

    let mut messages = if has_advanced {
        // H9: Resolve from:username → user_id using exact match
        let from_user_id = if let Some(ref from_name) = params.from {
            UserRepo::get_by_username(&state.pool, from_name).await.ok().map(|u| u.id)
        } else {
            None
        };

        // Parse before/after dates
        let before_dt = params.before.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc));
        let after_dt = params.after.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc));

        let text_query = params.q.as_deref().filter(|q| !q.trim().is_empty());

        let rows = jolkr_db::repo::MessageRepo::search_advanced(
            &state.pool,
            channel_id,
            text_query,
            from_user_id,
            params.has.as_deref(),
            before_dt,
            after_dt,
            limit,
        ).await?;

        MessageService::enrich_messages(&state.pool, rows).await?
    } else {
        let q = params.q.as_deref().unwrap_or("");
        if q.trim().is_empty() {
            return Err(AppError(JolkrError::Validation("Search query is required".into())));
        }
        MessageService::search_messages(&state.pool, channel_id, q, limit).await?
    };

    for msg in &mut messages {
        for att in &mut msg.attachments {
            if let Ok(url) = state.storage.presign_get(&att.url, 7 * 24 * 3600).await {
                att.url = url;
            }
        }
    }

    Ok(Json(MessagesResponse { messages }))
}

// ── Pins ─────────────────────────────────────────────────────────────

/// POST /api/channels/:channel_id/pins/:message_id — pin a message
pub async fn pin_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<MessageResponse>, AppError> {
    let message = MessageService::pin_message(&state.pool, channel_id, message_id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    Ok(Json(MessageResponse { message }))
}

/// DELETE /api/channels/:channel_id/pins/:message_id — unpin a message
pub async fn unpin_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<MessageResponse>, AppError> {
    let message = MessageService::unpin_message(&state.pool, channel_id, message_id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: message.clone(),
    };
    state.nats.publish_to_channel(channel_id, &event).await;

    Ok(Json(MessageResponse { message }))
}

/// GET /api/channels/:channel_id/pins — list pinned messages
pub async fn list_pins(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<MessagesResponse>, AppError> {
    let mut messages = MessageService::list_pinned(&state.pool, channel_id, auth.user_id).await?;

    for msg in &mut messages {
        for att in &mut msg.attachments {
            if let Ok(url) = state.storage.presign_get(&att.url, 7 * 24 * 3600).await {
                att.url = url;
            }
        }
    }

    Ok(Json(MessagesResponse { messages }))
}
