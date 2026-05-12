use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::WebhookRow;
use jolkr_db::repo::{ChannelRepo, MemberRepo, RoleRepo, ServerRepo, WebhookRepo};

use crate::services::message::MessageInfo;

/// Webhook info (hides token for list/get)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Creator user identifier.
    pub creator_id: Uuid,
    /// Display name.
    pub name: String,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
    /// Opaque token string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

impl WebhookInfo {
    /// Build from row. `plaintext_token` is only set on create/regenerate (the only
    /// time the caller still has the unhashed token).
    #[must_use] 
    pub fn from_row(row: WebhookRow, plaintext_token: Option<String>) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            server_id: row.server_id,
            creator_id: row.creator_id,
            name: row.name,
            avatar_url: row.avatar_url,
            token: plaintext_token,
        }
    }
}

/// Request payload for the `CreateWebhook` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWebhookRequest {
    /// Display name.
    pub name: String,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
}

/// Request payload for the `UpdateWebhook` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateWebhookRequest {
    /// Display name.
    pub name: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
}

/// Request payload for the `ExecuteWebhook` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecuteWebhookRequest {
    /// Message content (may be encrypted).
    pub content: String,
    /// Login username.
    pub username: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
}

/// Domain service for `webhook` operations.
pub struct WebhookService;

impl WebhookService {
    /// Generate a secure random token.
    fn generate_token() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..48).map(|_| rng.r#gen::<u8>()).collect();
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&bytes)
    }

    /// Create a webhook. Requires `MANAGE_WEBHOOKS` permission.
    #[tracing::instrument(skip(pool, req))]
    pub async fn create_webhook(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
        req: CreateWebhookRequest,
    ) -> Result<WebhookInfo, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;

        // Check permission
        if server.owner_id != caller_id {
            let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
                .await.map_err(|e| {
                    tracing::warn!(?e, server_id = %channel.server_id, caller_id = %caller_id, "member lookup failed while creating webhook");
                    JolkrError::Forbidden
                })?;
            let perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, channel_id, member.id,
            ).await?;
            if !Permissions::from(perms).has(Permissions::MANAGE_WEBHOOKS) {
                return Err(JolkrError::Forbidden);
            }
        }

        // Validate
        let name = req.name.trim().to_owned();
        if name.is_empty() || name.len() > 80 {
            return Err(JolkrError::Validation("Webhook name must be 1-80 characters".into()));
        }

        let id = Uuid::new_v4();
        let token = Self::generate_token();
        let row = WebhookRepo::create(
            pool, id, channel_id, channel.server_id, caller_id,
            &name, req.avatar_url.as_deref(), &token,
        ).await?;

        info!(webhook_id = %id, channel_id = %channel_id, "Webhook created");
        Ok(WebhookInfo::from_row(row, Some(token)))
    }

    /// List webhooks for a channel.
    #[tracing::instrument(skip(pool))]
    pub async fn list_webhooks(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<WebhookInfo>, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        MemberRepo::get_member(pool, channel.server_id, caller_id)
            .await.map_err(|e| {
                tracing::warn!(?e, server_id = %channel.server_id, caller_id = %caller_id, "member lookup failed while listing webhooks");
                JolkrError::Forbidden
            })?;

        let rows = WebhookRepo::list_for_channel(pool, channel_id).await?;
        Ok(rows.into_iter().map(|r| WebhookInfo::from_row(r, None)).collect())
    }

    /// Update a webhook.
    #[tracing::instrument(skip(pool, req))]
    pub async fn update_webhook(
        pool: &PgPool,
        webhook_id: Uuid,
        caller_id: Uuid,
        req: UpdateWebhookRequest,
    ) -> Result<WebhookInfo, JolkrError> {
        let webhook = WebhookRepo::get_by_id(pool, webhook_id).await?;
        let server = ServerRepo::get_by_id(pool, webhook.server_id).await?;

        if server.owner_id != caller_id {
            let member = MemberRepo::get_member(pool, webhook.server_id, caller_id)
                .await.map_err(|e| {
                    tracing::warn!(?e, server_id = %webhook.server_id, caller_id = %caller_id, "member lookup failed while updating webhook");
                    JolkrError::Forbidden
                })?;
            let perms = RoleRepo::compute_channel_permissions(
                pool, webhook.server_id, webhook.channel_id, member.id,
            ).await?;
            if !Permissions::from(perms).has(Permissions::MANAGE_WEBHOOKS) {
                return Err(JolkrError::Forbidden);
            }
        }

        if let Some(ref name) = req.name {
            let name = name.trim();
            if name.is_empty() || name.len() > 80 {
                return Err(JolkrError::Validation("Webhook name must be 1-80 characters".into()));
            }
        }

        let row = WebhookRepo::update(pool, webhook_id, req.name.as_deref(), req.avatar_url.as_deref()).await?;
        Ok(WebhookInfo::from_row(row, None))
    }

    /// Delete a webhook.
    #[tracing::instrument(skip(pool))]
    pub async fn delete_webhook(
        pool: &PgPool,
        webhook_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        let webhook = WebhookRepo::get_by_id(pool, webhook_id).await?;
        let server = ServerRepo::get_by_id(pool, webhook.server_id).await?;

        if server.owner_id != caller_id {
            let member = MemberRepo::get_member(pool, webhook.server_id, caller_id)
                .await.map_err(|e| {
                    tracing::warn!(?e, server_id = %webhook.server_id, caller_id = %caller_id, "member lookup failed while deleting webhook");
                    JolkrError::Forbidden
                })?;
            let perms = RoleRepo::compute_channel_permissions(
                pool, webhook.server_id, webhook.channel_id, member.id,
            ).await?;
            if !Permissions::from(perms).has(Permissions::MANAGE_WEBHOOKS) {
                return Err(JolkrError::Forbidden);
            }
        }

        WebhookRepo::delete(pool, webhook_id).await?;
        info!(webhook_id = %webhook_id, "Webhook deleted");
        Ok(())
    }

    /// Regenerate a webhook's token.
    #[tracing::instrument(skip(pool))]
    pub async fn regenerate_token(
        pool: &PgPool,
        webhook_id: Uuid,
        caller_id: Uuid,
    ) -> Result<WebhookInfo, JolkrError> {
        let webhook = WebhookRepo::get_by_id(pool, webhook_id).await?;
        let server = ServerRepo::get_by_id(pool, webhook.server_id).await?;

        if server.owner_id != caller_id {
            let member = MemberRepo::get_member(pool, webhook.server_id, caller_id)
                .await.map_err(|e| {
                    tracing::warn!(?e, server_id = %webhook.server_id, caller_id = %caller_id, "member lookup failed while regenerating webhook token");
                    JolkrError::Forbidden
                })?;
            let perms = RoleRepo::compute_channel_permissions(
                pool, webhook.server_id, webhook.channel_id, member.id,
            ).await?;
            if !Permissions::from(perms).has(Permissions::MANAGE_WEBHOOKS) {
                return Err(JolkrError::Forbidden);
            }
        }

        let new_token = Self::generate_token();
        let row = WebhookRepo::regenerate_token(pool, webhook_id, &new_token).await?;
        Ok(WebhookInfo::from_row(row, Some(new_token)))
    }

    /// Execute a webhook — create a message as the webhook identity.
    /// This is unauthenticated; the token proves authorization.
    #[tracing::instrument(skip(pool, token, req))]
    pub async fn execute_webhook(
        pool: &PgPool,
        webhook_id: Uuid,
        token: &str,
        req: ExecuteWebhookRequest,
    ) -> Result<MessageInfo, JolkrError> {
        let webhook = WebhookRepo::get_by_id(pool, webhook_id).await?;
        // Hash the provided token and compare with stored hash (constant-time)
        let provided_hash = jolkr_db::repo::webhooks::hash_token(token);
        use subtle::ConstantTimeEq;
        if webhook.token_hash.as_bytes().ct_eq(provided_hash.as_bytes()).unwrap_u8() != 1 {
            return Err(JolkrError::Forbidden);
        }

        // Validate content
        if req.content.trim().is_empty() || req.content.len() > 4000 {
            return Err(JolkrError::Validation("Content must be 1-4000 characters".into()));
        }

        // H5: Validate optional username and avatar_url lengths
        if let Some(ref username) = req.username {
            if username.trim().is_empty() || username.len() > 80 {
                return Err(JolkrError::Validation("Username must be 1-80 characters".into()));
            }
        }
        if let Some(ref avatar) = req.avatar_url {
            if avatar.len() > 512 {
                return Err(JolkrError::Validation("Avatar URL must be at most 512 characters".into()));
            }
        }

        // Create the message as the webhook creator but tag it with webhook_id
        let message_id = Uuid::new_v4();
        let now = chrono::Utc::now();
        let row = sqlx::query_as::<_, jolkr_db::models::MessageRow>(
            "
            INSERT INTO messages
                (id, channel_id, author_id, content, is_edited, is_pinned, webhook_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, false, false, $5, $6, $6)
            RETURNING *
            ",
        )
        .bind(message_id)
        .bind(webhook.channel_id)
        .bind(webhook.creator_id)
        .bind(&req.content)
        .bind(webhook.id)
        .bind(now)
        .fetch_one(pool)
        .await?;

        let mut msg = MessageInfo::from(row);
        // Override display name/avatar with webhook or request values
        msg.webhook_id = Some(webhook.id);
        msg.webhook_name = Some(req.username.unwrap_or(webhook.name));
        msg.webhook_avatar = req.avatar_url.or(webhook.avatar_url);

        info!(webhook_id = %webhook_id, message_id = %message_id, "Webhook executed");
        Ok(msg)
    }
}
