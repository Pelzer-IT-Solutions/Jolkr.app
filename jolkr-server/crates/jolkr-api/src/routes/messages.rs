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
use jolkr_db::repo::{ChannelRepo, ChannelOverwriteRepo, MemberRepo, RoleRepo, ServerRepo, UserRepo};
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
    // Only process embeds for unencrypted messages (webhooks); encrypted content has nonce set
    let msg_content_for_embeds = if message.nonce.is_some() { None } else { message.content.as_deref().map(|s| s.to_string()) };
    if let Some(ref content) = msg_content_for_embeds {
        let embed_svc = state.embed.clone();
        let embed_pool = state.pool.clone();
        let embed_nats = state.nats.clone();
        let embed_msg_id = message.id;
        let embed_channel_id = channel_id;
        let embed_content = content.clone();
        tokio::spawn(async move {
            embed_svc.process_message(&embed_pool, embed_msg_id, &embed_content, false).await;
            match MessageService::get_message_by_id(&embed_pool, embed_msg_id).await {
                Ok(msg) if !msg.embeds.is_empty() => {
                    let event = crate::ws::events::GatewayEvent::MessageUpdate { message: msg };
                    embed_nats.publish_to_channel(embed_channel_id, &event).await;
                }
                Err(e) => {
                    tracing::warn!("Embed enrichment failed for message {embed_msg_id}: {e}");
                }
                _ => {}
            }
        });
    }

    // Push notifications to offline channel members (fire-and-forget)
    // Batch: all permission checks in-memory, single Redis MGET, single devices query
    let push = state.push.clone();
    let pool = state.pool.clone();
    let msg_content = if message.nonce.is_some() {
        Some("Sent an encrypted message".to_string())
    } else {
        message.content.clone()
    };
    let msg_id = message.id;
    let author_id = auth.user_id;
    tokio::spawn(async move {
        let channel = match ChannelRepo::get_by_id(&pool, channel_id).await {
            Ok(c) => c,
            Err(e) => { tracing::warn!("Push: failed to get channel: {e}"); return; }
        };
        let sender = match UserRepo::get_by_id(&pool, author_id).await {
            Ok(u) => u,
            Err(e) => { tracing::warn!("Push: failed to get sender: {e}"); return; }
        };
        let server = match ServerRepo::get_by_id(&pool, channel.server_id).await {
            Ok(s) => s,
            Err(e) => { tracing::warn!("Push: failed to get server: {e}"); return; }
        };
        let members = match MemberRepo::list_for_server(&pool, channel.server_id).await {
            Ok(m) => m,
            Err(e) => { tracing::warn!("Push: failed to list members: {e}"); return; }
        };

        // Batch: fetch all member-roles + overwrites + everyone_role in 3 queries total
        let member_roles_batch = RoleRepo::get_member_roles_batch(&pool, channel.server_id).await.unwrap_or_default();
        let overwrites = ChannelOverwriteRepo::list_for_channel(&pool, channel_id).await.unwrap_or_default();
        let everyone_role = RoleRepo::get_default(&pool, channel.server_id).await.ok();

        // Build (member_id, user_id) pairs, excluding the author
        let member_pairs: Vec<(uuid::Uuid, uuid::Uuid)> = members.iter()
            .filter(|m| m.user_id != author_id)
            .map(|m| (m.id, m.user_id))
            .collect();

        // Compute all permissions in-memory (0 extra DB queries)
        let perms_map = RoleRepo::compute_channel_permissions_for_all_members(
            &member_pairs,
            &member_roles_batch,
            &overwrites,
            everyone_role.as_ref(),
            server.owner_id,
        );

        // Filter to members with VIEW_CHANNELS permission
        let eligible: Vec<(uuid::Uuid, uuid::Uuid)> = member_pairs.into_iter()
            .filter(|(member_id, _user_id)| {
                perms_map.get(member_id)
                    .map(|&p| Permissions::from(p).has(Permissions::VIEW_CHANNELS))
                    .unwrap_or(false)
            })
            .collect();

        // Batch: Redis MGET for online check + single devices query + send
        push.notify_message_batch(
            &eligible,
            &sender.username,
            &channel.name,
            msg_content.as_deref().unwrap_or(""),
            channel_id,
            msg_id,
        ).await;
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

    let messages = MessageService::get_messages(&state.pool, channel_id, query).await?;

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

    let messages = if has_advanced {
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
    let messages = MessageService::list_pinned(&state.pool, channel_id, auth.user_id).await?;

    Ok(Json(MessagesResponse { messages }))
}
