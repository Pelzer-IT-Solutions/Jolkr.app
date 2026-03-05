use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::ServerService;
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

#[derive(Debug, Serialize)]
pub struct ServerResponse {
    pub server: ServerInfo,
}

#[derive(Debug, Serialize)]
pub struct ServersResponse {
    pub servers: Vec<ServerInfo>,
}

#[derive(Debug, Serialize)]
pub struct MembersResponse {
    pub members: Vec<MemberRow>,
}

#[derive(Debug, Serialize)]
pub struct BanResponse {
    pub ban: BanInfo,
}

#[derive(Debug, Serialize)]
pub struct BansResponse {
    pub bans: Vec<BanInfo>,
}

#[derive(Debug, Deserialize)]
pub struct NicknameBody {
    pub nickname: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────

/// Re-presign icon_url/banner_url if they look like S3 keys (not full URLs).
async fn presign_server_urls(state: &AppState, server: &mut ServerInfo) {
    for url_opt in [&mut server.icon_url, &mut server.banner_url] {
        if let Some(ref key) = url_opt {
            if !key.starts_with("http") {
                if let Ok(url) = state.storage.presign_get(key, 7 * 24 * 3600).await {
                    *url_opt = Some(url);
                }
            }
        }
    }
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/servers
pub async fn create_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<CreateServerRequest>,
) -> Result<Json<ServerResponse>, AppError> {
    let mut server = ServerService::create_server(&state.pool, auth.user_id, body).await?;
    presign_server_urls(&state, &mut server).await;
    Ok(Json(ServerResponse { server }))
}

/// GET /api/servers
pub async fn list_servers(
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
pub async fn get_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<ServerResponse>, AppError> {
    // Verify caller is a member
    MemberRepo::get_member(&state.pool, id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    let mut server = ServerService::get_server(&state.pool, id).await?;
    presign_server_urls(&state, &mut server).await;
    Ok(Json(ServerResponse { server }))
}

/// PATCH /api/servers/:id
pub async fn update_server(
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
pub async fn delete_server(
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
pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<MembersResponse>, AppError> {
    // Verify caller is a member
    MemberRepo::get_member(&state.pool, id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    let members = MemberRepo::list_for_server(&state.pool, id).await?;
    Ok(Json(MembersResponse { members }))
}

/// DELETE /api/servers/:id/members/@me — leave the server
pub async fn leave_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::leave_server(&state.pool, id, auth.user_id).await?;

    let event = crate::ws::events::GatewayEvent::MemberLeave {
        server_id: id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_server(id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

// ── Moderation Handlers ────────────────────────────────────────────────

/// DELETE /api/servers/:id/members/:user_id — kick a member
pub async fn kick_member(
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
        let _ = jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_kick",
            Some(user_id), Some("user"), None, None,
        ).await;
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// POST /api/servers/:id/bans — ban a member
pub async fn ban_member(
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
        let _ = jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_ban",
            Some(banned_user_id), Some("user"), None, reason.as_deref(),
        ).await;
    });

    Ok(Json(BanResponse { ban }))
}

/// DELETE /api/servers/:id/bans/:user_id — unban a user
pub async fn unban_member(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::unban_member(&state.pool, server_id, auth.user_id, user_id).await?;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    tokio::spawn(async move {
        let _ = jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_unban",
            Some(user_id), Some("user"), None, None,
        ).await;
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/servers/:id/bans — list all bans
pub async fn list_bans(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<BansResponse>, AppError> {
    let bans = ServerService::list_bans(&state.pool, server_id, auth.user_id).await?;
    Ok(Json(BansResponse { bans }))
}

// ── Timeout Handlers ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TimeoutBody {
    pub timeout_until: DateTime<Utc>,
}

/// POST /api/servers/:id/members/:user_id/timeout — timeout a member
pub async fn timeout_member(
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
    let event = crate::ws::events::GatewayEvent::MemberUpdate {
        server_id,
        user_id,
        timeout_until: member.timeout_until.map(|t| t.to_rfc3339()),
    };
    state.nats.publish_to_server(server_id, &event).await;

    // Audit log
    let pool = state.pool.clone();
    let caller = auth.user_id;
    tokio::spawn(async move {
        let _ = jolkr_db::repo::AuditLogRepo::create(
            &pool, server_id, caller, "member_timeout",
            Some(user_id), Some("user"), None, None,
        ).await;
    });

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// DELETE /api/servers/:id/members/:user_id/timeout — remove timeout
pub async fn remove_timeout(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::remove_timeout(
        &state.pool, server_id, auth.user_id, user_id,
    ).await?;

    let event = crate::ws::events::GatewayEvent::MemberUpdate {
        server_id,
        user_id,
        timeout_until: None,
    };
    state.nats.publish_to_server(server_id, &event).await;

    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// PATCH /api/servers/:id/members/:user_id/nickname — set nickname
pub async fn set_nickname(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, user_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<NicknameBody>,
) -> Result<axum::http::StatusCode, AppError> {
    ServerService::set_nickname(
        &state.pool,
        server_id,
        auth.user_id,
        user_id,
        SetNicknameRequest { nickname: body.nickname },
    )
    .await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}
