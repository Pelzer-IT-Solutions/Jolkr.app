use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::ServerRow;
use jolkr_db::models::BanRow;
use jolkr_db::repo::{BanRepo, ChannelOverwriteRepo, ChannelRepo, MemberRepo, RoleRepo, ServerRepo};

/// Public server DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub owner_id: Uuid,
}

impl From<ServerRow> for ServerInfo {
    fn from(row: ServerRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            description: row.description,
            icon_url: row.icon_url,
            banner_url: row.banner_url,
            owner_id: row.owner_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BanMemberRequest {
    pub user_id: Uuid,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetNicknameRequest {
    pub nickname: Option<String>,
}

/// Public ban DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BanInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub banned_by: Option<Uuid>,
    pub reason: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<BanRow> for BanInfo {
    fn from(row: BanRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            user_id: row.user_id,
            banned_by: row.banned_by,
            reason: row.reason,
            created_at: row.created_at,
        }
    }
}

pub struct ServerService;

impl ServerService {
    /// Create a new server. The caller becomes the owner and first member.
    /// A default "general" text channel is auto-created.
    pub async fn create_server(
        pool: &PgPool,
        owner_id: Uuid,
        req: CreateServerRequest,
    ) -> Result<ServerInfo, JolkrError> {
        if req.name.is_empty() || req.name.len() > 100 {
            return Err(JolkrError::Validation(
                "Server name must be between 1 and 100 characters".into(),
            ));
        }

        let server_id = Uuid::new_v4();
        let server_row = ServerRepo::create_server(
            pool,
            server_id,
            &req.name,
            req.description.as_deref(),
            owner_id,
        )
        .await?;

        // H10: Add owner as the first member
        MemberRepo::add_member(pool, server_id, owner_id).await?;

        // Auto-create default @everyone role
        let role_id = Uuid::new_v4();
        RoleRepo::create(pool, role_id, server_id, "@everyone", 0, 0, Permissions::DEFAULT as i64, true)
            .await?;

        // Auto-create a default "general" text channel
        let channel_id = Uuid::new_v4();
        ChannelRepo::create_channel(pool, channel_id, server_id, None, "general", "text", 0)
            .await?;

        info!(server_id = %server_id, owner_id = %owner_id, "Server created");
        Ok(ServerInfo::from(server_row))
    }

    /// Get server info by ID. Only members should be able to call this (checked at API layer).
    pub async fn get_server(pool: &PgPool, server_id: Uuid) -> Result<ServerInfo, JolkrError> {
        let row = ServerRepo::get_by_id(pool, server_id).await?;
        Ok(ServerInfo::from(row))
    }

    /// List all servers the given user is a member of.
    pub async fn list_servers(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<ServerInfo>, JolkrError> {
        let rows = ServerRepo::list_for_user(pool, user_id).await?;
        Ok(rows.into_iter().map(ServerInfo::from).collect())
    }

    /// Update server metadata. Only the owner may do this.
    pub async fn update_server(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        req: UpdateServerRequest,
    ) -> Result<ServerInfo, JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            return Err(JolkrError::Forbidden);
        }

        // Validate name if provided
        if let Some(ref name) = req.name {
            let name = name.trim();
            if name.is_empty() || name.len() > 100 {
                return Err(JolkrError::Validation(
                    "Server name must be between 1 and 100 characters".into(),
                ));
            }
        }

        // Validate description length if provided
        if let Some(ref desc) = req.description {
            if desc.len() > 1024 {
                return Err(JolkrError::Validation(
                    "Server description cannot exceed 1024 characters".into(),
                ));
            }
        }

        let updated = ServerRepo::update(
            pool,
            server_id,
            req.name.as_deref(),
            req.description.as_deref(),
            req.icon_url.as_deref(),
            req.banner_url.as_deref(),
        )
        .await?;

        Ok(ServerInfo::from(updated))
    }

    /// Delete a server. Only the owner may do this.
    pub async fn delete_server(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            return Err(JolkrError::Forbidden);
        }
        ServerRepo::delete(pool, server_id).await?;
        info!(server_id = %server_id, "Server deleted");
        Ok(())
    }

    /// Join a server (add member). Banned users cannot join.
    pub async fn join_server(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        // Verify server exists
        let _server = ServerRepo::get_by_id(pool, server_id).await?;
        // Check if user is banned
        if BanRepo::is_banned(pool, server_id, user_id).await? {
            return Err(JolkrError::Forbidden);
        }
        MemberRepo::add_member(pool, server_id, user_id).await?;
        info!(server_id = %server_id, user_id = %user_id, "User joined server");
        Ok(())
    }

    /// Leave a server. The owner cannot leave their own server.
    pub async fn leave_server(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id == user_id {
            return Err(JolkrError::BadRequest(
                "Server owner cannot leave. Transfer ownership or delete the server.".into(),
            ));
        }
        // Clean up member overwrites before removing membership
        if let Ok(member) = MemberRepo::get_member(pool, server_id, user_id).await {
            ChannelOverwriteRepo::delete_by_target(pool, "member", member.id).await?;
        }
        MemberRepo::remove_member(pool, server_id, user_id).await?;
        info!(server_id = %server_id, user_id = %user_id, "User left server");
        Ok(())
    }

    // ── Moderation ─────────────────────────────────────────────────────

    /// Kick a member from the server. Requires KICK_MEMBERS permission.
    pub async fn kick_member(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        // Cannot kick yourself
        if caller_id == target_user_id {
            return Err(JolkrError::BadRequest("Cannot kick yourself".into()));
        }
        // Cannot kick the owner
        if server.owner_id == target_user_id {
            return Err(JolkrError::BadRequest("Cannot kick the server owner".into()));
        }

        // Check permission (owner always has all perms)
        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::KICK_MEMBERS).await?;
        }

        // Get member ID before removal for overwrite cleanup
        if let Ok(member) = MemberRepo::get_member(pool, server_id, target_user_id).await {
            ChannelOverwriteRepo::delete_by_target(pool, "member", member.id).await?;
        }
        MemberRepo::remove_member(pool, server_id, target_user_id).await?;
        info!(server_id = %server_id, caller_id = %caller_id, target = %target_user_id, "Member kicked");
        Ok(())
    }

    /// Ban a member from the server. Requires BAN_MEMBERS permission.
    /// Creates a ban record and removes the member.
    pub async fn ban_member(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        req: BanMemberRequest,
    ) -> Result<BanInfo, JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        // Cannot ban yourself
        if caller_id == req.user_id {
            return Err(JolkrError::BadRequest("Cannot ban yourself".into()));
        }
        // Cannot ban the owner
        if server.owner_id == req.user_id {
            return Err(JolkrError::BadRequest("Cannot ban the server owner".into()));
        }

        // Validate reason length
        if let Some(ref reason) = req.reason {
            if reason.len() > 512 {
                return Err(JolkrError::Validation(
                    "Ban reason cannot exceed 512 characters".into(),
                ));
            }
        }

        // Check permission
        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::BAN_MEMBERS).await?;
        }

        // Clean up member overwrites before ban (which removes membership)
        if let Ok(member) = MemberRepo::get_member(pool, server_id, req.user_id).await {
            ChannelOverwriteRepo::delete_by_target(pool, "member", member.id).await?;
        }

        // Remove the member from the server
        MemberRepo::remove_member(pool, server_id, req.user_id).await.ok(); // may already not be a member

        let ban = BanRepo::create_ban(
            pool,
            server_id,
            req.user_id,
            caller_id,
            req.reason.as_deref(),
        )
        .await?;

        info!(server_id = %server_id, caller_id = %caller_id, target = %req.user_id, "Member banned");
        Ok(BanInfo::from(ban))
    }

    /// Unban a user from the server. Requires BAN_MEMBERS permission.
    pub async fn unban_member(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::BAN_MEMBERS).await?;
        }

        BanRepo::remove_ban(pool, server_id, target_user_id).await?;
        info!(server_id = %server_id, caller_id = %caller_id, target = %target_user_id, "Member unbanned");
        Ok(())
    }

    /// List all bans for a server. Requires BAN_MEMBERS permission.
    pub async fn list_bans(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<BanInfo>, JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::BAN_MEMBERS).await?;
        }

        let bans = BanRepo::list_bans(pool, server_id).await?;
        Ok(bans.into_iter().map(BanInfo::from).collect())
    }

    /// Set a member's nickname. Requires MANAGE_NICKNAMES for others, CHANGE_NICKNAME for self.
    pub async fn set_nickname(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        target_user_id: Uuid,
        req: SetNicknameRequest,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        if caller_id == target_user_id {
            // Changing own nickname — CHANGE_NICKNAME
            if server.owner_id != caller_id {
                Self::check_permission(pool, server_id, caller_id, Permissions::CHANGE_NICKNAME).await?;
            }
        } else {
            // Changing someone else's nickname — MANAGE_NICKNAMES
            if server.owner_id != caller_id {
                Self::check_permission(pool, server_id, caller_id, Permissions::MANAGE_NICKNAMES).await?;
            }
        }

        let nickname = req.nickname.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if let Some(ref nick) = nickname {
            if nick.len() > 32 {
                return Err(JolkrError::Validation(
                    "Nickname cannot exceed 32 characters".into(),
                ));
            }
        }
        MemberRepo::update_nickname(pool, server_id, target_user_id, nickname.as_deref()).await?;
        info!(server_id = %server_id, target = %target_user_id, "Nickname updated");
        Ok(())
    }

    /// Timeout a member. Requires MODERATE_MEMBERS permission.
    pub async fn timeout_member(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        target_user_id: Uuid,
        timeout_until: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        if caller_id == target_user_id {
            return Err(JolkrError::BadRequest("Cannot timeout yourself".into()));
        }
        if server.owner_id == target_user_id {
            return Err(JolkrError::BadRequest("Cannot timeout the server owner".into()));
        }

        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::MODERATE_MEMBERS).await?;
        }

        MemberRepo::set_timeout(pool, server_id, target_user_id, timeout_until).await?;
        info!(server_id = %server_id, target = %target_user_id, "Member timeout set");
        Ok(())
    }

    /// Remove timeout from a member. Requires MODERATE_MEMBERS permission.
    pub async fn remove_timeout(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let server = ServerRepo::get_by_id(pool, server_id).await?;

        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::MODERATE_MEMBERS).await?;
        }

        MemberRepo::set_timeout(pool, server_id, target_user_id, None).await?;
        info!(server_id = %server_id, target = %target_user_id, "Member timeout removed");
        Ok(())
    }

    /// Helper: check if a user has a specific permission in a server.
    async fn check_permission(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        permission: u64,
    ) -> Result<(), JolkrError> {
        let member = MemberRepo::get_member(pool, server_id, user_id)
            .await
            .map_err(|e| match e {
                JolkrError::NotFound => JolkrError::Forbidden,
                other => other,
            })?;
        let perms_bits = RoleRepo::compute_permissions(pool, server_id, member.id).await?;
        let perms = Permissions::from(perms_bits);
        if !perms.has(permission) {
            return Err(JolkrError::Forbidden);
        }
        Ok(())
    }
}
