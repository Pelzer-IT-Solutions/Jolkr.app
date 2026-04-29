use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::ThreadRow;
use jolkr_db::repo::{
    AttachmentRepo, ChannelRepo, MemberRepo, MessageRepo, RoleRepo, ServerRepo, ThreadRepo,
};

use super::message::{
    enrich_with_reactions, attachment_proxy_url, AttachmentInfo, MessageInfo,
    MessageService, SendMessageRequest,
};

/// Maximum thread name length in characters.
const MAX_THREAD_NAME_CHARS: usize = 100;

// ── DTOs ──────────────────────────────────────────────────────────────

/// Public information about `thread`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Identifier of the message that started the thread.
    pub starter_msg_id: Option<Uuid>,
    /// Display name.
    pub name: Option<String>,
    /// Whether archived.
    pub is_archived: bool,
    /// Cached message count.
    pub message_count: i64,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

impl ThreadInfo {
    fn from_row(row: ThreadRow, message_count: i64) -> Self {
        Self {
            id: row.id,
            channel_id: row.channel_id,
            starter_msg_id: row.starter_msg_id,
            name: row.name,
            is_archived: row.is_archived,
            message_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Request payload for the `CreateThread` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateThreadRequest {
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Display name.
    pub name: Option<String>,
}

/// Request payload for the `UpdateThread` operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateThreadRequest {
    /// Display name.
    pub name: Option<String>,
    /// Whether archived.
    pub is_archived: Option<bool>,
}

/// `ThreadMessageQuery` value.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadMessageQuery {
    /// Before.
    pub before: Option<DateTime<Utc>>,
    /// Limit.
    pub limit: Option<i64>,
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Check `VIEW_CHANNELS` permission for caller on a channel. Returns (`server_id`, `member_id`).
async fn check_view_permission(
    pool: &PgPool,
    channel_id: Uuid,
    caller_id: Uuid,
) -> Result<(Uuid, Uuid), JolkrError> {
    let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
    let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
        .await
        .map_err(|_| JolkrError::Forbidden)?;
    let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
    if server.owner_id != caller_id {
        let ch_perms = RoleRepo::compute_channel_permissions(
            pool, channel.server_id, channel_id, member.id,
        )
        .await?;
        if !Permissions::from(ch_perms).has(Permissions::VIEW_CHANNELS) {
            return Err(JolkrError::Forbidden);
        }
    }
    Ok((channel.server_id, member.id))
}

// ── Service ──────────────────────────────────────────────────────────

/// Domain service for `thread` operations.
pub struct ThreadService;

impl ThreadService {
    /// Create a thread from an existing message.
    /// Requires `VIEW_CHANNELS` + `SEND_MESSAGES` on the parent channel.
    /// Uses a transaction to ensure atomicity and prevent race conditions.
    pub async fn create_thread(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
        req: CreateThreadRequest,
    ) -> Result<(ThreadInfo, MessageInfo), JolkrError> {
        // Validate name (measure in chars, not bytes)
        let name = req.name.as_deref().map(str::trim).filter(|n| !n.is_empty());
        if let Some(n) = name {
            if n.chars().count() > MAX_THREAD_NAME_CHARS {
                return Err(JolkrError::Validation(
                    "Thread name cannot exceed 100 characters".into(),
                ));
            }
        }

        // Check permissions
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            let ch_perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, channel_id, member.id,
            )
            .await?;
            let perms = Permissions::from(ch_perms);
            if !perms.has(Permissions::VIEW_CHANNELS) || !perms.has(Permissions::SEND_MESSAGES) {
                return Err(JolkrError::Forbidden);
            }
        }

        // Verify message belongs to this channel
        let starter_msg = MessageRepo::get_by_id(pool, req.message_id).await?;
        if starter_msg.channel_id != channel_id {
            return Err(JolkrError::BadRequest(
                "Message does not belong to this channel".into(),
            ));
        }

        // Prevent nested threading (cannot create a thread from a thread message)
        if starter_msg.thread_id.is_some() {
            return Err(JolkrError::BadRequest(
                "Cannot create a thread from a message that is already in a thread".into(),
            ));
        }

        // Use a transaction for atomicity (thread create + set_thread_id)
        let mut tx = pool.begin().await.map_err(|e| JolkrError::Internal(e.to_string()))?;

        // Create thread — the UNIQUE index on starter_msg_id prevents race conditions
        let thread = match ThreadRepo::create(&mut *tx, channel_id, Some(req.message_id), name).await {
            Ok(t) => t,
            Err(e) => {
                // Unique constraint violation → thread already exists
                drop(tx.rollback().await);
                let msg = e.to_string();
                if msg.contains("duplicate") || msg.contains("unique") || msg.contains("idx_threads_starter_msg_unique") {
                    return Err(JolkrError::Conflict(
                        "A thread already exists for this message".into(),
                    ));
                }
                return Err(e);
            }
        };

        // Set thread_id on the starter message
        let updated_msg = MessageRepo::set_thread_id(&mut *tx, req.message_id, thread.id).await?;

        tx.commit().await.map_err(|e| JolkrError::Internal(e.to_string()))?;

        let thread_info = ThreadInfo::from_row(thread, 0);
        let mut msg_info = MessageInfo::from(updated_msg);
        msg_info.thread_reply_count = Some(0);

        info!(thread_id = %thread_info.id, channel_id = %channel_id, "Thread created");

        Ok((thread_info, msg_info))
    }

    /// Get a single thread with message count. Requires `VIEW_CHANNELS`.
    pub async fn get_thread(
        pool: &PgPool,
        thread_id: Uuid,
        caller_id: Uuid,
    ) -> Result<ThreadInfo, JolkrError> {
        let thread = ThreadRepo::get_by_id(pool, thread_id).await?;
        check_view_permission(pool, thread.channel_id, caller_id).await?;
        let count = ThreadRepo::message_count(pool, thread_id).await?;
        Ok(ThreadInfo::from_row(thread, count))
    }

    /// List threads for a channel. Requires `VIEW_CHANNELS`.
    pub async fn list_threads(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
        include_archived: bool,
    ) -> Result<Vec<ThreadInfo>, JolkrError> {
        check_view_permission(pool, channel_id, caller_id).await?;

        let threads = ThreadRepo::list_for_channel(pool, channel_id, include_archived).await?;
        let thread_ids: Vec<Uuid> = threads.iter().map(|t| t.id).collect();
        let counts = ThreadRepo::message_counts(pool, &thread_ids).await?;

        use std::collections::HashMap;
        let count_map: HashMap<Uuid, i64> = counts.into_iter().collect();

        let result = threads
            .into_iter()
            .map(|t| {
                let count = count_map.get(&t.id).copied().unwrap_or(0);
                ThreadInfo::from_row(t, count)
            })
            .collect();

        Ok(result)
    }

    /// Update thread name or archive status.
    /// Allowed by: thread starter message author, `MANAGE_MESSAGES` holders, server owner.
    /// Requires `VIEW_CHANNELS` on the parent channel.
    pub async fn update_thread(
        pool: &PgPool,
        thread_id: Uuid,
        caller_id: Uuid,
        req: UpdateThreadRequest,
    ) -> Result<ThreadInfo, JolkrError> {
        // Reject empty updates
        if req.name.is_none() && req.is_archived.is_none() {
            return Err(JolkrError::Validation(
                "At least one field must be provided".into(),
            ));
        }

        let thread = ThreadRepo::get_by_id(pool, thread_id).await?;
        let channel = ChannelRepo::get_by_id(pool, thread.channel_id).await?;
        let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;

        // Permission check: owner bypasses, else check VIEW_CHANNELS + (MANAGE_MESSAGES or starter author)
        if server.owner_id != caller_id {
            let ch_perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, thread.channel_id, member.id,
            )
            .await?;
            let perms = Permissions::from(ch_perms);

            // Must at least be able to view the channel
            if !perms.has(Permissions::VIEW_CHANNELS) {
                return Err(JolkrError::Forbidden);
            }

            let is_starter_author = if let Some(starter_id) = thread.starter_msg_id {
                let msg = MessageRepo::get_by_id(pool, starter_id).await?;
                msg.author_id == caller_id
            } else {
                false
            };

            if !is_starter_author && !perms.has(Permissions::MANAGE_MESSAGES) {
                return Err(JolkrError::Forbidden);
            }
        }

        let mut updated = thread;

        if let Some(ref name) = req.name {
            let name_trimmed = name.trim();
            if name_trimmed.chars().count() > MAX_THREAD_NAME_CHARS {
                return Err(JolkrError::Validation(
                    "Thread name cannot exceed 100 characters".into(),
                ));
            }
            let name_val = if name_trimmed.is_empty() { None } else { Some(name_trimmed) };
            updated = ThreadRepo::update_name(pool, updated.id, name_val).await?;
        }

        if let Some(archived) = req.is_archived {
            updated = ThreadRepo::set_archived(pool, updated.id, archived).await?;
        }

        let count = ThreadRepo::message_count(pool, updated.id).await?;
        let info = ThreadInfo::from_row(updated, count);

        info!(thread_id = %thread_id, "Thread updated");
        Ok(info)
    }

    /// Send a message to a thread. Requires `SEND_MESSAGES` on parent channel.
    pub async fn send_thread_message(
        pool: &PgPool,
        thread_id: Uuid,
        caller_id: Uuid,
        req: SendMessageRequest,
    ) -> Result<MessageInfo, JolkrError> {
        let thread = ThreadRepo::get_by_id(pool, thread_id).await?;

        // Check not archived
        if thread.is_archived {
            return Err(JolkrError::BadRequest(
                "Cannot send messages to an archived thread".into(),
            ));
        }

        // Validate reply_to_id belongs to this thread (if set)
        if let Some(reply_id) = req.reply_to_id {
            let reply_msg = MessageRepo::get_by_id(pool, reply_id).await?;
            if reply_msg.thread_id != Some(thread_id) {
                return Err(JolkrError::BadRequest(
                    "Cannot reply to a message from a different thread".into(),
                ));
            }
        }

        // Delegate to send_message_internal with thread_id
        let msg = MessageService::send_message_internal(
            pool,
            thread.channel_id,
            caller_id,
            req,
            Some(thread_id),
        )
        .await?;

        // Touch thread updated_at
        ThreadRepo::touch(pool, thread_id).await?;

        Ok(msg)
    }

    /// Get paginated messages for a thread. Requires `VIEW_CHANNELS` on parent channel.
    pub async fn get_thread_messages(
        pool: &PgPool,
        thread_id: Uuid,
        caller_id: Uuid,
        query: ThreadMessageQuery,
    ) -> Result<Vec<MessageInfo>, JolkrError> {
        let thread = ThreadRepo::get_by_id(pool, thread_id).await?;
        check_view_permission(pool, thread.channel_id, caller_id).await?;

        let limit = query.limit.unwrap_or(50);
        let rows = MessageRepo::list_for_thread(pool, thread_id, query.before, limit).await?;

        let mut messages: Vec<MessageInfo> =
            rows.iter().map(|r| MessageInfo::from(r.clone())).collect();

        // Batch load attachments
        let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
        let all_atts = AttachmentRepo::list_for_messages(pool, &msg_ids).await?;
        for att in all_atts {
            if let Some(msg) = messages.iter_mut().find(|m| m.id == att.message_id) {
                msg.attachments.push(AttachmentInfo {
                    id: att.id,
                    filename: att.filename,
                    content_type: att.content_type,
                    size_bytes: att.size_bytes,
                    url: attachment_proxy_url(att.id),
                });
            }
        }

        // Batch load reactions
        enrich_with_reactions(pool, &mut messages).await?;

        Ok(messages)
    }
}
