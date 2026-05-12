use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::RoleRow;
use jolkr_db::repo::{MemberRepo, RoleRepo, ServerRepo};

/// Public role DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Display name.
    pub name: String,
    /// Color value (RGB).
    pub color: i32,
    /// Sort position.
    pub position: i32,
    /// Permission bitmask.
    pub permissions: i64,
    /// Whether this is the default entry.
    pub is_default: bool,
}

impl From<RoleRow> for RoleInfo {
    fn from(row: RoleRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            name: row.name,
            color: row.color,
            position: row.position,
            permissions: row.permissions,
            is_default: row.is_default,
        }
    }
}

/// Request payload for the `CreateRole` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoleRequest {
    /// Display name.
    pub name: String,
    /// Color value (RGB).
    pub color: Option<i32>,
    /// Permission bitmask.
    pub permissions: Option<i64>,
}

/// Request payload for the `UpdateRole` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRoleRequest {
    /// Display name.
    pub name: Option<String>,
    /// Color value (RGB).
    pub color: Option<i32>,
    /// Sort position.
    pub position: Option<i32>,
    /// Permission bitmask.
    pub permissions: Option<i64>,
}

/// Domain service for `role` operations.
pub struct RoleService;

impl RoleService {
    /// Create the default @everyone role for a newly created server.
    #[tracing::instrument(skip(pool))]
    pub async fn create_default_role(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<RoleInfo, JolkrError> {
        let id = Uuid::new_v4();
        let row = RoleRepo::create(
            pool,
            id,
            server_id,
            "@everyone",
            0, // no color
            0, // lowest position
            Permissions::DEFAULT as i64,
            true, // is_default
        )
        .await?;
        info!(role_id = %id, server_id = %server_id, "Default @everyone role created");
        Ok(RoleInfo::from(row))
    }

    /// Create a new custom role. Requires `MANAGE_ROLES` or server owner.
    #[tracing::instrument(skip(pool, req))]
    pub async fn create_role(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        req: CreateRoleRequest,
    ) -> Result<RoleInfo, JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            check_permission(pool, server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        let name = req.name.trim().to_owned();
        if name.is_empty() || name.len() > 100 {
            return Err(JolkrError::Validation(
                "Role name must be between 1 and 100 characters".into(),
            ));
        }

        let id = Uuid::new_v4();
        let existing = RoleRepo::list_for_server(pool, server_id).await?;
        let position = existing.len() as i32;

        let row = RoleRepo::create(
            pool,
            id,
            server_id,
            &name,
            req.color.unwrap_or(0),
            position,
            req.permissions.unwrap_or(0),
            false,
        )
        .await?;

        info!(role_id = %id, server_id = %server_id, "Role created");
        Ok(RoleInfo::from(row))
    }

    /// List all roles in a server.
    #[tracing::instrument(skip(pool))]
    pub async fn list_roles(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<RoleInfo>, JolkrError> {
        let rows = RoleRepo::list_for_server(pool, server_id).await?;
        Ok(rows.into_iter().map(RoleInfo::from).collect())
    }

    /// Update a role. Cannot change @everyone's `is_default` status.
    #[tracing::instrument(skip(pool, req))]
    pub async fn update_role(
        pool: &PgPool,
        role_id: Uuid,
        caller_id: Uuid,
        req: UpdateRoleRequest,
    ) -> Result<RoleInfo, JolkrError> {
        let role = RoleRepo::get_by_id(pool, role_id).await?;
        let server = ServerRepo::get_by_id(pool, role.server_id).await?;
        if server.owner_id != caller_id {
            check_permission(pool, role.server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        if let Some(ref name) = req.name {
            let name = name.trim();
            if name.is_empty() || name.len() > 100 {
                return Err(JolkrError::Validation(
                    "Role name must be between 1 and 100 characters".into(),
                ));
            }
        }

        let row = RoleRepo::update(
            pool,
            role_id,
            req.name.as_deref(),
            req.color,
            req.position,
            req.permissions,
        )
        .await?;

        Ok(RoleInfo::from(row))
    }

    /// Delete a role. Cannot delete the @everyone role.
    #[tracing::instrument(skip(pool))]
    pub async fn delete_role(
        pool: &PgPool,
        role_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let role = RoleRepo::get_by_id(pool, role_id).await?;
        if role.is_default {
            return Err(JolkrError::BadRequest(
                "Cannot delete the @everyone role".into(),
            ));
        }
        let server = ServerRepo::get_by_id(pool, role.server_id).await?;
        if server.owner_id != caller_id {
            check_permission(pool, role.server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        RoleRepo::delete(pool, role_id).await?;
        info!(role_id = %role_id, "Role deleted");
        Ok(())
    }

    /// Assign a role to a member.
    #[tracing::instrument(skip(pool))]
    pub async fn assign_role(
        pool: &PgPool,
        server_id: Uuid,
        target_user_id: Uuid,
        role_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            check_permission(pool, server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        // Verify role belongs to this server
        let role = RoleRepo::get_by_id(pool, role_id).await?;
        if role.server_id != server_id {
            return Err(JolkrError::BadRequest("Role does not belong to this server".into()));
        }

        let member = MemberRepo::get_member(pool, server_id, target_user_id)
            .await
            .map_err(|_| JolkrError::NotFound)?;

        RoleRepo::assign_role(pool, member.id, role_id).await?;
        info!(role_id = %role_id, user_id = %target_user_id, "Role assigned");
        Ok(())
    }

    /// Remove a role from a member.
    #[tracing::instrument(skip(pool))]
    pub async fn remove_role(
        pool: &PgPool,
        server_id: Uuid,
        target_user_id: Uuid,
        role_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            check_permission(pool, server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        let member = MemberRepo::get_member(pool, server_id, target_user_id)
            .await
            .map_err(|_| JolkrError::NotFound)?;

        RoleRepo::remove_role(pool, member.id, role_id).await?;
        info!(role_id = %role_id, user_id = %target_user_id, "Role removed");
        Ok(())
    }

    /// Get computed permissions for a user in a server.
    #[tracing::instrument(skip(pool))]
    pub async fn get_permissions(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<i64, JolkrError> {
        // Server owner always has all permissions
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id == user_id {
            return Ok(Permissions::ALL as i64);
        }

        let member = MemberRepo::get_member(pool, server_id, user_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;

        RoleRepo::compute_permissions(pool, server_id, member.id).await
    }
}

/// Helper: check if a user has a specific permission in a server.
#[tracing::instrument(skip(pool))]
pub async fn check_permission(
    pool: &PgPool,
    server_id: Uuid,
    user_id: Uuid,
    permission: u64,
) -> Result<(), JolkrError> {
    let member = MemberRepo::get_member(pool, server_id, user_id)
        .await
        .map_err(|_| JolkrError::Forbidden)?;
    let perms_bits = RoleRepo::compute_permissions(pool, server_id, member.id).await?;
    let perms = Permissions::from(perms_bits);
    if !perms.has(permission) {
        return Err(JolkrError::Forbidden);
    }
    Ok(())
}
