use chrono::Utc;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{ChannelOverwriteRow, RoleRow};
use jolkr_common::{JolkrError, Permissions};

/// Repository for `role` persistence.
pub struct RoleRepo;

impl RoleRepo {
    /// Create a new role within a server.
    pub async fn create(
        pool: &PgPool,
        id: Uuid,
        server_id: Uuid,
        name: &str,
        color: i32,
        position: i32,
        permissions: i64,
        is_default: bool,
    ) -> Result<RoleRow, JolkrError> {
        let now = Utc::now();
        let row = sqlx::query_as::<_, RoleRow>(
            "
            INSERT INTO roles (id, server_id, name, color, position, permissions, is_default, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(server_id)
        .bind(name)
        .bind(color)
        .bind(position)
        .bind(permissions)
        .bind(is_default)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Get a role by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<RoleRow, JolkrError> {
        let row = sqlx::query_as::<_, RoleRow>(
            "SELECT * FROM roles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Get the @everyone (default) role for a server.
    pub async fn get_default(pool: &PgPool, server_id: Uuid) -> Result<RoleRow, JolkrError> {
        let row = sqlx::query_as::<_, RoleRow>(
            "SELECT * FROM roles WHERE server_id = $1 AND is_default = true",
        )
        .bind(server_id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// List all roles for a server, ordered by position (highest first).
    pub async fn list_for_server(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<RoleRow>, JolkrError> {
        let rows = sqlx::query_as::<_, RoleRow>(
            "
            SELECT * FROM roles
            WHERE server_id = $1
            ORDER BY position DESC
            ",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Update a role.
    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        name: Option<&str>,
        color: Option<i32>,
        position: Option<i32>,
        permissions: Option<i64>,
    ) -> Result<RoleRow, JolkrError> {
        let row = sqlx::query_as::<_, RoleRow>(
            "
            UPDATE roles
            SET name        = COALESCE($2, name),
                color       = COALESCE($3, color),
                position    = COALESCE($4, position),
                permissions = COALESCE($5, permissions)
            WHERE id = $1
            RETURNING *
            ",
        )
        .bind(id)
        .bind(name)
        .bind(color)
        .bind(position)
        .bind(permissions)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Delete a role (cannot delete the default @everyone role).
    /// Uses a transaction to ensure atomicity.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let mut tx = pool.begin().await?;

        // Remove all member_roles entries first
        sqlx::query("DELETE FROM member_roles WHERE role_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        // Remove channel overwrites for this role
        sqlx::query("DELETE FROM channel_permission_overwrites WHERE target_type = 'role' AND target_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        let result = sqlx::query("DELETE FROM roles WHERE id = $1 AND is_default = false")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            tx.rollback().await?;
            return Err(JolkrError::NotFound);
        }

        tx.commit().await?;
        Ok(())
    }

    /// Assign a role to a member.
    pub async fn assign_role(
        pool: &PgPool,
        member_id: Uuid,
        role_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "
            INSERT INTO member_roles (member_id, role_id)
            VALUES ($1, $2)
            ON CONFLICT (member_id, role_id) DO NOTHING
            ",
        )
        .bind(member_id)
        .bind(role_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// Remove a role from a member.
    pub async fn remove_role(
        pool: &PgPool,
        member_id: Uuid,
        role_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query("DELETE FROM member_roles WHERE member_id = $1 AND role_id = $2")
            .bind(member_id)
            .bind(role_id)
            .execute(pool)
            .await?;

        Ok(())
    }

    /// List all role IDs assigned to a member.
    pub async fn list_member_role_ids(
        pool: &PgPool,
        member_id: Uuid,
    ) -> Result<Vec<Uuid>, JolkrError> {
        let rows: Vec<(Uuid,)> = sqlx::query_as(
            "SELECT role_id FROM member_roles WHERE member_id = $1",
        )
        .bind(member_id)
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().map(|(id,)| id).collect())
    }

    /// List all roles for a member (joined with roles table).
    pub async fn list_member_roles(
        pool: &PgPool,
        member_id: Uuid,
    ) -> Result<Vec<RoleRow>, JolkrError> {
        let rows = sqlx::query_as::<_, RoleRow>(
            "
            SELECT r.* FROM roles r
            JOIN member_roles mr ON mr.role_id = r.id
            WHERE mr.member_id = $1
            ORDER BY r.position DESC
            ",
        )
        .bind(member_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// List all `role_ids` for all members in a server (batch query to avoid N+1).
    pub async fn list_roles_for_server_members(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<(Uuid, Uuid)>, JolkrError> {
        let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
            "
            SELECT mr.member_id, mr.role_id
            FROM member_roles mr
            JOIN members m ON m.id = mr.member_id
            WHERE m.server_id = $1
            ",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// List all roles with permissions for all members in a server (single query).
    /// Returns (`member_id`, `role_id`, permissions) tuples for batch permission computation.
    pub async fn list_member_roles_batch(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<(Uuid, Uuid, i64)>, JolkrError> {
        let rows: Vec<(Uuid, Uuid, i64)> = sqlx::query_as(
            "
            SELECT mr.member_id, mr.role_id, r.permissions
            FROM member_roles mr
            JOIN members m ON m.id = mr.member_id
            JOIN roles r ON r.id = mr.role_id
            WHERE m.server_id = $1
            ",
        )
        .bind(server_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Compute channel permissions for all members in one go, using pre-fetched batch data.
    /// Returns a `HashMap`<`member_id`, permissions>.
    #[must_use] 
    pub fn compute_channel_permissions_for_all_members(
        members: &[(Uuid, Uuid)],  // (member_id, user_id)
        member_roles_batch: &[(Uuid, Uuid, i64)],  // (member_id, role_id, permissions)
        overwrites: &[ChannelOverwriteRow],
        everyone_role: Option<&RoleRow>,
        server_owner_id: Uuid,
    ) -> HashMap<Uuid, i64> {
        let everyone_perms = everyone_role.map_or(Permissions::DEFAULT as i64, |r| r.permissions);
        let everyone_role_id = everyone_role.map(|r| r.id);

        // Group role data by member_id
        let mut roles_by_member: HashMap<Uuid, Vec<(Uuid, i64)>> = HashMap::new();
        for &(member_id, role_id, permissions) in member_roles_batch {
            roles_by_member.entry(member_id).or_default().push((role_id, permissions));
        }

        let mut result = HashMap::new();
        for &(member_id, user_id) in members {
            // Server owner gets all permissions
            if user_id == server_owner_id {
                result.insert(member_id, Permissions::ALL as i64);
                continue;
            }

            // Compute base: @everyone | all assigned roles
            let mut base = everyone_perms;
            let member_role_ids: Vec<Uuid>;
            if let Some(roles) = roles_by_member.get(&member_id) {
                for &(_role_id, perms) in roles {
                    base |= perms;
                }
                member_role_ids = roles.iter().map(|(rid, _)| *rid).collect();
            } else {
                member_role_ids = Vec::new();
            }

            // ADMINISTRATOR bypasses everything
            if base as u64 & Permissions::ADMINISTRATOR != 0 {
                result.insert(member_id, Permissions::ALL as i64);
                continue;
            }

            // Apply channel overwrites
            base = Self::apply_overwrites(base, overwrites, &member_role_ids, everyone_role_id, member_id);
            result.insert(member_id, base);
        }

        result
    }

    /// Compute the combined permissions for a user in a server.
    /// Merges the @everyone role permissions with all assigned role permissions.
    pub async fn compute_permissions(
        pool: &PgPool,
        server_id: Uuid,
        member_id: Uuid,
    ) -> Result<i64, JolkrError> {
        // Get @everyone permissions
        let everyone = Self::get_default(pool, server_id).await;
        let mut perms = everyone.map(|r| r.permissions).unwrap_or(Permissions::DEFAULT as i64);

        // Get member's assigned roles
        let roles = Self::list_member_roles(pool, member_id).await?;
        for role in &roles {
            perms |= role.permissions;
        }

        Ok(perms)
    }

    /// Compute channel-level permissions using the Discord 3-layer model:
    /// 1. Start with server-level permissions (`compute_permissions`)
    /// 2. ADMINISTRATOR short-circuit → return ALL
    /// 3. Apply @everyone role overwrite for this channel
    /// 4. Aggregate all assigned role overwrites (except @everyone)
    /// 5. Apply member-specific overwrite
    pub async fn compute_channel_permissions(
        pool: &PgPool,
        server_id: Uuid,
        channel_id: Uuid,
        member_id: Uuid,
    ) -> Result<i64, JolkrError> {
        use crate::repo::ChannelOverwriteRepo;

        let mut base = Self::compute_permissions(pool, server_id, member_id).await?;

        // ADMINISTRATOR bypasses everything
        if base as u64 & Permissions::ADMINISTRATOR != 0 {
            return Ok(Permissions::ALL as i64);
        }

        let overwrites = ChannelOverwriteRepo::list_for_channel(pool, channel_id).await?;
        let member_role_ids = Self::list_member_role_ids(pool, member_id).await?;
        let everyone = Self::get_default(pool, server_id).await.ok();

        base = Self::apply_overwrites(base, &overwrites, &member_role_ids, everyone.as_ref().map(|r| r.id), member_id);
        Ok(base)
    }

    /// Compute channel-level permissions using pre-fetched shared data.
    /// Avoids N+1 queries when checking permissions for many members on the same channel.
    pub async fn compute_channel_permissions_with_cache(
        pool: &PgPool,
        _server_id: Uuid,
        member_id: Uuid,
        overwrites: &[ChannelOverwriteRow],
        everyone_role: Option<&RoleRow>,
    ) -> Result<i64, JolkrError> {
        // Compute server-level permissions (still per-member: @everyone + assigned roles)
        let everyone_perms = everyone_role.map_or(Permissions::DEFAULT as i64, |r| r.permissions);
        let roles = Self::list_member_roles(pool, member_id).await?;
        let mut base = everyone_perms;
        for role in &roles {
            base |= role.permissions;
        }

        // ADMINISTRATOR bypasses everything
        if base as u64 & Permissions::ADMINISTRATOR != 0 {
            return Ok(Permissions::ALL as i64);
        }

        let member_role_ids = Self::list_member_role_ids(pool, member_id).await?;
        let everyone_role_id = everyone_role.map(|r| r.id);

        base = Self::apply_overwrites(base, overwrites, &member_role_ids, everyone_role_id, member_id);
        Ok(base)
    }

    /// Batch compute channel permissions for all channels in a server.
    /// Takes pre-fetched overwrites to avoid N+1 queries.
    #[must_use] 
    pub fn compute_channel_permissions_batch(
        base_perms: i64,
        channel_ids: &[Uuid],
        overwrites: &[ChannelOverwriteRow],
        member_role_ids: &[Uuid],
        everyone_role_id: Option<Uuid>,
        member_id: Uuid,
    ) -> HashMap<Uuid, i64> {
        // ADMINISTRATOR bypasses everything
        if base_perms as u64 & Permissions::ADMINISTRATOR != 0 {
            return channel_ids.iter().map(|id| (*id, Permissions::ALL as i64)).collect();
        }

        // Group overwrites by channel_id
        let mut by_channel: HashMap<Uuid, Vec<&ChannelOverwriteRow>> = HashMap::new();
        for ow in overwrites {
            by_channel.entry(ow.channel_id).or_default().push(ow);
        }

        channel_ids
            .iter()
            .map(|ch_id| {
                let ch_overwrites: Vec<ChannelOverwriteRow> = by_channel
                    .get(ch_id)
                    .map(|v| v.iter().map(|o| (*o).clone()).collect())
                    .unwrap_or_default();
                let perms = Self::apply_overwrites(base_perms, &ch_overwrites, member_role_ids, everyone_role_id, member_id);
                (*ch_id, perms)
            })
            .collect()
    }

    /// Apply channel overwrites to base permissions (shared logic).
    fn apply_overwrites(
        mut base: i64,
        overwrites: &[ChannelOverwriteRow],
        member_role_ids: &[Uuid],
        everyone_role_id: Option<Uuid>,
        member_id: Uuid,
    ) -> i64 {
        // Step 1: Apply @everyone role overwrite
        if let Some(everyone_id) = everyone_role_id {
            if let Some(ow) = overwrites.iter().find(|o| o.target_type == "role" && o.target_id == everyone_id) {
                base = (base & !ow.deny) | ow.allow;
            }
        }

        // Step 2: Aggregate all role overwrites (except @everyone)
        let mut agg_allow: i64 = 0;
        let mut agg_deny: i64 = 0;
        for ow in overwrites.iter().filter(|o| {
            o.target_type == "role"
                && (everyone_role_id != Some(o.target_id))
                && member_role_ids.contains(&o.target_id)
        }) {
            agg_allow |= ow.allow;
            agg_deny |= ow.deny;
        }
        base = (base & !agg_deny) | agg_allow;

        // Step 3: Apply member-specific overwrite
        if let Some(ow) = overwrites.iter().find(|o| o.target_type == "member" && o.target_id == member_id) {
            base = (base & !ow.deny) | ow.allow;
        }

        base
    }
}
