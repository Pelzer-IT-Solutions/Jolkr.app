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

    // Only notify the *caller's* other sessions about the new DM. Other
    // members must not see a phantom conversation in their DM list before any
    // message has been sent — the recipient gets a `DmCreate` once the first
    // `send_dm_message` lands (see routes/dms/messages.rs).
    let event = crate::ws::events::GatewayEvent::DmUpdate {
        channel: channel.clone(),
    };
    state.nats.publish_to_user(auth.user_id, &event).await;

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
///
/// `close_dm` is a per-user soft-close: only the caller's row in `dm_members`
/// gets `closed_at` set, and only the caller's sessions need to react. Other
/// members keep seeing the conversation exactly as it was — the same name,
/// the same membership, the same history — so we deliberately do NOT
/// broadcast a `DmUpdate` to them. (A previous version did, with the closer
/// stripped from the member list, which made the other side's sidebar render
/// as "Unknown" because there was no remaining participant to display.)
pub(crate) async fn close_dm(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(dm_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    DmService::close_dm(&state.pool, dm_id, auth.user_id).await?;

    // Tell the closer's other sessions to hide this DM. Nobody else gets
    // notified — the conversation still exists for them unchanged.
    let close_event = crate::ws::events::GatewayEvent::DmClose { dm_id };
    state.nats.publish_to_user(auth.user_id, &close_event).await;

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
