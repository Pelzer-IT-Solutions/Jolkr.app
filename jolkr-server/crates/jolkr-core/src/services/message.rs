use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{self, PgPool};
use tracing::info;
use uuid::Uuid;

use jolkr_common::{JolkrError, Permissions};
use jolkr_db::models::MessageRow;
use jolkr_db::repo::{AttachmentRepo, EmbedRepo, MemberRepo, MessageRepo, PinRepo, PollRepo, ReactionRepo, ThreadRepo};
use jolkr_db::repo::{ChannelRepo, RoleRepo, ServerRepo};

/// Attachment info included in message responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentInfo {
    pub id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub url: String,
}

/// Generate the proxy URL for an attachment (served via /api/files/:id with auth).
pub fn attachment_proxy_url(id: Uuid) -> String {
    format!("/api/files/{id}")
}

/// Reaction info included in message responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReactionInfo {
    pub emoji: String,
    pub count: i64,
    pub user_ids: Vec<Uuid>,
}

/// Embed info included in message responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedInfo {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub color: Option<String>,
}

/// Public message DTO.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageInfo {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: Option<String>,
    pub nonce: Option<String>,
    pub is_edited: bool,
    pub is_pinned: bool,
    pub reply_to_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_reply_count: Option<i64>,
    #[serde(default)]
    pub attachments: Vec<AttachmentInfo>,
    #[serde(default)]
    pub reactions: Vec<ReactionInfo>,
    #[serde(default)]
    pub embeds: Vec<EmbedInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_avatar: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<MessageRow> for MessageInfo {
    fn from(row: MessageRow) -> Self {
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        Self {
            id: row.id,
            channel_id: row.channel_id,
            author_id: row.author_id,
            content: row.content,
            nonce: row.nonce.map(|b| engine.encode(&b)),
            is_edited: row.is_edited,
            is_pinned: row.is_pinned,
            reply_to_id: row.reply_to_id,
            thread_id: row.thread_id,
            thread_reply_count: None,
            attachments: Vec::new(),
            reactions: Vec::new(),
            embeds: Vec::new(),
            poll: None,
            webhook_id: None,
            webhook_name: None,
            webhook_avatar: None,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: Option<String>,
    pub nonce: Option<String>,             // base64-encoded
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditMessageRequest {
    pub content: String,
    pub nonce: Option<String>,  // base64-encoded; when provided, updates nonce in DB
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageQuery {
    pub before: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
}

/// Maximum message content length (4000 characters, same as Discord).
const MAX_MESSAGE_LENGTH: usize = 4000;

/// Batch load reactions and attach them to messages.
pub(crate) async fn enrich_with_reactions(pool: &PgPool, messages: &mut [MessageInfo]) -> Result<(), JolkrError> {
    let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let all_reactions = ReactionRepo::list_for_messages(pool, &msg_ids).await?;

    // Group by message_id, then by emoji
    let mut by_msg: HashMap<Uuid, HashMap<String, (i64, Vec<Uuid>)>> = HashMap::new();
    for r in all_reactions {
        let entry = by_msg.entry(r.message_id).or_default();
        let emoji_entry = entry.entry(r.emoji).or_insert((0, Vec::new()));
        emoji_entry.0 += 1;
        emoji_entry.1.push(r.user_id);
    }

    for msg in messages.iter_mut() {
        if let Some(emojis) = by_msg.remove(&msg.id) {
            msg.reactions = emojis
                .into_iter()
                .map(|(emoji, (count, user_ids))| ReactionInfo {
                    emoji,
                    count,
                    user_ids,
                })
                .collect();
        }
    }
    Ok(())
}

/// Batch load thread reply counts for messages that are thread starters.
pub(crate) async fn enrich_with_thread_counts(pool: &PgPool, messages: &mut [MessageInfo]) -> Result<(), JolkrError> {
    // Collect message IDs that could be thread starters — we check threads table for starter_msg_id
    let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    if msg_ids.is_empty() {
        return Ok(());
    }

    // Find all threads whose starter_msg_id is in our message set
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        r#"SELECT starter_msg_id, id FROM threads WHERE starter_msg_id = ANY($1)"#,
    )
    .bind(&msg_ids)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(());
    }

    let thread_ids: Vec<Uuid> = rows.iter().map(|r| r.1).collect();
    let counts = ThreadRepo::message_counts(pool, &thread_ids).await?;

    // Map starter_msg_id → thread_id → count
    let thread_count_map: HashMap<Uuid, i64> = counts.into_iter().collect();
    let starter_to_thread: HashMap<Uuid, Uuid> = rows.into_iter().collect();

    for msg in messages.iter_mut() {
        if let Some(&thread_id) = starter_to_thread.get(&msg.id) {
            let count = thread_count_map.get(&thread_id).copied().unwrap_or(0);
            msg.thread_reply_count = Some(count);
            // Also set thread_id on the starter message so frontend knows it has a thread
            if msg.thread_id.is_none() {
                msg.thread_id = Some(thread_id);
            }
        }
    }
    Ok(())
}

/// Batch load embeds and attach them to messages.
pub(crate) async fn enrich_with_embeds(pool: &PgPool, messages: &mut [MessageInfo]) -> Result<(), JolkrError> {
    let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let all_embeds = EmbedRepo::list_for_messages(pool, &msg_ids).await?;

    let mut by_msg: HashMap<Uuid, Vec<EmbedInfo>> = HashMap::new();
    for e in all_embeds {
        by_msg.entry(e.message_id).or_default().push(EmbedInfo {
            url: e.url,
            title: e.title,
            description: e.description,
            image_url: e.image_url,
            site_name: e.site_name,
            color: e.color,
        });
    }

    for msg in messages.iter_mut() {
        if let Some(embeds) = by_msg.remove(&msg.id) {
            msg.embeds = embeds;
        }
    }
    Ok(())
}

/// Batch load attachments and attach them to messages using HashMap for O(n+m) lookup.
pub(crate) async fn enrich_with_attachments(pool: &PgPool, messages: &mut [MessageInfo]) -> Result<(), JolkrError> {
    let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let all_atts = AttachmentRepo::list_for_messages(pool, &msg_ids).await?;

    let mut by_msg: HashMap<Uuid, Vec<AttachmentInfo>> = HashMap::new();
    for att in all_atts {
        by_msg.entry(att.message_id).or_default().push(AttachmentInfo {
            id: att.id,
            filename: att.filename,
            content_type: att.content_type,
            size_bytes: att.size_bytes,
            url: attachment_proxy_url(att.id),
        });
    }

    for msg in messages.iter_mut() {
        if let Some(atts) = by_msg.remove(&msg.id) {
            msg.attachments = atts;
        }
    }
    Ok(())
}

/// Batch load polls and attach them to messages as JSON.
/// Note: `my_votes` is left empty because enrichment has no viewer context.
/// The frontend PollDisplay component will fetch fresh data when the user interacts.
pub(crate) async fn enrich_with_polls(pool: &PgPool, messages: &mut [MessageInfo]) -> Result<(), JolkrError> {
    let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    if msg_ids.is_empty() {
        return Ok(());
    }

    let polls = PollRepo::get_by_message_ids(pool, &msg_ids).await?;
    if polls.is_empty() {
        return Ok(());
    }

    let poll_ids: Vec<Uuid> = polls.iter().map(|p| p.id).collect();

    // Batch load options and vote counts
    let all_options = PollRepo::get_options_batch(pool, &poll_ids).await?;
    let all_counts = PollRepo::get_vote_counts_batch(pool, &poll_ids).await?;

    // Group options by poll_id
    let mut options_by_poll: HashMap<Uuid, Vec<serde_json::Value>> = HashMap::new();
    for opt in all_options {
        options_by_poll.entry(opt.poll_id).or_default().push(serde_json::json!({
            "id": opt.id,
            "poll_id": opt.poll_id,
            "position": opt.position,
            "text": opt.text,
        }));
    }

    // Group vote counts by poll_id → { option_id_str: count }
    let mut votes_by_poll: HashMap<Uuid, HashMap<String, i64>> = HashMap::new();
    let mut totals_by_poll: HashMap<Uuid, i64> = HashMap::new();
    for (poll_id, option_id, count) in &all_counts {
        votes_by_poll.entry(*poll_id).or_default().insert(option_id.to_string(), *count);
        *totals_by_poll.entry(*poll_id).or_insert(0) += count;
    }

    // Map message_id → poll JSON
    let mut poll_by_msg: HashMap<Uuid, serde_json::Value> = HashMap::new();
    for poll in polls {
        let options = options_by_poll.remove(&poll.id).unwrap_or_default();
        let votes = votes_by_poll.remove(&poll.id).unwrap_or_default();
        let total = totals_by_poll.get(&poll.id).copied().unwrap_or(0);

        poll_by_msg.insert(poll.message_id, serde_json::json!({
            "id": poll.id,
            "message_id": poll.message_id,
            "channel_id": poll.channel_id,
            "question": poll.question,
            "multi_select": poll.multi_select,
            "anonymous": poll.anonymous,
            "expires_at": poll.expires_at,
            "options": options,
            "votes": votes,
            "my_votes": [],
            "total_votes": total,
        }));
    }

    for msg in messages.iter_mut() {
        if let Some(poll_json) = poll_by_msg.remove(&msg.id) {
            msg.poll = Some(poll_json);
        }
    }
    Ok(())
}

pub struct MessageService;

impl MessageService {
    /// Internal helper to validate and create a message with optional thread_id.
    pub(crate) async fn send_message_internal(
        pool: &PgPool,
        channel_id: Uuid,
        author_id: Uuid,
        req: SendMessageRequest,
        thread_id: Option<Uuid>,
    ) -> Result<MessageInfo, JolkrError> {
        // Validate: content must be present
        if req.content.is_none() {
            return Err(JolkrError::Validation(
                "Message must have content".into(),
            ));
        }

        // Validate content length
        if let Some(ref content) = req.content {
            if content.trim().is_empty() {
                return Err(JolkrError::Validation("Message content cannot be empty".into()));
            }
            if content.len() > MAX_MESSAGE_LENGTH {
                return Err(JolkrError::Validation(
                    format!("Message content exceeds {MAX_MESSAGE_LENGTH} characters"),
                ));
            }
        }

        // Verify the channel exists and the user is a member of its server
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let member = MemberRepo::get_member(pool, channel.server_id, author_id).await.map_err(|_| {
            JolkrError::Forbidden
        })?;

        // Check if member is timed out
        if MemberRepo::is_timed_out(pool, channel.server_id, author_id).await? {
            return Err(JolkrError::Forbidden);
        }

        // Check VIEW_CHANNELS + SEND_MESSAGES permission for this channel (owner bypasses)
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != author_id {
            let ch_perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, channel_id, member.id,
            ).await?;
            let perms = Permissions::from(ch_perms);
            if !perms.has(Permissions::VIEW_CHANNELS) {
                return Err(JolkrError::Forbidden);
            }
            if !perms.has(Permissions::SEND_MESSAGES) {
                return Err(JolkrError::Forbidden);
            }
        }

        // Enforce slowmode (only for non-thread messages)
        if thread_id.is_none() && channel.slowmode_seconds > 0 {
            let since = Utc::now() - chrono::Duration::seconds(channel.slowmode_seconds as i64);
            let recent = MessageRepo::last_by_author_in_channel(pool, channel_id, author_id).await?;
            if let Some(last_msg) = recent {
                if last_msg.created_at > since {
                    return Err(JolkrError::BadRequest(
                        format!("Slowmode active. Wait {} seconds between messages.", channel.slowmode_seconds),
                    ));
                }
            }
        }

        // Validate reply_to_id belongs to the same channel
        if let Some(reply_id) = req.reply_to_id {
            let reply_msg = MessageRepo::get_by_id(pool, reply_id).await?;
            if reply_msg.channel_id != channel_id {
                return Err(JolkrError::BadRequest(
                    "Cannot reply to a message from a different channel".into(),
                ));
            }
        }

        let message_id = Uuid::new_v4();

        // Decode optional nonce (base64 → bytes)
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let nonce_bytes = req.nonce.as_deref()
            .map(|s| engine.decode(s))
            .transpose()
            .map_err(|_| JolkrError::Validation("Invalid base64 for nonce".into()))?;

        let row = if let Some(tid) = thread_id {
            MessageRepo::create_message_in_thread(
                pool,
                message_id,
                channel_id,
                author_id,
                req.content.as_deref(),
                nonce_bytes.as_deref(),
                req.reply_to_id,
                tid,
            ).await?
        } else {
            MessageRepo::create_message(
                pool,
                message_id,
                channel_id,
                author_id,
                req.content.as_deref(),
                nonce_bytes.as_deref(),
                req.reply_to_id,
            ).await?
        };

        info!(message_id = %message_id, channel_id = %channel_id, "Message sent");
        Ok(MessageInfo::from(row))
    }

    /// Send a message to a channel.
    /// The caller must be a member of the server that owns the channel.
    pub async fn send_message(
        pool: &PgPool,
        channel_id: Uuid,
        author_id: Uuid,
        req: SendMessageRequest,
    ) -> Result<MessageInfo, JolkrError> {
        Self::send_message_internal(pool, channel_id, author_id, req, None).await
    }

    /// Get a single message by ID with attachments and reactions.
    /// Internal use only — callers must verify authorization before calling.
    pub async fn get_message_by_id(
        pool: &PgPool,
        message_id: Uuid,
    ) -> Result<MessageInfo, JolkrError> {
        let row = MessageRepo::get_by_id(pool, message_id).await?;
        let mut msg = MessageInfo::from(row);

        // Load attachments
        let atts = AttachmentRepo::list_for_messages(pool, &[message_id]).await?;
        for att in atts {
            msg.attachments.push(AttachmentInfo {
                id: att.id,
                filename: att.filename,
                content_type: att.content_type,
                size_bytes: att.size_bytes,
                url: attachment_proxy_url(att.id),
            });
        }

        // Load reactions, threads, embeds
        let mut msgs = vec![msg];
        enrich_with_reactions(pool, &mut msgs).await?;
        enrich_with_thread_counts(pool, &mut msgs).await?;
        enrich_with_embeds(pool, &mut msgs).await?;
        enrich_with_polls(pool, &mut msgs).await?;

        msgs.into_iter().next().ok_or(JolkrError::Internal("Failed to enrich message".into()))
    }

    /// Fetch paginated messages for a channel, including attachments (batch loaded).
    pub async fn get_messages(
        pool: &PgPool,
        channel_id: Uuid,
        query: MessageQuery,
    ) -> Result<Vec<MessageInfo>, JolkrError> {
        let limit = query.limit.unwrap_or(50);
        let rows = MessageRepo::list_for_channel(pool, channel_id, query.before, limit).await?;

        let mut messages: Vec<MessageInfo> = rows.iter().map(|r| MessageInfo::from(r.clone())).collect();

        enrich_with_attachments(pool, &mut messages).await?;
        enrich_with_reactions(pool, &mut messages).await?;
        enrich_with_thread_counts(pool, &mut messages).await?;
        enrich_with_embeds(pool, &mut messages).await?;
        enrich_with_polls(pool, &mut messages).await?;

        Ok(messages)
    }

    /// Search messages in a channel by content.
    pub async fn search_messages(
        pool: &PgPool,
        channel_id: Uuid,
        query: &str,
        limit: i64,
    ) -> Result<Vec<MessageInfo>, JolkrError> {
        if query.trim().is_empty() {
            return Err(JolkrError::Validation("Search query is required".into()));
        }

        let rows = MessageRepo::search_in_channel(pool, channel_id, query, limit).await?;

        let mut messages: Vec<MessageInfo> = rows.iter().map(|r| MessageInfo::from(r.clone())).collect();

        enrich_with_attachments(pool, &mut messages).await?;
        enrich_with_reactions(pool, &mut messages).await?;
        enrich_with_thread_counts(pool, &mut messages).await?;
        enrich_with_embeds(pool, &mut messages).await?;
        enrich_with_polls(pool, &mut messages).await?;

        Ok(messages)
    }

    /// Enrich raw MessageRows with attachments, reactions, threads, embeds.
    pub async fn enrich_messages(
        pool: &PgPool,
        rows: Vec<MessageRow>,
    ) -> Result<Vec<MessageInfo>, JolkrError> {
        let mut messages: Vec<MessageInfo> = rows.iter().map(|r| MessageInfo::from(r.clone())).collect();

        enrich_with_attachments(pool, &mut messages).await?;
        enrich_with_reactions(pool, &mut messages).await?;
        enrich_with_thread_counts(pool, &mut messages).await?;
        enrich_with_embeds(pool, &mut messages).await?;
        enrich_with_polls(pool, &mut messages).await?;

        Ok(messages)
    }

    /// Edit a message. Only the original author may edit.
    pub async fn edit_message(
        pool: &PgPool,
        message_id: Uuid,
        caller_id: Uuid,
        req: EditMessageRequest,
    ) -> Result<MessageInfo, JolkrError> {
        let msg = MessageRepo::get_by_id(pool, message_id).await?;
        if msg.author_id != caller_id {
            return Err(JolkrError::Forbidden);
        }

        let content = req.content.trim().to_string();
        if content.is_empty() {
            return Err(JolkrError::Validation("Content cannot be empty".into()));
        }
        if content.len() > MAX_MESSAGE_LENGTH {
            return Err(JolkrError::Validation(
                format!("Message content exceeds {MAX_MESSAGE_LENGTH} characters"),
            ));
        }

        // Decode optional nonce (base64 → bytes)
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let nonce_bytes = req.nonce.as_deref()
            .map(|s| engine.decode(s))
            .transpose()
            .map_err(|_| JolkrError::Validation("Invalid base64 for nonce".into()))?;

        let _updated = MessageRepo::update(pool, message_id, &content, nonce_bytes.as_deref()).await?;
        // Return the full enriched message (with attachments, reactions, thread info)
        // instead of the bare MessageRow, so the broadcast includes all data.
        Self::get_message_by_id(pool, message_id).await
    }

    /// Delete a message. The author, server owner, or users with MANAGE_MESSAGES may delete.
    pub async fn delete_message(
        pool: &PgPool,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Uuid, JolkrError> {
        let msg = MessageRepo::get_by_id(pool, message_id).await?;

        // Allow author to delete their own messages
        if msg.author_id != caller_id {
            let channel = ChannelRepo::get_by_id(pool, msg.channel_id).await?;
            let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
            // Owner bypasses permission checks
            if server.owner_id != caller_id {
                let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
                    .await
                    .map_err(|_| JolkrError::Forbidden)?;
                let ch_perms = RoleRepo::compute_channel_permissions(
                    pool, channel.server_id, msg.channel_id, member.id,
                ).await?;
                if !Permissions::from(ch_perms).has(Permissions::MANAGE_MESSAGES) {
                    return Err(JolkrError::Forbidden);
                }
            }
        }

        MessageRepo::delete(pool, message_id).await?;
        info!(message_id = %message_id, "Message deleted");
        Ok(msg.channel_id)
    }

    /// Pin a message. Requires MANAGE_MESSAGES channel permission.
    pub async fn pin_message(
        pool: &PgPool,
        channel_id: Uuid,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<MessageInfo, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        // Check MANAGE_MESSAGES (owner bypasses)
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            let ch_perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, channel_id, member.id,
            ).await?;
            if !Permissions::from(ch_perms).has(Permissions::MANAGE_MESSAGES) {
                return Err(JolkrError::Forbidden);
            }
        }

        let msg = MessageRepo::get_by_id(pool, message_id).await?;
        if msg.channel_id != channel_id {
            return Err(JolkrError::BadRequest("Message does not belong to this channel".into()));
        }

        PinRepo::pin(pool, channel_id, message_id, caller_id).await?;
        let updated = MessageRepo::set_pinned(pool, message_id, true).await?;
        let mut msgs = vec![MessageInfo::from(updated)];
        enrich_with_reactions(pool, &mut msgs).await?;
        enrich_with_attachments(pool, &mut msgs).await?;
        enrich_with_embeds(pool, &mut msgs).await?;
        enrich_with_polls(pool, &mut msgs).await?;
        info!(message_id = %message_id, channel_id = %channel_id, "Message pinned");
        Ok(msgs.into_iter().next().unwrap())
    }

    /// Unpin a message. Requires MANAGE_MESSAGES channel permission.
    pub async fn unpin_message(
        pool: &PgPool,
        channel_id: Uuid,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<MessageInfo, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        // Check MANAGE_MESSAGES (owner bypasses)
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            let ch_perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, channel_id, member.id,
            ).await?;
            if !Permissions::from(ch_perms).has(Permissions::MANAGE_MESSAGES) {
                return Err(JolkrError::Forbidden);
            }
        }

        let msg = MessageRepo::get_by_id(pool, message_id).await?;
        if msg.channel_id != channel_id {
            return Err(JolkrError::BadRequest("Message does not belong to this channel".into()));
        }

        PinRepo::unpin(pool, channel_id, message_id).await?;
        let updated = MessageRepo::set_pinned(pool, message_id, false).await?;
        let mut msgs = vec![MessageInfo::from(updated)];
        enrich_with_reactions(pool, &mut msgs).await?;
        enrich_with_attachments(pool, &mut msgs).await?;
        enrich_with_embeds(pool, &mut msgs).await?;
        enrich_with_polls(pool, &mut msgs).await?;
        info!(message_id = %message_id, channel_id = %channel_id, "Message unpinned");
        Ok(msgs.into_iter().next().unwrap())
    }

    /// List pinned messages for a channel. Requires VIEW_CHANNELS.
    pub async fn list_pinned(
        pool: &PgPool,
        channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<MessageInfo>, JolkrError> {
        let channel = ChannelRepo::get_by_id(pool, channel_id).await?;
        let member = MemberRepo::get_member(pool, channel.server_id, caller_id)
            .await
            .map_err(|_| JolkrError::Forbidden)?;
        // Check VIEW_CHANNELS (owner bypasses)
        let server = ServerRepo::get_by_id(pool, channel.server_id).await?;
        if server.owner_id != caller_id {
            let ch_perms = RoleRepo::compute_channel_permissions(
                pool, channel.server_id, channel_id, member.id,
            ).await?;
            if !Permissions::from(ch_perms).has(Permissions::VIEW_CHANNELS) {
                return Err(JolkrError::Forbidden);
            }
        }

        let pins = PinRepo::list_for_channel(pool, channel_id).await?;
        let pin_ids: Vec<Uuid> = pins.iter().map(|p| p.message_id).collect();
        let rows = MessageRepo::get_by_ids(pool, &pin_ids).await?;
        let mut messages: Vec<MessageInfo> = rows.into_iter().map(MessageInfo::from).collect();

        enrich_with_attachments(pool, &mut messages).await?;
        enrich_with_reactions(pool, &mut messages).await?;
        enrich_with_polls(pool, &mut messages).await?;

        Ok(messages)
    }
}
