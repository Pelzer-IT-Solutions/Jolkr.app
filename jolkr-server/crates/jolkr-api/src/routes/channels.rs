use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_common::{serde_helpers::double_option, JolkrError, Permissions};
use jolkr_core::ChannelService;
use jolkr_core::services::channel::{ChannelInfo, ChannelOverwriteInfo, CreateChannelRequest, UpdateChannelRequest, UpsertOverwriteRequest};
use jolkr_db::repo::{ChannelOverwriteRepo, ChannelRepo, MemberRepo, RoleRepo, ServerRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

/// Response body for endpoints returning a single channel.
#[derive(Debug, Serialize)]
pub(crate) struct ChannelResponse {
    pub channel: ChannelInfo,
}

/// Response body for endpoints returning a list of channels.
#[derive(Debug, Serialize)]
pub(crate) struct ChannelsResponse {
    pub channels: Vec<ChannelInfo>,
}

/// Response body for GET /api/channels/:id/permissions/@me — the caller's effective channel permissions.
#[derive(Debug, Serialize)]
pub(crate) struct PermissionsResponse {
    /// Bitmask of `Permissions` flags after role + overwrite layering for this channel.
    pub permissions: i64,
}

/// Response body for GET /api/channels/:id/overwrites.
#[derive(Debug, Serialize)]
pub(crate) struct OverwritesResponse {
    pub overwrites: Vec<ChannelOverwriteInfo>,
}

/// Response body for PUT /api/channels/:id/overwrites.
#[derive(Debug, Serialize)]
pub(crate) struct OverwriteResponse {
    pub overwrite: ChannelOverwriteInfo,
}

/// Member shape returned by `GET /api/channels/:id/members` — same fields as
/// `MemberWithRoles` from the roles route so the frontend can reuse its
/// existing `Member` type without a new shape.
#[derive(Debug, Serialize)]
pub(crate) struct ChannelMemberEntry {
    /// Member row id (server-membership identifier, NOT the user id).
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub nickname: Option<String>,
    /// RFC3339-formatted timestamp of when the user joined the server.
    pub joined_at: String,
    pub role_ids: Vec<Uuid>,
}

/// Response body for GET /api/channels/:id/members.
#[derive(Debug, Serialize)]
pub(crate) struct ChannelMembersResponse {
    pub members: Vec<ChannelMemberEntry>,
}

/// Request body for PUT /api/servers/:server_id/channels/reorder — reorder within current categories.
#[derive(Debug, Deserialize)]
pub(crate) struct ReorderChannelsRequest {
    pub channel_positions: Vec<ChannelPositionEntry>,
}

/// New position for a single channel in a reorder request.
#[derive(Debug, Deserialize)]
pub(crate) struct ChannelPositionEntry {
    pub id: Uuid,
    /// Zero-based sort index within the channel's current category.
    pub position: i32,
}

/// Request body for PUT /api/servers/:server_id/channels/move — reorder AND optionally re-parent.
#[derive(Debug, Deserialize)]
pub(crate) struct MoveChannelsRequest {
    pub items: Vec<MoveChannelEntry>,
}

/// New position (and optional new category) for a single channel in a move request.
#[derive(Debug, Deserialize)]
pub(crate) struct MoveChannelEntry {
    pub id: Uuid,
    /// Zero-based sort index within the target category.
    pub position: i32,
    /// Three-state field via double-Option: absent = keep current category, `null` = uncategorized, `Some(uuid)` = move to that category.
    #[serde(default, deserialize_with = "double_option::deserialize")]
    pub category_id: Option<Option<Uuid>>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// PUT /api/servers/:server_id/channels/move
pub(crate) async fn move_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<MoveChannelsRequest>,
) -> Result<Json<ChannelsResponse>, AppError> {
    let items: Vec<(Uuid, i32, Option<Option<Uuid>>)> = body
        .items
        .into_iter()
        .map(|e| (e.id, e.position, e.category_id))
        .collect();

    let channels = ChannelService::move_channels(
        &state.pool,
        server_id,
        auth.user_id,
        &items,
    )
    .await?;

    for channel in &channels {
        let event = crate::ws::events::GatewayEvent::ChannelUpdate {
            channel: channel.clone(),
        };
        state.nats.publish_to_server(server_id, &event).await;
    }

    Ok(Json(ChannelsResponse { channels }))
}

/// PUT /api/servers/:server_id/channels/reorder
pub(crate) async fn reorder_channels(
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
pub(crate) async fn create_channel(
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
        drop(jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "channel_create",
            Some(ch_id), Some("channel"),
            Some(serde_json::json!({"name": ch_name})), None,
        ).await);
    });

    Ok(Json(ChannelResponse { channel }))
}

/// GET /api/servers/:server_id/channels/list — requires membership, filters by VIEW_CHANNELS
pub(crate) async fn list_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<ChannelsResponse>, AppError> {
    let channels = ChannelService::list_channels(&state.pool, server_id, auth.user_id).await?;
    Ok(Json(ChannelsResponse { channels }))
}

/// GET /api/channels/:id — requires membership + VIEW_CHANNELS
pub(crate) async fn get_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ChannelResponse>, AppError> {
    let channel = ChannelService::get_channel(&state.pool, id).await?;
    let member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "get channel: caller is not a member of channel's server → 403");
            AppError(JolkrError::Forbidden)
        })?;
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
pub(crate) async fn update_channel(
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
pub(crate) async fn delete_channel(
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
        drop(jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "channel_delete",
            Some(id), Some("channel"),
            Some(serde_json::json!({"name": ch_name})), None,
        ).await);
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/channels/:id/permissions/@me
pub(crate) async fn get_my_channel_permissions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<PermissionsResponse>, AppError> {
    let permissions = ChannelService::get_channel_permissions(&state.pool, id, auth.user_id).await?;
    Ok(Json(PermissionsResponse { permissions }))
}

/// GET /api/channels/:id/members
///
/// Returns the subset of server members that can actually see this channel
/// (i.e. hold the `VIEW_CHANNELS` permission after role + overwrite layering).
/// Caller must themselves have `VIEW_CHANNELS` — otherwise the channel is
/// hidden from them entirely and this endpoint pretends it doesn't exist.
pub(crate) async fn list_channel_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> Result<Json<ChannelMembersResponse>, AppError> {
    let channel = ChannelRepo::get_by_id(&state.pool, channel_id).await?;
    let server = ServerRepo::get_by_id(&state.pool, channel.server_id).await?;

    // Caller must be a server member and have VIEW_CHANNELS on this channel
    // (the server owner short-circuits the permission check).
    let caller_has_access = if server.owner_id == auth.user_id {
        true
    } else {
        let caller_member = MemberRepo::get_member(&state.pool, channel.server_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::warn!(?e, "list channel members: caller is not a member of channel's server → 403");
                AppError(JolkrError::Forbidden)
            })?;
        let perms = RoleRepo::compute_channel_permissions(
            &state.pool,
            channel.server_id,
            channel_id,
            caller_member.id,
        ).await?;
        Permissions::from(perms).has(Permissions::VIEW_CHANNELS)
    };
    if !caller_has_access {
        return Err(AppError(JolkrError::Forbidden));
    }

    // Pull every dataset we need for the bulk computation in one go to avoid
    // N+1 queries: members list, role assignments+permissions, channel
    // overwrites, the @everyone role.
    let members = MemberRepo::list_for_server(&state.pool, channel.server_id).await?;
    let role_assignments = RoleRepo::list_roles_for_server_members(&state.pool, channel.server_id).await?;
    let role_perms_batch = RoleRepo::list_member_roles_batch(&state.pool, channel.server_id).await?;
    let overwrites = ChannelOverwriteRepo::list_for_channel(&state.pool, channel_id).await?;
    let everyone = RoleRepo::get_default(&state.pool, channel.server_id).await.ok();

    let member_user_pairs: Vec<(Uuid, Uuid)> =
        members.iter().map(|m| (m.id, m.user_id)).collect();

    let perms_by_member = RoleRepo::compute_channel_permissions_for_all_members(
        &member_user_pairs,
        &role_perms_batch,
        &overwrites,
        everyone.as_ref(),
        server.owner_id,
    );

    // Build member_id → role_ids map for the response.
    let mut role_map: std::collections::HashMap<Uuid, Vec<Uuid>> = std::collections::HashMap::new();
    for (member_id, role_id) in role_assignments {
        role_map.entry(member_id).or_default().push(role_id);
    }

    let result: Vec<ChannelMemberEntry> = members
        .into_iter()
        .filter(|m| {
            let perms = perms_by_member.get(&m.id).copied().unwrap_or(0);
            Permissions::from(perms).has(Permissions::VIEW_CHANNELS)
        })
        .map(|m| ChannelMemberEntry {
            id: m.id,
            server_id: m.server_id,
            user_id: m.user_id,
            nickname: m.nickname,
            joined_at: m.joined_at.to_rfc3339(),
            role_ids: role_map.remove(&m.id).unwrap_or_default(),
        })
        .collect();

    Ok(Json(ChannelMembersResponse { members: result }))
}

/// GET /api/channels/:id/overwrites
pub(crate) async fn list_overwrites(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<OverwritesResponse>, AppError> {
    let overwrites = ChannelService::list_overwrites(&state.pool, id, auth.user_id).await?;
    Ok(Json(OverwritesResponse { overwrites }))
}

/// PUT /api/channels/:id/overwrites
pub(crate) async fn upsert_overwrite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpsertOverwriteRequest>,
) -> Result<Json<OverwriteResponse>, AppError> {
    let overwrite = ChannelService::upsert_overwrite(&state.pool, id, auth.user_id, body).await?;
    broadcast_channel_overwrites(&state, id).await;
    Ok(Json(OverwriteResponse { overwrite }))
}

/// Path parameters for DELETE /api/channels/:id/overwrites/:target_type/:target_id.
#[derive(Deserialize)]
pub(crate) struct OverwritePathParams {
    /// Channel id.
    pub id: Uuid,
    /// Overwrite scope — `"role"` or `"member"`.
    pub target_type: String,
    /// Id of the role or member the overwrite applies to (matches `target_type`).
    pub target_id: Uuid,
}

pub(crate) async fn delete_overwrite(
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
    broadcast_channel_overwrites(&state, params.id).await;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// Read the current overwrite list for a channel and broadcast it as a
/// `ChannelPermissionUpdate` event. Members whose effective channel-level
/// permissions are derived from these overwrites need to re-evaluate gated
/// UI (composer, manage-message buttons, etc.).
async fn broadcast_channel_overwrites(state: &AppState, channel_id: Uuid) {
    use jolkr_db::repo::ChannelOverwriteRepo;
    use jolkr_core::services::channel::ChannelOverwriteInfo;

    let channel = match ChannelRepo::get_by_id(&state.pool, channel_id).await {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("ChannelPermissionUpdate broadcast skipped — channel lookup failed: {e}");
            return;
        }
    };
    let rows = match ChannelOverwriteRepo::list_for_channel(&state.pool, channel_id).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("ChannelPermissionUpdate broadcast skipped — overwrite list failed: {e}");
            return;
        }
    };
    let overwrites = rows.into_iter().map(|r| ChannelOverwriteInfo {
        id: r.id,
        channel_id: r.channel_id,
        target_type: r.target_type,
        target_id: r.target_id,
        allow: r.allow,
        deny: r.deny,
    }).collect();

    let event = crate::ws::events::GatewayEvent::ChannelPermissionUpdate {
        channel_id,
        server_id: channel.server_id,
        overwrites,
    };
    state.nats.publish_to_server(channel.server_id, &event).await;
}

// ── Mark channel as read ────────────────────────────────────────────

/// Request body for POST /api/channels/:channel_id/read — advances the caller's read marker.
#[derive(Debug, Deserialize)]
pub(crate) struct MarkChannelReadRequest {
    /// Most-recent message id the caller has seen; the unread counter clears up to and including this id.
    pub message_id: Uuid,
}

/// POST /api/channels/:channel_id/read
pub(crate) async fn mark_channel_read(
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
