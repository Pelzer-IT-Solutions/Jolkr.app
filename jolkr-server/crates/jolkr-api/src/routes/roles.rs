use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::RoleService;
use jolkr_core::services::role::{CreateRoleRequest, RoleInfo, UpdateRoleRequest};
use jolkr_db::repo::{MemberRepo, RoleRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

// ── DTOs ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RoleResponse {
    pub role: RoleInfo,
}

#[derive(Debug, Serialize)]
pub struct RolesResponse {
    pub roles: Vec<RoleInfo>,
}

#[derive(Debug, Serialize)]
pub struct MemberWithRoles {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: String,
    pub role_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct MembersWithRolesResponse {
    pub members: Vec<MemberWithRoles>,
}

#[derive(Debug, Deserialize)]
pub struct AssignRoleBody {
    pub user_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct PermissionsResponse {
    pub permissions: i64,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// POST /api/servers/:server_id/roles
pub async fn create_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(body): Json<CreateRoleRequest>,
) -> Result<Json<RoleResponse>, AppError> {
    let role =
        RoleService::create_role(&state.pool, server_id, auth.user_id, body).await?;
    Ok(Json(RoleResponse { role }))
}

/// GET /api/servers/:server_id/roles — requires membership
pub async fn list_roles(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<RolesResponse>, AppError> {
    MemberRepo::get_member(&state.pool, server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;
    let roles = RoleService::list_roles(&state.pool, server_id).await?;
    Ok(Json(RolesResponse { roles }))
}

/// PATCH /api/roles/:id
pub async fn update_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateRoleRequest>,
) -> Result<Json<RoleResponse>, AppError> {
    let role = RoleService::update_role(&state.pool, id, auth.user_id, body).await?;
    Ok(Json(RoleResponse { role }))
}

/// DELETE /api/roles/:id
pub async fn delete_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::http::StatusCode, AppError> {
    RoleService::delete_role(&state.pool, id, auth.user_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// PUT /api/servers/:server_id/roles/:role_id/members — assign role
pub async fn assign_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    Json(body): Json<AssignRoleBody>,
) -> Result<axum::http::StatusCode, AppError> {
    RoleService::assign_role(&state.pool, server_id, body.user_id, role_id, auth.user_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// DELETE /api/servers/:server_id/roles/:role_id/members/:user_id — remove role
pub async fn remove_role(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, role_id, user_id)): Path<(Uuid, Uuid, Uuid)>,
) -> Result<axum::http::StatusCode, AppError> {
    RoleService::remove_role(&state.pool, server_id, user_id, role_id, auth.user_id).await?;
    Ok(axum::http::StatusCode::NO_CONTENT)
}

/// GET /api/servers/:server_id/members-with-roles — members with their role_ids
pub async fn list_members_with_roles(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<MembersWithRolesResponse>, AppError> {
    MemberRepo::get_member(&state.pool, server_id, auth.user_id)
        .await
        .map_err(|_| AppError(jolkr_common::JolkrError::Forbidden))?;

    let members = MemberRepo::list_for_server(&state.pool, server_id).await?;
    let role_assignments = RoleRepo::get_roles_for_server_members(&state.pool, server_id).await?;

    // Build member_id -> Vec<role_id> map
    let mut role_map: std::collections::HashMap<Uuid, Vec<Uuid>> = std::collections::HashMap::new();
    for (member_id, role_id) in role_assignments {
        role_map.entry(member_id).or_default().push(role_id);
    }

    let result: Vec<MemberWithRoles> = members
        .into_iter()
        .map(|m| MemberWithRoles {
            id: m.id,
            server_id: m.server_id,
            user_id: m.user_id,
            nickname: m.nickname,
            joined_at: m.joined_at.to_rfc3339(),
            role_ids: role_map.remove(&m.id).unwrap_or_default(),
        })
        .collect();

    Ok(Json(MembersWithRolesResponse { members: result }))
}

/// GET /api/servers/:server_id/permissions/@me — get caller's permissions
pub async fn get_my_permissions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> Result<Json<PermissionsResponse>, AppError> {
    let permissions = RoleService::get_permissions(&state.pool, server_id, auth.user_id).await?;
    Ok(Json(PermissionsResponse { permissions }))
}
