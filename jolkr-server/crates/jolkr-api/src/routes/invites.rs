use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Serialize;
use uuid::Uuid;

use jolkr_core::InviteService;
use jolkr_core::services::invite::{CreateInviteRequest, InviteInfo};

use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::routes::AppState;

#[derive(Serialize)]
pub struct InviteResponse {
    pub invite: InviteInfo,
}

#[derive(Serialize)]
pub struct InvitesResponse {
    pub invites: Vec<InviteInfo>,
}

pub async fn create_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateInviteRequest>,
) -> Result<Json<InviteResponse>, AppError> {
    let invite =
        InviteService::create_invite(&state.pool, server_id, auth.user_id, body).await?;
    Ok(Json(InviteResponse { invite }))
}

pub async fn use_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(code): Path<String>,
) -> Result<Json<InviteResponse>, AppError> {
    let invite = InviteService::use_invite(&state.pool, &code, auth.user_id).await?;

    // Notify server members of the new member
    let event = crate::ws::events::GatewayEvent::MemberJoin {
        server_id: invite.server_id,
        user_id: auth.user_id,
    };
    state.nats.publish_to_server(invite.server_id, &event).await;

    // Also auto-subscribe the joining user's WS sessions to this server.
    // Collect session IDs first to avoid DashMap deadlock: iter() holds a
    // read-lock on each shard, and subscribe_server() needs a write-lock.
    let session_ids: Vec<Uuid> = state.gateway.clients.iter()
        .filter(|entry| entry.value().user_id == auth.user_id)
        .map(|entry| entry.value().session_id)
        .collect();
    for session_id in session_ids {
        state.gateway.subscribe_server(&session_id, invite.server_id);
    }

    Ok(Json(InviteResponse { invite }))
}

pub async fn list_invites(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<InvitesResponse>, AppError> {
    let invites =
        InviteService::list_invites(&state.pool, server_id, auth.user_id).await?;
    Ok(Json(InvitesResponse { invites }))
}

pub async fn delete_invite(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, invite_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    InviteService::delete_invite(&state.pool, invite_id, auth.user_id, server_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
