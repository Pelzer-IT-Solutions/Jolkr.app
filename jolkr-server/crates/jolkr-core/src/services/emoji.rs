use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::ServerEmojiRow;
use jolkr_db::repo::{EmojiRepo, MemberRepo, RoleRepo, ServerRepo};

const MAX_EMOJIS_PER_SERVER: i64 = 50;
const MAX_EMOJI_NAME_LEN: usize = 32;

/// Public emoji DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmojiInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Display name.
    pub name: String,
    /// Image URL.
    pub image_url: String,
    /// Uploader user identifier.
    pub uploader_id: Uuid,
    /// Whether the asset is animated.
    pub animated: bool,
}

impl EmojiInfo {
    /// Builds the type from a database row.
    #[must_use] 
    pub fn from_row(row: ServerEmojiRow, image_url: String) -> Self {
        Self {
            id: row.id,
            server_id: row.server_id,
            name: row.name,
            image_url,
            uploader_id: row.uploader_id,
            animated: row.animated,
        }
    }
}

/// Request payload for the `CreateEmoji` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEmojiRequest {
    /// Display name.
    pub name: String,
}

/// Domain service for `emoji` operations.
pub struct EmojiService;

impl EmojiService {
    /// Upload a new custom emoji. Requires `MANAGE_SERVER` permission.
    #[tracing::instrument(skip(pool, name, image_key))]
    pub async fn create_emoji(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
        name: &str,
        image_key: &str,
        animated: bool,
    ) -> Result<ServerEmojiRow, JolkrError> {
        // Permission check
        let server = ServerRepo::get_by_id(pool, server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, server_id, caller_id, Permissions::MANAGE_SERVER).await?;
        }

        // Validate name
        let name = name.trim().to_lowercase();
        if name.is_empty() || name.len() > MAX_EMOJI_NAME_LEN {
            return Err(JolkrError::Validation(
                format!("Emoji name must be between 1 and {MAX_EMOJI_NAME_LEN} characters"),
            ));
        }
        // Only allow alphanumeric + underscores
        if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            return Err(JolkrError::Validation(
                "Emoji name can only contain letters, numbers, and underscores".into(),
            ));
        }

        // Check limit
        let count = EmojiRepo::count_for_server(pool, server_id).await?;
        if count >= MAX_EMOJIS_PER_SERVER {
            return Err(JolkrError::Validation(
                format!("Server has reached the maximum of {MAX_EMOJIS_PER_SERVER} custom emojis"),
            ));
        }

        let id = Uuid::new_v4();
        let row = EmojiRepo::create(pool, id, server_id, &name, image_key, caller_id, animated).await?;
        info!(emoji_id = %id, server_id = %server_id, name = %name, "Custom emoji created");
        Ok(row)
    }

    /// List all emojis for a server. Requires membership.
    #[tracing::instrument(skip(pool))]
    pub async fn list_emojis(
        pool: &PgPool,
        server_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<ServerEmojiRow>, JolkrError> {
        // Membership check
        MemberRepo::get_member(pool, server_id, caller_id)
            .await
            .map_err(|e| {
                tracing::warn!(?e, server_id = %server_id, caller_id = %caller_id, "member lookup failed while listing emojis");
                JolkrError::Forbidden
            })?;

        EmojiRepo::list_for_server(pool, server_id).await
    }

    /// Delete a custom emoji. Requires `MANAGE_SERVER` permission.
    #[tracing::instrument(skip(pool))]
    pub async fn delete_emoji(
        pool: &PgPool,
        emoji_id: Uuid,
        caller_id: Uuid,
    ) -> Result<String, JolkrError> {
        let emoji = EmojiRepo::get_by_id(pool, emoji_id).await?;

        let server = ServerRepo::get_by_id(pool, emoji.server_id).await?;
        if server.owner_id != caller_id {
            Self::check_permission(pool, emoji.server_id, caller_id, Permissions::MANAGE_SERVER).await?;
        }

        let image_key = emoji.image_key.clone();
        EmojiRepo::delete(pool, emoji_id).await?;
        info!(emoji_id = %emoji_id, "Custom emoji deleted");
        Ok(image_key)
    }

    async fn check_permission(
        pool: &PgPool,
        server_id: Uuid,
        user_id: Uuid,
        permission: u64,
    ) -> Result<(), JolkrError> {
        let member = MemberRepo::get_member(pool, server_id, user_id)
            .await
            .map_err(|e| {
                tracing::warn!(?e, server_id = %server_id, user_id = %user_id, "member lookup failed for emoji permission check");
                JolkrError::Forbidden
            })?;
        let perms_bits = RoleRepo::compute_permissions(pool, server_id, member.id).await?;
        let perms = Permissions::from(perms_bits);
        if !perms.has(permission) {
            return Err(JolkrError::Forbidden);
        }
        Ok(())
    }
}
