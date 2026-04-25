use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::repo::{AuditLogRepo, MemberRepo, RoleRepo, ServerRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

#[derive(Debug, Serialize)]
pub(crate) struct AuditLogEntry {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub action_type: String,
    pub target_id: Option<Uuid>,
    pub target_type: Option<String>,
    pub changes: Option<serde_json::Value>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub(crate) struct AuditLogResponse {
    pub entries: Vec<AuditLogEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AuditLogQuery {
    pub action: Option<String>,
    pub limit: Option<i64>,
    pub before: Option<DateTime<Utc>>,
}

/// GET /api/servers/:server_id/audit-log — requires MANAGE_SERVER or owner
pub(crate) async fn get_audit_log(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Query(query): Query<AuditLogQuery>,
) -> Result<Json<AuditLogResponse>, AppError> {
    let server = ServerRepo::get_by_id(&state.pool, server_id).await?;

    // Permission check: owner or MANAGE_SERVER
    if server.owner_id != auth.user_id {
        let member = MemberRepo::get_member(&state.pool, server_id, auth.user_id)
            .await
            .map_err(|_| AppError(JolkrError::Forbidden))?;
        let perms = RoleRepo::compute_permissions(&state.pool, server_id, member.id).await?;
        if !Permissions::from(perms).has(Permissions::MANAGE_SERVER) {
            return Err(AppError(JolkrError::Forbidden));
        }
    }

    let limit = query.limit.unwrap_or(50).min(100).max(1);
    let rows = AuditLogRepo::list_for_server(
        &state.pool,
        server_id,
        query.action.as_deref(),
        limit,
        query.before,
    )
    .await?;

    let entries = rows
        .into_iter()
        .map(|r| AuditLogEntry {
            id: r.id,
            server_id: r.server_id,
            user_id: r.user_id,
            action_type: r.action_type,
            target_id: r.target_id,
            target_type: r.target_type,
            changes: r.changes,
            reason: r.reason,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(AuditLogResponse { entries }))
}
