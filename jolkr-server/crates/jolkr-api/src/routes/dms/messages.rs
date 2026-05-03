use axum::{
    extract::{Path, Query, State},
    Json,
};
use uuid::Uuid;

use jolkr_core::DmService;
use jolkr_core::services::dm::{
    DmChannelInfo, DmLastMessage, DmMessageInfo, DmMessageQuery, EditDmRequest, SendDmRequest,
};
use jolkr_core::services::message::EmbedInfo;
use jolkr_db::repo::{DmRepo, EmbedRepo, UserRepo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

use super::types::*;

pub(crate) async fn send_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<SendDmRequest>,
) -> Result<Json<DmMessageResponse>, AppError> {
    // Fetch channel metadata up-front so the DmCreate fan-out below has it
    // without an extra roundtrip. This is a pure read; if it fails we still
    // proceed with the send and just skip the optional DmCreate fan-out.
    let channel_row_result = DmRepo::get_channel(&state.pool, dm_id).await;
    if let Err(ref e) = channel_row_result {
        tracing::warn!("DmCreate fan-out skipped for channel {dm_id}: {e}");
    }

    let message = DmService::send_message(&state.pool, dm_id, auth.user_id, body).await?;

    // Broadcast via WebSocket so both participants see the message in real-time
    let event = crate::ws::events::GatewayEvent::MessageCreate {
        message: dm_to_message_info(&message),
    };
    state.nats.publish_to_channel(dm_id, &event).await;

    // Also broadcast to each DM participant by user_id, so their DM list
    // updates even if they haven't subscribed to this channel yet.
    let members_opt = DmRepo::get_dm_members(&state.pool, dm_id).await.ok();
    if let Some(members) = &members_opt {
        for member in members {
            state.nats.publish_to_user(member.user_id, &event).await;
        }
    }

    // Emit DmCreate to every member so their DM list shows the conversation,
    // even if the recipient has never seen this DM before (or previously closed
    // it). Frontend dedupe is idempotent: existing entries are replaced, missing
    // ones are prepended. The event also surfaces last_message so the sidebar
    // preview is correct without a separate fetch.
    //
    // members_opt = None is rare but possible if get_dm_members hit a transient
    // DB error above; log it so this regression class is observable.
    match (members_opt.as_ref(), channel_row_result) {
        (Some(members), Ok(channel_row)) => {
            let dm_info = DmChannelInfo {
                id: channel_row.id,
                is_group: channel_row.is_group,
                name: channel_row.name,
                members: members.iter().map(|m| m.user_id).collect(),
                created_at: channel_row.created_at,
                last_message: Some(DmLastMessage {
                    id: message.id,
                    author_id: message.author_id,
                    content: message.content.clone(),
                    nonce: message.nonce.clone(),
                    created_at: message.created_at,
                }),
            };
            let dm_event = crate::ws::events::GatewayEvent::DmCreate {
                channel: dm_info,
            };
            for member in members {
                state.nats.publish_to_user(member.user_id, &dm_event).await;
            }
        }
        (None, _) => {
            tracing::warn!(
                "DmCreate fan-out skipped for channel {dm_id}: get_dm_members returned None"
            );
        }
        // get_channel error path already logged above where it occurred.
        (Some(_), Err(_)) => {}
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

pub(crate) async fn get_dm_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Query(query): Query<DmMessageQuery>,
) -> Result<Json<DmMessagesResponse>, AppError> {
    let messages = DmService::get_messages(&state.pool, dm_id, auth.user_id, query).await?;

    Ok(Json(DmMessagesResponse { messages }))
}

/// PATCH /api/dms/messages/:id
pub(crate) async fn edit_dm_message(
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
pub(crate) async fn delete_dm_message(
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

/// POST /api/dms/messages/:id/hide — soft-hide a DM message for the caller
/// only. Used for "Only for me" deletes and for shift-deleting messages from
/// other users. Authors hiding their own message keeps the message visible
/// for the other side (use the hard DELETE route for "delete for everyone").
pub(crate) async fn hide_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let dm_id = DmService::hide_message_for_me(&state.pool, message_id, auth.user_id).await?;

    // Only the hider's other sessions need to know — nobody else can see this
    // change. publish_to_user fans out across the same user's connected
    // gateways without leaking the event to other DM members.
    let event = crate::ws::events::GatewayEvent::DmMessageHide { dm_id, message_id };
    state.nats.publish_to_user(auth.user_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
