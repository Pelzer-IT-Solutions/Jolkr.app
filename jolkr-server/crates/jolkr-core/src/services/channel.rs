use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::ChannelRow;
use jolkr_db::repo::{ChannelOverwriteRepo, ChannelRepo, MemberRepo, RoleRepo, ServerRepo};

/// Public channel DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInfo {
    pub id: Uuid,
    pub server_id: Uuid,
    pub category_id: Option<Uuid>,
    pub name: String,
    pub topic: Option<String>,
    pub kind: String,
    pub position: i32,
    pub is_nsfw: bool,
    pub slowmode_seconds: i32,
    pub e2ee_key_generation: i32,
}

impl From<ChannelRow> for ChannelInfo {
    fn from(row: ChannelRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            category_id: row.category_id,
            name: row.name,
            topic: row.topic,
            kind: row.kind,
            position: row.position,
            is_nsfw: row.is_nsfw,
            slowmode_seconds: row.slowmode_seconds,
            e2ee_key_generation: row.e2ee_key_generation,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    pub kind: Option<String>,
    pub category_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub position: Option<i32>,
    pub is_nsfw: Option<bool>,
    pub slowmode_seconds: Option<i32>,
    pub category_id: Option<Uuid>,
}

/// Channel overwrite DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelOverwriteInfo {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub allow: i64,
    pub deny: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertOverwriteRequest {
    pub target_type: String,
    pub target_id: Uuid,
    pub allow: i64,
    pub deny: i64,
}

/// Valid channel types.
const VALID_CHANNEL_KINDS: &[&str] = &["text", "voice"];

/// Maximum slowmode in seconds (6 hours, same as Discord).
const MAX_SLOWMODE_SECONDS: i32 = 21600;

/// Maximum topic length.
const MAX_TOPIC_LENGTH: usize = 1024;

pub struct ChannelService;

impl ChannelService {
    /// Create a new channel in a server. Requires MANAGE_CHANNELS or server owner.
    pub async fn create_channel(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        req: CreateChannelRequest,
    ) -> Result<ChannelInfo, JolkrError> {
        // Permission check: owner or MANAGE_CHANNELS
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::MANAGE_CHANNELS).await?;
        }

        // Validate channel name: 1-100 chars, lowercase alphanumeric + hyphens
        let name = req.name.trim().to_lowercase().replace(' ', "-");
        if name.is_empty() || name.len() > 100 {
            return Err(JolkrError::Validation(
                "Channel name must be between 1 and 100 characters".into(),
            ));
        }
        if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err(JolkrError::Validation(
                "Channel name can only contain lowercase letters, numbers, hyphens, and underscores".into(),
            ));
        }

        let kind = req.kind.as_deref().unwrap_or("text");
        if !VALID_CHANNEL_KINDS.contains(&kind) {
            return Err(JolkrError::Validation(
                format!("Channel kind must be one of: {}", VALID_CHANNEL_KINDS.join(", ")),
            ));
        }

        let channel_id = Uuid::new_v4();

        // Determine position (append at end)
        let existing = ChannelRepo::list_for_server(pool, server_id).await?;
        let position = existing.len() as i32;

        let row = ChannelRepo::create_channel(
            pool,
            channel_id,
            server_id,
            req.category_id,
            &name,
            kind,
            position,
        )
        .await?;

        info!(channel_id = %channel_id, server_id = %server_id, "Channel created");
        Ok(ChannelInfo::from(row))
    }

    /// Get channel info by ID.
    pub async fn get_channel(pool: &PgPool, channel_id: Uuid) -> Result<ChannelInfo, JolkrError> {
        let row = ChannelRepo::get_by_id(pool, channel_id).await?;
        Ok(ChannelInfo::from(row))
    }

    /// List all channels in a server, filtered by VIEW_CHANNELS permission.
    /// Server owner always sees all channels.
    pub async fn list_channels(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<ChannelInfo>, JolkrError> {
        let rows = ChannelRepo::list_for_server(pool, server_id).await?;

        // Server owner sees everything
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id == caller_id {
            return Ok(rows.into_iter().map(ChannelInfo::from).collect());
        }

        // Get member and compute base permissions
        let member = MemberRepo::get_member(pool, server_id, caller_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        let base_perms = RoleRepo::compute_permissions(pool, server_id, member.id).await?;

        // ADMINISTRATOR sees everything
        if base_perms as u64 & Permissions::ADMINISTRATOR != 0 {
            return Ok(rows.into_iter().map(ChannelInfo::from).collect());
        }

        // Batch-fetch all overwrites for this server
        let overwrites = ChannelOverwriteRepo::list_for_server(pool, server_id).await?;
        let member_role_ids = RoleRepo::get_member_role_ids(pool, member.id).await?;
        let everyone = RoleRepo::get_default(pool, server_id).await.ok();
        let everyone_role_id = everyone.as_ref().map(|r| r.id);

        let channel_ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
        let perms_map = RoleRepo::compute_channel_permissions_batch(
            base_perms,
            &channel_ids,
            &overwrites,
            &member_role_ids,
            everyone_role_id,
            member.id,
        );

        Ok(rows
            .into_iter()
            .filter(|row| {
                let ch_perms = perms_map.get(&row.id).copied().unwrap_or(base_perms);
                Permissions::from(ch_perms).has(Permissions::VIEW_CHANNELS)
            })
            .map(ChannelInfo::from)
            .collect())
    }

    /// Update channel metadata. Requires MANAGE_CHANNELS or server owner.
    pub async fn update_channel(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
        req: UpdateChannelRequest,
    ) -> Result<ChannelInfo, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, channel.server_id, caller_id, Permissions::MANAGE_CHANNELS).await?;
        }

        // Validate name if provided
        if let Some(ref name) = req.name {
            let name = name.trim();
            if name.is_empty() || name.len() > 100 {
                return Err(JolkrError::Validation(
                    "Channel name must be between 1 and 100 characters".into(),
                ));
            }
            if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err(JolkrError::Validation(
                    "Channel name can only contain lowercase letters, numbers, hyphens, and underscores".into(),
                ));
            }
        }

        // Validate topic length
        if let Some(ref topic) = req.topic {
            if topic.len() > MAX_TOPIC_LENGTH {
                return Err(JolkrError::Validation(
                    format!("Channel topic cannot exceed {MAX_TOPIC_LENGTH} characters"),
                ));
            }
        }

        // Validate slowmode range
        if let Some(seconds) = req.slowmode_seconds {
            if seconds < 0 || seconds > MAX_SLOWMODE_SECONDS {
                return Err(JolkrError::Validation(
                    format!("Slowmode must be between 0 and {MAX_SLOWMODE_SECONDS} seconds"),
                ));
            }
        }

        let mut updated = ChannelRepo::update(
            pool,
            channel_id,
            req.name.as_deref(),
            req.topic.as_deref(),
            req.position,
            req.is_nsfw,
            req.slowmode_seconds,
        )
        .await?;

        // Update category_id if provided (use set_category for explicit NULL support)
        if req.category_id.is_some() {
            updated = ChannelRepo::set_category(pool, channel_id, req.category_id).await?;
        }

        Ok(ChannelInfo::from(updated))
    }

    /// Delete a channel. Requires MANAGE_CHANNELS or server owner.
    pub async fn delete_channel(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, channel.server_id, caller_id, Permissions::MANAGE_CHANNELS).await?;
        }

        ChannelRepo::delete(pool, channel_id).await?;
        info!(channel_id = %channel_id, "Channel deleted");
        Ok(())
    }

    /// Get computed channel permissions for a user.
    pub async fn get_channel_permissions(
        pool: &PgPool,
        channel_id: Uuid,
        user_id: Uuid,
    ) -> Result<i64, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;

        // Owner gets all permissions
        if server.owner_id == user_id {
            return Ok(Permissions::ALL as i64);
        }

        let member = MemberRepo::get_member(pool, channel.server_id, user_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        RoleRepo::compute_channel_permissions(pool, channel.server_id, channel_id, member.id).await
    }

    /// List all overwrites for a channel. Requires MANAGE_CHANNELS.
    pub async fn list_overwrites(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<ChannelOverwriteInfo>, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, channel.server_id, caller_id, Permissions::MANAGE_CHANNELS).await?;
        }

        let rows = ChannelOverwriteRepo::list_for_channel(pool, channel_id).await?;
        Ok(rows.into_iter().map(|r| ChannelOverwriteInfo {
            id: r.id,
            channel_id: r.channel_id,
            target_type: r.target_type,
            target_id: r.target_id,
            allow: r.allow,
            deny: r.deny,
        }).collect())
    }

    /// Upsert a channel overwrite. Requires MANAGE_ROLES.
    pub async fn upsert_overwrite(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
        req: UpsertOverwriteRequest,
    ) -> Result<ChannelOverwriteInfo, JolkrError> {
        // Validate target_type
        if req.target_type != "role" && req.target_type != "member" {
            return Err(JolkrError::Validation(
                "target_type must be 'role' or 'member'".into(),
            ));
        }

        // Validate allow and deny don't overlap
        if req.allow & req.deny != 0 {
            return Err(JolkrError::Validation(
                "allow and deny must not have overlapping permission bits".into(),
            ));
        }

        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, channel.server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        // Validate target_id exists and belongs to this server
        if req.target_type == "role" {
            let role = RoleRepo::get_by_id(pool, req.target_id)
                .await
                .map_err(|_| JolkrError::Validation("Role not found".into()))?;
            if role.server_id != channel.server_id {
                return Err(JolkrError::Validation("Role does not belong to this server".into()));
            }
        } else {
            // For member overwrites, target_id should be a member.id in this server
            // We verify by checking it's a valid member row in this server
            let members = MemberRepo::list_for_server(pool, channel.server_id).await?;
            if !members.iter().any(|m| m.id == req.target_id) {
                return Err(JolkrError::Validation("Member not found in this server".into()));
            }
        }

        let row = ChannelOverwriteRepo::upsert(
            pool,
            channel_id,
            &req.target_type,
            req.target_id,
            req.allow,
            req.deny,
        ).await?;

        info!(channel_id = %channel_id, target_type = %req.target_type, target_id = %req.target_id, "Channel overwrite upserted");
        Ok(ChannelOverwriteInfo {
            id: row.id,
            channel_id: row.channel_id,
            target_type: row.target_type,
            target_id: row.target_id,
            allow: row.allow,
            deny: row.deny,
        })
    }

    /// Delete a channel overwrite. Requires MANAGE_ROLES.
    pub async fn delete_overwrite(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
        target_type: &str,
        target_id: Uuid,
    ) -> Result<(), JolkrError> {
        // Validate target_type
        if target_type != "role" && target_type != "member" {
            return Err(JolkrError::Validation(
                "target_type must be 'role' or 'member'".into(),
            ));
        }

        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, channel.server_id, caller_id, Permissions::MANAGE_ROLES).await?;
        }

        ChannelOverwriteRepo::delete(pool, channel_id, target_type, target_id).await?;
        info!(channel_id = %channel_id, target_type = %target_type, target_id = %target_id, "Channel overwrite deleted");
        Ok(())
    }

    /// Reorder channels in a server. Requires MANAGE_CHANNELS or server owner.
    pub async fn reorder_channels(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        channel_positions: &[(Uuid, i32)],
    ) -> Result<Vec<ChannelInfo>, JolkrError> {
        // Permission check
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::MANAGE_CHANNELS).await?;
        }

        // Validate all channel IDs belong to this server
        let existing = ChannelRepo::list_for_server(pool, server_id).await?;
        let existing_ids: std::collections::HashSet<Uuid> = existing.iter().map(|c| c.id).collect();
        for (channel_id, _) in channel_positions {
            if !existing_ids.contains(channel_id) {
                return Err(JolkrError::Validation(
                    format!("Channel {} does not belong to server {}", channel_id, server_id),
                ));
            }
        }

        // Bulk update positions
        ChannelRepo::bulk_update_positions(pool, channel_positions).await?;

        // Return updated channel list
        let updated = ChannelRepo::list_for_server(pool, server_id).await?;
        Ok(updated.into_iter().map(ChannelInfo::from).collect())
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
            .map_err(|_| JolkrError::Forbidden)?;
        let perms_bits = RoleRepo::compute_permissions(pool, server_id, member.id).await?;
        let perms = Permissions::from(perms_bits);
        if !perms.has(permission) {
            return Err(JolkrError::Forbidden);
        }
        Ok(())
    }
}
