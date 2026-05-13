use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::repo::{AuditLogRepo, MemberRepo, RoleRepo, ServerRepo};

use crate::errors::AppError;
use crate::middleware::AuthUser;
use crate::routes::AppState;

/// A single entry in the server audit log.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename = "AuditLogEntry")]
pub(crate) struct AuditLogEntry {
    pub id: Uuid,
    pub server_id: Uuid,
    /// User who performed the action.
    pub user_id: Uuid,
    /// Action identifier, e.g. `channel_create`, `channel_delete`, `member_kick`, `role_update`.
    pub action_type: String,
    /// ID of the affected entity (channel, member, role, …), when applicable.
    pub target_id: Option<Uuid>,
    /// Entity kind for `target_id`, e.g. `"channel"`, `"member"`, `"role"`.
    pub target_type: Option<String>,
    /// Action-specific structured payload (renamed fields, before/after values, etc.).
    #[ts(type = "Record<string, unknown> | null")]
    pub changes: Option<serde_json::Value>,
    /// Optional moderator-supplied reason string.
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Response body for GET /api/servers/:server_id/audit-log.
#[derive(Debug, Serialize)]
pub(crate) struct AuditLogResponse {
    pub entries: Vec<AuditLogEntry>,
}

/// Query parameters for GET /api/servers/:server_id/audit-log.
#[derive(Debug, Deserialize)]
pub(crate) struct AuditLogQuery {
    /// Optional filter on `action_type` (exact match).
    pub action: Option<String>,
    /// Page size; server clamps to [1, 100], defaults to 50.
    pub limit: Option<i64>,
    /// Cursor: only return entries strictly older than this timestamp.
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
            .map_err(|e| {
                tracing::warn!(?e, "audit-log: caller is not a server member → 403");
                AppError(JolkrError::Forbidden)
            })?;
        let perms = RoleRepo::compute_permissions(&state.pool, server_id, member.id).await?;
        if !Permissions::from(perms).has(Permissions::MANAGE_SERVER) {
            return Err(AppError(JolkrError::Forbidden));
        }
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 100);
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
