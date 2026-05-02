use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use uuid::Uuid;

use jolkr_core::DmService;
use jolkr_core::services::dm::{AddMemberRequest, CreateGroupDmRequest, UpdateGroupDmRequest};
use jolkr_db::repo::DmRepo;

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

use super::types::*;

/// POST /api/dms — create a 1-on-1 or group DM.
pub(crate) async fn create_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateDmRequest>,
) -> Result<Json<DmChannelResponse>, AppError> {
    let channel = match body {
        CreateDmRequest::OneOnOne { user_id } => {
            DmService::open_dm(&state.pool, auth.user_id, user_id).await?
        }
        CreateDmRequest::Group { user_ids, name } => {
            DmService::create_group_dm(&state.pool, auth.user_id, CreateGroupDmRequest { user_ids, name }).await?
        }
    };

    // Notify all DM members about the new/reopened channel
    let event = crate::ws::events::GatewayEvent::DmUpdate {
        channel: channel.clone(),
    };
    for &member_id in &channel.members {
        state.nats.publish_to_user(member_id, &event).await;
    }

    Ok(Json(DmChannelResponse { channel }))
}

pub(crate) async fn list_dms(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<DmChannelsResponse>, AppError> {
    let channels = DmService::list_dms(&state.pool, auth.user_id).await?;
    Ok(Json(DmChannelsResponse { channels }))
}

/// PATCH /api/dms/:dm_id — update group DM name.
pub(crate) async fn update_dm(
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
pub(crate) async fn add_dm_member(
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
pub(crate) async fn leave_dm(
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

/// POST /api/dms/:dm_id/close — close (hide) a DM from the user's list.
pub(crate) async fn close_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    DmService::close_dm(&state.pool, dm_id, auth.user_id).await?;

    // 1. Tell the closer's other sessions to hide this DM.
    let close_event = crate::ws::events::GatewayEvent::DmClose { dm_id };
    state.nats.publish_to_user(auth.user_id, &close_event).await;

    // 2. Tell remaining (still-open) members the membership changed so their
    //    UI can refresh. close_dm is a soft-close, so the closer still has a
    //    row in dm_members — filter on closed_at IS NULL to get the live set.
    let channel_row = match DmRepo::get_channel(&state.pool, dm_id).await {
        Ok(row) => Some(row),
        Err(e) => {
            tracing::warn!("DmUpdate fan-out skipped for channel {dm_id}: {e}");
            None
        }
    };
    let all_members = match DmRepo::get_dm_members(&state.pool, dm_id).await {
        Ok(rows) => Some(rows),
        Err(e) => {
            tracing::warn!("DmUpdate fan-out skipped for channel {dm_id}: {e}");
            None
        }
    };

    if let (Some(channel_row), Some(all_members)) = (channel_row, all_members) {
        let open_members: Vec<_> = all_members.iter().filter(|m| m.closed_at.is_none()).collect();
        let open_member_ids: Vec<Uuid> = open_members.iter().map(|m| m.user_id).collect();

        // Fetch the actual last message so the DmUpdate carries the real preview
        // — without it, bystander sidebars would momentarily blank out (the
        // upsert pattern in useAppInit replaces existing entries wholesale).
        let last_message = match DmRepo::get_last_messages(&state.pool, &[dm_id]).await {
            Ok(msgs) => msgs.into_iter().next().map(|m| {
                use base64::Engine;
                let engine = base64::engine::general_purpose::STANDARD;
                jolkr_core::services::dm::DmLastMessage {
                    id: m.id,
                    author_id: m.author_id,
                    content: m.content,
                    nonce: m.nonce.as_ref().map(|n| engine.encode(n)),
                    created_at: m.created_at,
                }
            }),
            Err(e) => {
                tracing::warn!("DmUpdate last_message fetch failed for channel {dm_id}: {e}");
                None
            }
        };

        let dm_info = jolkr_core::services::dm::DmChannelInfo {
            id: channel_row.id,
            is_group: channel_row.is_group,
            name: channel_row.name,
            members: open_member_ids,
            created_at: channel_row.created_at,
            last_message,
        };
        let update_event = crate::ws::events::GatewayEvent::DmUpdate { channel: dm_info };
        for m in &open_members {
            if m.user_id != auth.user_id {
                state.nats.publish_to_user(m.user_id, &update_event).await;
            }
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Read Receipts ────────────────────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct MarkAsReadRequest {
    pub message_id: Uuid,
}

/// POST /api/dms/:dm_id/read
pub(crate) async fn mark_as_read(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
    Json(body): Json<MarkAsReadRequest>,
) -> Result<axum::http::StatusCode, AppError> {
    let should_broadcast =
        DmService::mark_as_read(&state.pool, dm_id, auth.user_id, body.message_id).await?;

    if should_broadcast {
        // Broadcast DmMessagesRead to ALL DM members (including reader's other sessions)
        let event = crate::ws::events::GatewayEvent::DmMessagesRead {
            dm_id,
            user_id: auth.user_id,
            message_id: body.message_id,
        };
        if let Ok(members) = DmRepo::get_dm_members(&state.pool, dm_id).await {
            for member in &members {
                state.nats.publish_to_user(member.user_id, &event).await;
            }
        }
    }

    Ok(axum::http::StatusCode::NO_CONTENT)
}
