use axum::{
    extract::{Multipart, Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::DmService;
use jolkr_core::services::dm::{
    AddMemberRequest, DmChannelInfo, DmMessageInfo, DmMessageQuery,
    EditDmRequest, SendDmRequest, UpdateGroupDmRequest,
};
use jolkr_core::services::message::{AttachmentInfo, MessageInfo};
use jolkr_db::repo::{DmRepo, EmbedRepo, UserRepo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;
use crate::storage::MAX_FILE_SIZE;

#[derive(Serialize)]
pub struct DmChannelResponse {
    pub channel: DmChannelInfo,
}

#[derive(Serialize)]
pub struct DmChannelsResponse {
    pub channels: Vec<DmChannelInfo>,
}

#[derive(Serialize)]
pub struct DmMessageResponse {
    pub message: DmMessageInfo,
}

#[derive(Serialize)]
pub struct DmMessagesResponse {
    pub messages: Vec<DmMessageInfo>,
}

/// Accept either `{ "user_id": "..." }` for 1-on-1 or `{ "user_ids": [...], "name"?: "..." }` for group DM.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum CreateDmRequest {
    Group { user_ids: Vec<Uuid>, name: Option<String> },
    OneOnOne { user_id: Uuid },
}

/// POST /api/dms — create a 1-on-1 or group DM.
pub async fn create_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateDmRequest>,
) -> Result<Json<DmChannelResponse>, AppError> {
    match body {
        CreateDmRequest::OneOnOne { user_id } => {
            let channel = DmService::open_dm(&state.pool, auth.user_id, user_id).await?;

            // Broadcast DmCreate to both members
            let event = crate::ws::events::GatewayEvent::DmCreate {
                channel: channel.clone(),
            };
            for &member_id in &channel.members {
                state.nats.publish_to_user(member_id, &event).await;
            }

            Ok(Json(DmChannelResponse { channel }))
        }
        CreateDmRequest::Group { user_ids, name } => {
            let req = jolkr_core::services::dm::CreateGroupDmRequest { user_ids, name };
            let channel = DmService::create_group_dm(&state.pool, auth.user_id, req).await?;

            // Broadcast DmCreate to all members
            let event = crate::ws::events::GatewayEvent::DmCreate {
                channel: channel.clone(),
            };
            for &member_id in &channel.members {
                state.nats.publish_to_user(member_id, &event).await;
            }

            Ok(Json(DmChannelResponse { channel }))
        }
    }
}

pub async fn list_dms(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<DmChannelsResponse>, AppError> {
    let channels = DmService::list_dms(&state.pool, auth.user_id).await?;
    Ok(Json(DmChannelsResponse { channels }))
}

fn dm_to_message_info(msg: &DmMessageInfo) -> MessageInfo {
    MessageInfo {
        id: msg.id,
        channel_id: msg.dm_channel_id,
        author_id: msg.author_id,
        content: msg.content.clone(),
        encrypted_content: msg.encrypted_content.clone(),
        nonce: msg.nonce.clone(),
        is_edited: msg.is_edited,
        is_pinned: false,
        reply_to_id: msg.reply_to_id,
        thread_id: None,
        thread_reply_count: None,
        attachments: msg.attachments.clone(),
        reactions: msg.reactions.clone(),
        embeds: msg.embeds.clone(),
        webhook_id: None,
        webhook_name: None,
        webhook_avatar: None,
        poll: None,
        created_at: msg.created_at,
        updated_at: msg.updated_at,
    }
}

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
    if message.encrypted_content.is_none() {
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
                                use jolkr_core::services::message::EmbedInfo;
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
    let msg_content = if message.encrypted_content.is_some() {
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
            if let Ok(url) = state.storage.presign_get(&att.url, 7 * 24 * 3600).await {
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

// ── DM Reactions ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddReactionRequest {
    pub emoji: String,
}

#[derive(Serialize)]
pub struct DmReactionResponse {
    pub reaction: DmReactionInfo,
}

#[derive(Serialize)]
pub struct DmReactionsResponse {
    pub reactions: Vec<DmReactionInfo>,
}

#[derive(Serialize)]
pub struct DmReactionInfo {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// POST /api/dms/messages/:id/reactions
pub async fn add_dm_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(body): Json<AddReactionRequest>,
) -> Result<Json<DmReactionResponse>, AppError> {
    // Verify the caller is a member of this DM channel
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if !DmRepo::is_member(&state.pool, msg.dm_channel_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    if body.emoji.len() > 100 {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Emoji must be 100 characters or less".into(),
        )));
    }
    let row = DmRepo::add_reaction(&state.pool, message_id, auth.user_id, &body.emoji).await?;

    // Broadcast aggregated reactions to DM channel
    {
        use std::collections::HashMap;
        let rows = DmRepo::list_reactions(&state.pool, message_id).await.unwrap_or_default();
        let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
        for r in &rows {
            let entry = by_emoji.entry(r.emoji.clone()).or_insert((0, Vec::new()));
            entry.0 += 1;
            entry.1.push(r.user_id);
        }
        let reactions: Vec<jolkr_core::services::message::ReactionInfo> = by_emoji
            .into_iter()
            .map(|(emoji, (count, user_ids))| jolkr_core::services::message::ReactionInfo {
                emoji,
                count,
                user_ids,
            })
            .collect();
        let event = crate::ws::events::GatewayEvent::ReactionUpdate {
            channel_id: msg.dm_channel_id,
            message_id,
            reactions,
        };
        state.nats.publish_to_channel(msg.dm_channel_id, &event).await;
    }

    Ok(Json(DmReactionResponse {
        reaction: DmReactionInfo {
            id: row.id,
            message_id: row.dm_message_id,
            user_id: row.user_id,
            emoji: row.emoji,
            created_at: row.created_at,
        },
    }))
}

/// DELETE /api/dms/messages/:id/reactions/:emoji
pub async fn remove_dm_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((message_id, emoji)): Path<(Uuid, String)>,
) -> Result<axum::http::StatusCode, AppError> {
    // Verify the caller is a member of this DM channel
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if !DmRepo::is_member(&state.pool, msg.dm_channel_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    DmRepo::remove_reaction(&state.pool, message_id, auth.user_id, &emoji).await?;

    // Broadcast aggregated reactions to DM channel
    {
        use std::collections::HashMap;
        let rows = DmRepo::list_reactions(&state.pool, message_id).await.unwrap_or_default();
        let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
        for r in &rows {
            let entry = by_emoji.entry(r.emoji.clone()).or_insert((0, Vec::new()));
            entry.0 += 1;
            entry.1.push(r.user_id);
        }
        let reactions: Vec<jolkr_core::services::message::ReactionInfo> = by_emoji
            .into_iter()
            .map(|(emoji, (count, user_ids))| jolkr_core::services::message::ReactionInfo {
                emoji,
                count,
                user_ids,
            })
            .collect();
        let event = crate::ws::events::GatewayEvent::ReactionUpdate {
            channel_id: msg.dm_channel_id,
            message_id,
            reactions,
        };
        state.nats.publish_to_channel(msg.dm_channel_id, &event).await;
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/dms/messages/:id/reactions
pub async fn list_dm_reactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> Result<Json<DmReactionsResponse>, AppError> {
    // Verify the caller is a member of this DM channel
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if !DmRepo::is_member(&state.pool, msg.dm_channel_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    let rows = DmRepo::list_reactions(&state.pool, message_id).await?;
    let reactions = rows
        .into_iter()
        .map(|r| DmReactionInfo {
            id: r.id,
            message_id: r.dm_message_id,
            user_id: r.user_id,
            emoji: r.emoji,
            created_at: r.created_at,
        })
        .collect();
    Ok(Json(DmReactionsResponse { reactions }))
}

// ── DM Attachments ──────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DmAttachmentResponse {
    pub attachment: AttachmentInfo,
}

/// POST /api/dms/:dm_id/messages/:message_id/attachments
pub async fn upload_dm_attachment(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((dm_id, message_id)): Path<(Uuid, Uuid)>,
    mut multipart: Multipart,
) -> Result<Json<DmAttachmentResponse>, AppError> {
    // Verify DM membership
    if !DmRepo::is_member(&state.pool, dm_id, auth.user_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }

    // Verify message exists in this DM
    let msg = DmRepo::get_message(&state.pool, message_id).await?;
    if msg.dm_channel_id != dm_id {
        return Err(AppError(jolkr_common::JolkrError::NotFound));
    }

    while let Some(field) = multipart.next_field().await.map_err(|_| {
        AppError(jolkr_common::JolkrError::BadRequest("Invalid multipart".into()))
    })? {
        let filename = crate::routes::attachments::sanitize_filename(
            field.file_name().unwrap_or("file"),
        );
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();
        let data = field.bytes().await.map_err(|_| {
            AppError(jolkr_common::JolkrError::BadRequest("Failed to read file".into()))
        })?;

        if data.len() > MAX_FILE_SIZE {
            return Err(AppError(jolkr_common::JolkrError::Validation(
                format!("File too large. Maximum size is {} MB", MAX_FILE_SIZE / 1024 / 1024),
            )));
        }

        if data.is_empty() {
            return Err(AppError(jolkr_common::JolkrError::Validation(
                "File is empty".into(),
            )));
        }

        let size_bytes = data.len() as i64;

        // Upload to S3
        let att_id = Uuid::new_v4();
        let key = state
            .storage
            .upload("dm-attachments", att_id, &filename, &content_type, &data)
            .await
            .map_err(|e| {
                AppError(jolkr_common::JolkrError::Internal(format!(
                    "Upload failed: {e}"
                )))
            })?;
        let row = DmRepo::create_attachment(
            &state.pool,
            att_id,
            message_id,
            &filename,
            &content_type,
            size_bytes,
            &key,
        )
        .await?;

        // Presign the URL for the response
        let url = state
            .storage
            .presign_get(&row.url, 7 * 24 * 3600)
            .await
            .unwrap_or(row.url);

        // Broadcast MessageUpdate so other clients see the new attachment
        if let Ok(row) = DmRepo::get_message(&state.pool, message_id).await {
            let mut dm_msg = DmMessageInfo::from(row);
            // Enrich with attachments
            let atts = DmRepo::list_attachments_for_messages(&state.pool, &[message_id])
                .await
                .unwrap_or_default();
            for att in atts {
                let att_url = state
                    .storage
                    .presign_get(&att.url, 7 * 24 * 3600)
                    .await
                    .unwrap_or(att.url);
                dm_msg.attachments.push(AttachmentInfo {
                    id: att.id,
                    filename: att.filename,
                    content_type: att.content_type,
                    size_bytes: att.size_bytes,
                    url: att_url,
                });
            }
            // Enrich with reactions
            let reactions = DmRepo::list_reactions(&state.pool, message_id)
                .await
                .unwrap_or_default();
            {
                use std::collections::HashMap;
                let mut by_emoji: HashMap<String, (i64, Vec<Uuid>)> = HashMap::new();
                for r in reactions {
                    let entry = by_emoji.entry(r.emoji).or_insert((0, Vec::new()));
                    entry.0 += 1;
                    entry.1.push(r.user_id);
                }
                dm_msg.reactions = by_emoji
                    .into_iter()
                    .map(|(emoji, (count, user_ids))| {
                        jolkr_core::services::message::ReactionInfo {
                            emoji,
                            count,
                            user_ids,
                        }
                    })
                    .collect();
            }
            let event = crate::ws::events::GatewayEvent::MessageUpdate {
                message: dm_to_message_info(&dm_msg),
            };
            state.nats.publish_to_channel(dm_id, &event).await;
        }

        return Ok(Json(DmAttachmentResponse {
            attachment: AttachmentInfo {
                id: row.id,
                filename: row.filename,
                content_type: row.content_type,
                size_bytes: row.size_bytes,
                url,
            },
        }));
    }

    Err(AppError(jolkr_common::JolkrError::BadRequest(
        "No file in request".into(),
    )))
}

// ── Group DM management ──────────────────────────────────────────────

/// PATCH /api/dms/:dm_id — update group DM name.
pub async fn update_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<UpdateGroupDmRequest>,
) -> Result<Json<DmChannelResponse>, AppError> {
    let channel = DmService::update_group(&state.pool, dm_id, auth.user_id, body).await?;

    let event = crate::ws::events::GatewayEvent::DmUpdate {
        channel: channel.clone(),
    };
    for &member_id in &channel.members {
        state.nats.publish_to_user(member_id, &event).await;
    }

    Ok(Json(DmChannelResponse { channel }))
}

/// PUT /api/dms/:dm_id/members — add a member to a group DM.
pub async fn add_dm_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<AddMemberRequest>,
) -> Result<Json<DmChannelResponse>, AppError> {
    let channel = DmService::add_member(&state.pool, dm_id, auth.user_id, body.user_id).await?;

    let event = crate::ws::events::GatewayEvent::DmUpdate {
        channel: channel.clone(),
    };
    for &member_id in &channel.members {
        state.nats.publish_to_user(member_id, &event).await;
    }

    Ok(Json(DmChannelResponse { channel }))
}

/// DELETE /api/dms/:dm_id/members/@me — leave a group DM.
pub async fn leave_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let channel = DmService::leave_group(&state.pool, dm_id, auth.user_id).await?;

    // Notify remaining members
    let event = crate::ws::events::GatewayEvent::DmUpdate {
        channel: channel.clone(),
    };
    for &member_id in &channel.members {
        state.nats.publish_to_user(member_id, &event).await;
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── DM Voice Call Signaling ──────────────────────────────────────────

/// Helper: validate DM membership, ensure it's a 1-on-1 DM, return the other member's user_id.
async fn validate_dm_call(
    pool: &sqlx::PgPool,
    dm_id: Uuid,
    caller_id: Uuid,
) -> Result<Uuid, AppError> {
    let channel = DmRepo::get_channel(pool, dm_id).await?;
    if channel.is_group {
        return Err(AppError(jolkr_common::JolkrError::Validation(
            "Voice calls are only supported in 1-on-1 DMs".into(),
        )));
    }
    if !DmRepo::is_member(pool, dm_id, caller_id).await? {
        return Err(AppError(jolkr_common::JolkrError::Forbidden));
    }
    let members = DmRepo::get_dm_members(pool, dm_id).await?;
    let other_id = members
        .iter()
        .find(|m| m.user_id != caller_id)
        .map(|m| m.user_id)
        .ok_or(AppError(jolkr_common::JolkrError::NotFound))?;
    Ok(other_id)
}

/// POST /api/dms/:dm_id/call — initiate a call (ring the other user).
pub async fn initiate_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let caller = UserRepo::get_by_id(&state.pool, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallRing {
        dm_id,
        caller_id: auth.user_id,
        caller_username: caller.username,
    };
    state.nats.publish_to_user(other_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/accept — accept an incoming call.
pub async fn accept_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallAccept {
        dm_id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_user(other_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/reject — reject an incoming call.
pub async fn reject_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallReject {
        dm_id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_user(other_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/dms/:dm_id/call/end — end an active call.
pub async fn end_call(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    let other_id = validate_dm_call(&state.pool, dm_id, auth.user_id).await?;
    let event = crate::ws::events::GatewayEvent::DmCallEnd {
        dm_id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_user(other_id, &event).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
