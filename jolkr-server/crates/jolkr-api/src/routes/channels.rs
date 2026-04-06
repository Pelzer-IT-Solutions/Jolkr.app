use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_core::ChannelService;
use jolkr_core::services::channel::{ChannelInfo, ChannelOverwriteInfo, CreateChannelRequest, UpdateChannelRequest, UpsertOverwriteRequest};
use jolkr_db::repo::{ChannelRepo, MemberRepo, RoleRepo, ServerRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct ChannelResponse {
    pub channel: ChannelInfo,
}

#[derive(Debug, Serialize)]
pub struct ChannelsResponse {
    pub channels: Vec<ChannelInfo>,
}

#[derive(Debug, Serialize)]
pub struct PermissionsResponse {
    pub permissions: i64,
}

#[derive(Debug, Serialize)]
pub struct OverwritesResponse {
    pub overwrites: Vec<ChannelOverwriteInfo>,
}

#[derive(Debug, Serialize)]
pub struct OverwriteResponse {
    pub overwrite: ChannelOverwriteInfo,
}

#[derive(Debug, Deserialize)]
pub struct ReorderChannelsRequest {
    pub channel_positions: Vec<ChannelPositionEntry>,
}

#[derive(Debug, Deserialize)]
pub struct ChannelPositionEntry {
    pub id: Uuid,
    pub position: i32,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// PUT /api/servers/:server_id/channels/reorder
pub async fn reorder_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<ReorderChannelsRequest>,
) -> Result<Json<ChannelsResponse>, AppError> {
    let positions: Vec<(Uuid, i32)> = body
        .channel_positions
        .iter()
        .map(|e| (e.id, e.position))
        .collect();

    let channels = ChannelService::reorder_channels(
        &state.pool,
        server_id,
        auth.user_id,
        &positions,
    )
    .await?;

    // Broadcast each channel update to server members via WS
    for channel in &channels {
        let event = crate::ws::events::GatewayEvent::ChannelUpdate {
            channel: channel.clone(),
        };
        state.nats.publish_to_server(server_id, &event).await;
    }

    Ok(Json(ChannelsResponse { channels }))
}

/// POST /api/servers/:server_id/channels
pub async fn create_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateChannelRequest>,
) -> Result<Json<ChannelResponse>, AppError> {
    let channel =
        ChannelService::create_channel(&state.pool, server_id, auth.user_id, body).await?;

    // Broadcast to all server members via WS
    let event = crate::ws::events::GatewayEvent::ChannelCreate {
        channel: channel.clone(),
    };
    state.nats.publish_to_server(server_id, &event).await;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    let ch_id = channel.id;
    let ch_name = channel.name.clone();
    tokio::spawn(async move {
        let _ = jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "channel_create",
            Some(ch_id), Some("channel"),
            Some(serde_json::json!({"name": ch_name})), None,
        ).await;
    });

    Ok(Json(ChannelResponse { channel }))
}

/// GET /api/servers/:server_id/channels/list — requires membership, filters by VIEW_CHANNELS
pub async fn list_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<ChannelsResponse>, AppError> {
    let channels = ChannelService::list_channels(&state.pool, server_id, auth.user_id).await?;
    Ok(Json(ChannelsResponse { channels }))
}

/// GET /api/channels/:id — requires membership + VIEW_CHANNELS
pub async fn get_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChannelResponse>, AppError> {
    let channel = ChannelService::get_channel(&state.pool, id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|_| AppError(JolkrError::Forbidden))?;
    // Check VIEW_CHANNELS (owner bypasses)
    let server = ServerRepo::get_by_id(&state.pool, channel.server_id).await?;
    if server.owner_id != auth.user_id {
        let perms = RoleRepo::compute_channel_permissions(
            &state.pool, channel.server_id, id, member.id,
        ).await?;
        if !Permissions::from(perms).has(Permissions::VIEW_CHANNELS) {
            return Err(AppError(JolkrError::Forbidden));
        }
    }
    Ok(Json(ChannelResponse { channel }))
}

/// PATCH /api/channels/:id
pub async fn update_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateChannelRequest>,
) -> Result<Json<ChannelResponse>, AppError> {
    let channel =
        ChannelService::update_channel(&state.pool, id, auth.user_id, body).await?;

    let event = crate::ws::events::GatewayEvent::ChannelUpdate {
        channel: channel.clone(),
    };
    state.nats.publish_to_server(channel.server_id, &event).await;

    Ok(Json(ChannelResponse { channel }))
}

/// DELETE /api/channels/:id
pub async fn delete_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    // Look up the channel's server_id before deleting
    let channel = ChannelRepo::get_by_id(&state.pool, id).await?;
    let server_id = channel.server_id;

    ChannelService::delete_channel(&state.pool, id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::ChannelDelete {
        channel_id: id,
        server_id,
    };
    state.nats.publish_to_server(server_id, &event).await;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    let ch_name = channel.name.clone();
    tokio::spawn(async move {
        let _ = jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "channel_delete",
            Some(id), Some("channel"),
            Some(serde_json::json!({"name": ch_name})), None,
        ).await;
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/channels/:id/permissions/@me
pub async fn get_my_channel_permissions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PermissionsResponse>, AppError> {
    let permissions = ChannelService::get_channel_permissions(&state.pool, id, auth.user_id).await?;
    Ok(Json(PermissionsResponse { permissions }))
}

/// GET /api/channels/:id/overwrites
pub async fn list_overwrites(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<OverwritesResponse>, AppError> {
    let overwrites = ChannelService::list_overwrites(&state.pool, id, auth.user_id).await?;
    Ok(Json(OverwritesResponse { overwrites }))
}

/// PUT /api/channels/:id/overwrites
pub async fn upsert_overwrite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertOverwriteRequest>,
) -> Result<Json<OverwriteResponse>, AppError> {
    let overwrite = ChannelService::upsert_overwrite(&state.pool, id, auth.user_id, body).await?;
    Ok(Json(OverwriteResponse { overwrite }))
}

/// DELETE /api/channels/:id/overwrites/:target_type/:target_id
#[derive(Deserialize)]
pub struct OverwritePathParams {
    pub id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
}

pub async fn delete_overwrite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(params): Path<OverwritePathParams>,
) -> Result<axum::http::StatusCode, AppError> {
    ChannelService::delete_overwrite(
        &state.pool,
        params.id,
        auth.user_id,
        &params.target_type,
        params.target_id,
    ).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Mark channel as read ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MarkChannelReadRequest {
    pub message_id: Uuid,
}

/// POST /api/channels/:channel_id/read
pub async fn mark_channel_read(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(body): Json<MarkChannelReadRequest>,
) -> Result<axum::http::StatusCode, AppError> {
    use jolkr_db::repo::ChannelReadsRepo;

    ChannelReadsRepo::mark_read(&state.pool, auth.user_id, channel_id, body.message_id).await?;

    // Broadcast to user's other sessions
    let event = crate::ws::events::GatewayEvent::ChannelMessagesRead {
        channel_id,
        user_id: auth.user_id,
        message_id: body.message_id,
    };
    state.nats.publish_to_user(auth.user_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
