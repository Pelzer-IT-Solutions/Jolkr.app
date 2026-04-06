use axum::{
    extract::{Path, Query, State},
    Json,
};
use uuid::Uuid;

use jolkr_core::DmService;
use jolkr_core::services::dm::{DmMessageInfo, DmMessageQuery, EditDmRequest, SendDmRequest};
use jolkr_core::services::message::EmbedInfo;
use jolkr_db::repo::{DmRepo, EmbedRepo, UserRepo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::attachments::PRESIGN_EXPIRY_SECS;
use crate::routes::AppState;

use super::types::*;

pub async fn send_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<SendDmRequest>,
) -> Result<Json<DmMessageResponse>, AppError> {
    let message = DmService::send_message(&state.pool, dm_id, auth.user_id, body).await?;

    // Broadcast via WebSocket so both participants see the message in real-time
    let event = crate::ws::events::GatewayEvent::MessageCreate {
        message: dm_to_message_info(&message),
    };
    state.nats.publish_to_channel(dm_id, &event).await;

    // Also broadcast to each DM participant by user_id, so their DM list
    // updates even if they haven't subscribed to this channel yet.
    if let Ok(members) = DmRepo::get_dm_members(&state.pool, dm_id).await {
        for member in &members {
            state.nats.publish_to_user(member.user_id, &event).await;
        }
    }

    // Link embed processing (fire-and-forget) for DM messages
    // Only process embeds for unencrypted messages; encrypted content has nonce set
    if message.nonce.is_none() {
        if let Some(ref content) = message.content {
            let embed_svc = state.embed.clone();
            let embed_pool = state.pool.clone();
            let embed_msg_id = message.id;
            let embed_dm_id = dm_id;
            let embed_nats = state.nats.clone();
            let embed_content = content.clone();
            tokio::spawn(async move {
                embed_svc.process_message(&embed_pool, embed_msg_id, &embed_content, true).await;
                // Fetch embeds and broadcast MessageUpdate if any were created
                match EmbedRepo::list_for_dm_messages(&embed_pool, &[embed_msg_id]).await {
                    Ok(embeds) if !embeds.is_empty() => {
                        match DmRepo::get_message(&embed_pool, embed_msg_id).await {
                            Ok(row) => {
                                let mut msg: DmMessageInfo = row.into();
                                msg.embeds = embeds.into_iter().map(|e| EmbedInfo {
                                    url: e.url,
                                    title: e.title,
                                    description: e.description,
                                    image_url: e.image_url,
                                    site_name: e.site_name,
                                    color: e.color,
                                }).collect();
                                let event = crate::ws::events::GatewayEvent::MessageUpdate {
                                    message: dm_to_message_info(&msg),
                                };
                                embed_nats.publish_to_channel(embed_dm_id, &event).await;
                            }
                            Err(e) => {
                                tracing::warn!("DM embed enrichment failed for message {embed_msg_id}: {e}");
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("DM embed fetch failed for message {embed_msg_id}: {e}");
                    }
                    _ => {}
                }
            });
        }
    }

    // Push notification to offline DM recipient (fire-and-forget)
    let push = state.push.clone();
    let pool = state.pool.clone();
    let msg_content = if message.nonce.is_some() {
        "Sent an encrypted message".to_string()
    } else {
        message.content.clone().unwrap_or_default()
    };
    let author_id = auth.user_id;
    tokio::spawn(async move {
        let sender = match UserRepo::get_by_id(&pool, author_id).await {
            Ok(u) => u,
            Err(_) => return,
        };
        if let Ok(members) = DmRepo::get_dm_members(&pool, dm_id).await {
            for member in members {
                if member.user_id != author_id {
                    push.notify_dm(
                        member.user_id,
                        &sender.username,
                        &msg_content,
                        dm_id,
                    ).await;
                }
            }
        }
    });

    Ok(Json(DmMessageResponse { message }))
}

pub async fn get_dm_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Query(query): Query<DmMessageQuery>,
) -> Result<Json<DmMessagesResponse>, AppError> {
    let mut messages = DmService::get_messages(&state.pool, dm_id, auth.user_id, query).await?;

    // Presign attachment URLs
    for msg in &mut messages {
        for att in &mut msg.attachments {
            if let Ok(url) = state.storage.presign_get(&att.url, PRESIGN_EXPIRY_SECS).await {
                att.url = url;
            }
        }
    }

    Ok(Json(DmMessagesResponse { messages }))
}

/// PATCH /api/dms/messages/:id
pub async fn edit_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(body): Json<EditDmRequest>,
) -> Result<Json<DmMessageResponse>, AppError> {
    let mut message = DmService::edit_message(&state.pool, message_id, auth.user_id, body).await?;

    // Enrich with reactions so the broadcast includes them (DmService::edit_message
    // returns empty reactions since it only converts the bare row).
    let reactions = DmRepo::list_reactions(&state.pool, message_id).await.unwrap_or_default();
    {
        use std::collections::HashMap;
        let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
        for r in reactions {
            let entry = by_emoji.entry(r.emoji).or_insert((0, Vec::new()));
            entry.0 += 1;
            entry.1.push(r.user_id);
        }
        message.reactions = by_emoji
            .into_iter()
            .map(|(emoji, (count, user_ids))| jolkr_core::services::message::ReactionInfo {
                emoji,
                count,
                user_ids,
            })
            .collect();
    }

    let event = crate::ws::events::GatewayEvent::MessageUpdate {
        message: dm_to_message_info(&message),
    };
    state.nats.publish_to_channel(message.dm_channel_id, &event).await;

    Ok(Json(DmMessageResponse { message }))
}

/// DELETE /api/dms/messages/:id
pub async fn delete_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let dm_channel_id = DmService::delete_message(&state.pool, message_id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MessageDelete {
        message_id,
        channel_id: dm_channel_id,
    };
    state.nats.publish_to_channel(dm_channel_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
