use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::ServerService;
use crate::routes::attachments::PRESIGN_EXPIRY_SECS;
use jolkr_core::services::server::{
    BanInfo, BanMemberRequest, CreateServerRequest, ServerInfo,
    SetNicknameRequest, UpdateServerRequest,
};
use jolkr_db::repo::MemberRepo;
use jolkr_db::models::MemberRow;

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

/// Response payload for single-server endpoints (create/get/update).
#[derive(Debug, Serialize)]
pub(crate) struct ServerResponse {
    pub server: ServerInfo,
}

/// Response payload for endpoints returning a list of servers.
#[derive(Debug, Serialize)]
pub(crate) struct ServersResponse {
    pub servers: Vec<ServerInfo>,
}

/// Response payload for GET /api/servers/:id/members.
#[derive(Debug, Serialize)]
pub(crate) struct MembersResponse {
    pub members: Vec<MemberRow>,
}

/// Response payload for POST /api/servers/:id/bans.
#[derive(Debug, Serialize)]
pub(crate) struct BanResponse {
    pub ban: BanInfo,
}

/// Response payload for GET /api/servers/:id/bans.
#[derive(Debug, Serialize)]
pub(crate) struct BansResponse {
    pub bans: Vec<BanInfo>,
}

/// Request body for PATCH /api/servers/:id/members/:user_id/nickname.
#[derive(Debug, Deserialize)]
pub(crate) struct NicknameBody {
    /// New nickname; `None` (or omitted) clears it back to the user's
    /// global `display_name`.
    pub nickname: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Re-presign icon_url/banner_url if they look like S3 keys (not full URLs).
async fn presign_server_urls(state: &AppState, server: &mut ServerInfo) {
    for url_opt in [&mut server.icon_url, &mut server.banner_url] {
        if let Some(key) = url_opt.as_deref() {
            if !key.starts_with("http") {
                if let Ok(url) = state.storage.presign_get(key, PRESIGN_EXPIRY_SECS).await {
                    *url_opt = Some(url);
                }
            }
        }
    }
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/servers
pub(crate) async fn create_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateServerRequest>,
) -> Result<Json<ServerResponse>, AppError> {
    let mut server = ServerService::create_server(&state.pool, auth.user_id, body).await?;
    presign_server_urls(&state, &mut server).await;
    Ok(Json(ServerResponse { server }))
}

/// GET /api/servers
pub(crate) async fn list_servers(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<ServersResponse>, AppError> {
    let mut servers = ServerService::list_servers(&state.pool, auth.user_id).await?;
    for s in &mut servers {
        presign_server_urls(&state, s).await;
    }
    Ok(Json(ServersResponse { servers }))
}

/// GET /api/servers/:id — requires membership
pub(crate) async fn get_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ServerResponse>, AppError> {
    // Verify caller is a member
    MemberRepo::get_member(&state.pool, id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "get server: caller is not a server member → 403");
            AppError(jolkr_common::JolkrError::Forbidden)
        })?;
    let mut server = ServerService::get_server(&state.pool, id).await?;
    presign_server_urls(&state, &mut server).await;
    Ok(Json(ServerResponse { server }))
}

/// PATCH /api/servers/:id
pub(crate) async fn update_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateServerRequest>,
) -> Result<Json<ServerResponse>, AppError> {
    let mut server =
        ServerService::update_server(&state.pool, id, auth.user_id, body).await?;
    presign_server_urls(&state, &mut server).await;

    let event = crate::ws::events::GatewayEvent::ServerUpdate {
        server: server.clone(),
    };
    state.nats.publish_to_server(id, &event).await;

    Ok(Json(ServerResponse { server }))
}

/// DELETE /api/servers/:id
pub(crate) async fn delete_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    // Broadcast delete BEFORE actually deleting (members still exist)
    let event = crate::ws::events::GatewayEvent::ServerDelete { server_id: id };
    state.nats.publish_to_server(id, &event).await;

    ServerService::delete_server(&state.pool, id, auth.user_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/servers/:id/members — requires membership
pub(crate) async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<MembersResponse>, AppError> {
    // Verify caller is a member
    MemberRepo::get_member(&state.pool, id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::warn!(?e, "list server members: caller is not a server member → 403");
            AppError(jolkr_common::JolkrError::Forbidden)
        })?;
    let members = MemberRepo::list_for_server(&state.pool, id).await?;
    Ok(Json(MembersResponse { members }))
}

/// DELETE /api/servers/:id/members/@me — leave the server
pub(crate) async fn leave_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::leave_server(&state.pool, id, auth.user_id).await?;

    // Tell remaining members that this user is gone.
    let leave_event = crate::ws::events::GatewayEvent::MemberLeave {
        server_id: id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_server(id, &leave_event).await;

    // Tell the leaver's OTHER sessions/devices that the server is gone for
    // them too — from their perspective the server no longer exists. Without
    // this, sibling tabs keep the server in the sidebar and a click 403s.
    // Done after the publish_to_server above so a session that was subscribed
    // to both subjects still sees both events.
    let delete_event = crate::ws::events::GatewayEvent::ServerDelete { server_id: id };
    state.nats.publish_to_user(auth.user_id, &delete_event).await;

    // Revoke the WS server subscription for this user across all their
    // sessions so they stop receiving events for a server they no longer
    // belong to.
    state.gateway.revoke_server_for_user(auth.user_id, id);

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Moderation Handlers ────────────────────────────────────────────────

/// DELETE /api/servers/:id/members/:user_id — kick a member
pub(crate) async fn kick_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::kick_member(&state.pool, server_id, auth.user_id, user_id).await?;

    // H8: Revoke WS server subscription for kicked user
    state.gateway.revoke_server_for_user(user_id, server_id);

    let event = crate::ws::events::GatewayEvent::MemberLeave {
        server_id,
        user_id,
    };
    state.nats.publish_to_server(server_id, &event).await;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    tokio::spawn(async move {
        drop(jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_kick",
            Some(user_id), Some("user"), None, None,
        ).await);
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/servers/:id/bans — ban a member
pub(crate) async fn ban_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<BanMemberRequest>,
) -> Result<Json<BanResponse>, AppError> {
    let banned_user_id = body.user_id;
    let reason = body.reason.clone();
    let ban = ServerService::ban_member(&state.pool, server_id, auth.user_id, body).await?;

    // H8: Revoke WS server subscription for banned user
    state.gateway.revoke_server_for_user(banned_user_id, server_id);

    let event = crate::ws::events::GatewayEvent::MemberLeave {
        server_id,
        user_id: banned_user_id,
    };
    state.nats.publish_to_server(server_id, &event).await;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    tokio::spawn(async move {
        drop(jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_ban",
            Some(banned_user_id), Some("user"), None, reason.as_deref(),
        ).await);
    });

    Ok(Json(BanResponse { ban }))
}

/// DELETE /api/servers/:id/bans/:user_id — unban a user
///
/// Intentionally emits NO WS event. The unbanned user is still not a server
/// member at this point — they have to rejoin via invite. From every existing
/// member's perspective nothing visible has changed, and from the unbanned
/// user's perspective they're still locked out until they redeem an invite.
/// The only consumer that needs to know is the bans-list view in
/// ServerSettings, which refetches on open.
pub(crate) async fn unban_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::unban_member(&state.pool, server_id, auth.user_id, user_id).await?;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    tokio::spawn(async move {
        drop(jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_unban",
            Some(user_id), Some("user"), None, None,
        ).await);
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/servers/:id/bans — list all bans
pub(crate) async fn list_bans(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<BansResponse>, AppError> {
    let bans = ServerService::list_bans(&state.pool, server_id, auth.user_id).await?;
    Ok(Json(BansResponse { bans }))
}

// ── Timeout Handlers ──────────────────────────────────────────────────

/// Request body for POST /api/servers/:id/members/:user_id/timeout.
#[derive(Debug, Deserialize)]
pub(crate) struct TimeoutBody {
    /// When the timeout expires. Must be in the future, max 28 days out.
    pub timeout_until: DateTime<Utc>,
}

/// POST /api/servers/:id/members/:user_id/timeout — timeout a member
pub(crate) async fn timeout_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<TimeoutBody>,
) -> Result<axum::http::StatusCode, AppError> {
    // M3: Validate timeout is in the future and max 28 days
    let now = Utc::now();
    if body.timeout_until <= now {
        return Err(AppError(jolkr_common::JolkrError::Validation("Timeout must be in the future".into())));
    }
    let max_duration = chrono::Duration::days(28);
    if body.timeout_until - now > max_duration {
        return Err(AppError(jolkr_common::JolkrError::Validation("Timeout cannot exceed 28 days".into())));
    }

    ServerService::timeout_member(
        &state.pool, server_id, auth.user_id, user_id, Some(body.timeout_until),
    ).await?;

    let member = MemberRepo::get_member(&state.pool, server_id, user_id).await?;
    // FE convention: empty string = cleared timeout, RFC3339 = active.
    let timeout_str = member.timeout_until.map_or_else(String::new, |t| t.to_rfc3339());
    let event = crate::ws::events::GatewayEvent::MemberUpdate {
        server_id,
        user_id,
        timeout_until: Some(timeout_str),
        nickname: None,
        role_ids: None,
    };
    state.nats.publish_to_server(server_id, &event).await;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    tokio::spawn(async move {
        drop(jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_timeout",
            Some(user_id), Some("user"), None, None,
        ).await);
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// DELETE /api/servers/:id/members/:user_id/timeout — remove timeout
pub(crate) async fn remove_timeout(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::remove_timeout(
        &state.pool, server_id, auth.user_id, user_id,
    ).await?;

    // Cleared timeout — empty string is the "cleared" sentinel.
    let event = crate::ws::events::GatewayEvent::MemberUpdate {
        server_id,
        user_id,
        timeout_until: Some(String::new()),
        nickname: None,
        role_ids: None,
    };
    state.nats.publish_to_server(server_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// PATCH /api/servers/:id/members/:user_id/nickname — set nickname
pub(crate) async fn set_nickname(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<NicknameBody>,
) -> Result<axum::http::StatusCode, AppError> {
    let new_nickname = ServerService::set_nickname(
        &state.pool,
        server_id,
        auth.user_id,
        user_id,
        SetNicknameRequest { nickname: body.nickname },
    )
    .await?;

    // Broadcast nickname change so all server members re-render the affected
    // member with their new display label. Empty string `""` is the "cleared"
    // sentinel — FE falls back to the user's global display_name.
    let nickname_payload = new_nickname.unwrap_or_default();
    let event = crate::ws::events::GatewayEvent::MemberUpdate {
        server_id,
        user_id,
        timeout_until: None,
        nickname: Some(nickname_payload),
        role_ids: None,
    };
    state.nats.publish_to_server(server_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Server Reordering ────────────────────────────────────────────────

/// Request body for PUT /api/users/@me/servers/reorder.
#[derive(Debug, Deserialize)]
pub(crate) struct ReorderServersRequest {
    /// Full ordered list of server IDs from top to bottom of the sidebar.
    pub server_ids: Vec<Uuid>,
}

/// PUT /api/users/@me/servers/reorder
pub(crate) async fn reorder_servers(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<ReorderServersRequest>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::reorder_servers(&state.pool, auth.user_id, &body.server_ids).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Discovery Handlers ────────────────────────────────────────────────

/// Query parameters for GET /api/servers/discover.
#[derive(Debug, Deserialize)]
pub(crate) struct DiscoverQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// GET /api/servers/discover — list public servers
pub(crate) async fn discover_servers(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(query): Query<DiscoverQuery>,
) -> Result<Json<ServersResponse>, AppError> {
    let limit = query.limit.unwrap_or(20);
    let offset = query.offset.unwrap_or(0);
    let mut servers = ServerService::discover_servers(&state.pool, limit, offset).await?;
    for s in &mut servers {
        presign_server_urls(&state, s).await;
    }
    Ok(Json(ServersResponse { servers }))
}

/// POST /api/servers/:id/join — join a public server
pub(crate) async fn join_public_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::join_public_server(&state.pool, server_id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MemberJoin {
        server_id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_server(server_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Mark server as read ─────────────────────────────────────────────

/// POST /api/servers/:server_id/read-all
pub(crate) async fn mark_server_read(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    use jolkr_db::repo::ChannelReadsRepo;

    ChannelReadsRepo::mark_server_read(&state.pool, auth.user_id, server_id).await?;

    let event = crate::ws::events::GatewayEvent::ServerMessagesRead {
        server_id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_user(auth.user_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}
