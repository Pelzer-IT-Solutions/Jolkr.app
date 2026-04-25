use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::CategoryRow;
use jolkr_db::repo::{CategoryRepo, ServerRepo};

/// Public category DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Display name.
    pub name: String,
    /// Sort position.
    pub position: i32,
}

impl From<CategoryRow> for CategoryInfo {
    fn from(row: CategoryRow) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            name: row.name,
            position: row.position,
        }
    }
}

/// Request payload for the `CreateCategory` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCategoryRequest {
    /// Display name.
    pub name: String,
}

/// Request payload for the `UpdateCategory` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCategoryRequest {
    /// Display name.
    pub name: Option<String>,
    /// Sort position.
    pub position: Option<i32>,
}

/// Domain service for `category` operations.
pub struct CategoryService;

impl CategoryService {
    /// Create a new category. Requires `MANAGE_CHANNELS` or server owner.
    pub async fn create_category(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        req: CreateCategoryRequest,
    ) -> Result<CategoryInfo, JolkrError> {
        // Permission check: owner or MANAGE_CHANNELS
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, jolkr_common::Permissions::MANAGE_CHANNELS).await?;
        }

        let name = req.name.trim().to_owned();
        if name.is_empty() || name.len() > 100 {
            return Err(JolkrError::Validation(
                "Category name must be between 1 and 100 characters".into(),
            ));
        }

        let id = Uuid::new_v4();

        // Position at end
        let existing = CategoryRepo::list_for_server(pool, server_id).await?;
        let position = existing.len() as i32;

        let row = CategoryRepo::create(pool, id, server_id, &name, position).await?;
        info!(category_id = %id, server_id = %server_id, "Category created");
        Ok(CategoryInfo::from(row))
    }

    /// List all categories in a server.
    pub async fn list_categories(
        pool: &PgPool,
        server_id: Uuid,
    ) -> Result<Vec<CategoryInfo>, JolkrError> {
        let rows = CategoryRepo::list_for_server(pool, server_id).await?;
        Ok(rows.into_iter().map(CategoryInfo::from).collect())
    }

    /// Update a category. Requires `MANAGE_CHANNELS` or server owner.
    pub async fn update_category(
        pool: &PgPool,
        category_id: Uuid,
        caller_id: Uuid,
        req: UpdateCategoryRequest,
    ) -> Result<CategoryInfo, JolkrError> {
        let category = CategoryRepo::get_by_id(pool, category_id).await?;
        let server = ServerRepo::get_by_id(pool, category.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, category.server_id, caller_id, jolkr_common::Permissions::MANAGE_CHANNELS).await?;
        }

        if let Some(ref name) = req.name {
            let name = name.trim();
            if name.is_empty() || name.len() > 100 {
                return Err(JolkrError::Validation(
                    "Category name must be between 1 and 100 characters".into(),
                ));
            }
        }

        let row = CategoryRepo::update(pool, category_id, req.name.as_deref(), req.position).await?;
        Ok(CategoryInfo::from(row))
    }

    /// Delete a category. Channels in it get moved to uncategorized.
    pub async fn delete_category(
        pool: &PgPool,
        category_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let category = CategoryRepo::get_by_id(pool, category_id).await?;
        let server = ServerRepo::get_by_id(pool, category.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, category.server_id, caller_id, jolkr_common::Permissions::MANAGE_CHANNELS).await?;
        }

        CategoryRepo::delete(pool, category_id).await?;
        info!(category_id = %category_id, "Category deleted");
        Ok(())
    }

    /// Helper: check if a user has a specific permission in a server.
    async fn check_permission(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        permission: u64,
    ) -> Result<(), JolkrError> {
        use jolkr_common::Permissions;
        use jolkr_db::repo::{MemberRepo, RoleRepo};

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
