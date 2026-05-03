use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use tracing::warn;

use jolkr_common::JolkrError;
use jolkr_db::models::DmMessageRow;
use jolkr_db::repo::{DmRepo, FriendshipRepo, UserRepo};

use super::message::{AttachmentInfo, EmbedInfo, ReactionInfo, attachment_proxy_url};

/// Lightweight last-message preview included in the DM channel list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmLastMessage {
    /// Unique identifier.
    pub id: Uuid,
    /// Author user identifier.
    pub author_id: Uuid,
    /// Message content (may be encrypted).
    pub content: Option<String>,
    /// Encryption nonce when content is encrypted.
    pub nonce: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Public information about `dmchannel`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmChannelInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// Whether this is a group conversation.
    pub is_group: bool,
    /// Display name.
    pub name: Option<String>,
    /// Member list.
    pub members: Vec<Uuid>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_message: Option<DmLastMessage>,
}

/// Public information about `dmmessage`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmMessageInfo {
    /// Unique identifier.
    pub id: Uuid,
    /// DM channel identifier.
    pub dm_channel_id: Uuid,
    /// Author user identifier.
    pub author_id: Uuid,
    /// Message content (may be encrypted).
    pub content: Option<String>,
    /// Encryption nonce when content is encrypted.
    pub nonce: Option<String>,
    /// Whether the message has been edited.
    pub is_edited: bool,
    /// Whether the message is pinned.
    pub is_pinned: bool,
    /// Reply to identifier.
    pub reply_to_id: Option<Uuid>,
    /// Attached files.
    pub attachments: Vec<AttachmentInfo>,
    /// Aggregated reactions.
    #[serde(default)]
    pub reactions: Vec<ReactionInfo>,
    /// Attached embeds.
    #[serde(default)]
    pub embeds: Vec<EmbedInfo>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

impl From<DmMessageRow> for DmMessageInfo {
    fn from(row: DmMessageRow) -> Self {
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        Self {
            id: row.id,
            dm_channel_id: row.dm_channel_id,
            author_id: row.author_id,
            content: row.content,
            nonce: row.nonce.map(|b| engine.encode(&b)),
            is_edited: row.is_edited,
            is_pinned: row.is_pinned,
            reply_to_id: row.reply_to_id,
            attachments: Vec::new(),
            reactions: Vec::new(),
            embeds: Vec::new(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Request payload for the `SendDm` operation.
#[derive(Debug, Deserialize)]
pub struct SendDmRequest {
    /// Message content (may be encrypted).
    pub content: Option<String>,
    /// Encryption nonce when content is encrypted.
    pub nonce: Option<String>,
    /// Reply to identifier.
    pub reply_to_id: Option<Uuid>,
}

/// Request payload for the `EditDm` operation.
#[derive(Debug, Deserialize)]
pub struct EditDmRequest {
    /// Message content (may be encrypted).
    pub content: String,
    /// Encryption nonce when content is encrypted.
    pub nonce: Option<String>,  // base64-encoded; when provided, updates nonce in DB
}

/// `DmMessageQuery` value.
#[derive(Debug, Deserialize)]
pub struct DmMessageQuery {
    /// Before.
    pub before: Option<DateTime<Utc>>,
    /// Limit.
    pub limit: Option<i64>,
}

/// Maximum DM message content length (4000 characters).
const MAX_DM_MESSAGE_LENGTH: usize = 4000;

/// Maximum number of members in a group DM.
const MAX_GROUP_DM_MEMBERS: usize = 10;

/// Maximum length of a group DM name.
const MAX_GROUP_NAME_LENGTH: usize = 100;

/// Request payload for the `CreateGroupDm` operation.
#[derive(Debug, Deserialize)]
pub struct CreateGroupDmRequest {
    /// User ids.
    pub user_ids: Vec<Uuid>,
    /// Display name.
    pub name: Option<String>,
}

/// Request payload for the `AddMember` operation.
#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    /// Owning user identifier.
    pub user_id: Uuid,
}

/// Request payload for the `UpdateGroupDm` operation.
#[derive(Debug, Deserialize)]
pub struct UpdateGroupDmRequest {
    /// Display name.
    pub name: Option<String>,
}

/// Domain service for `dm` operations.
pub struct DmService;

impl DmService {
    /// Open (or get existing) DM with another user.
    pub async fn open_dm(
        pool: &PgPool,
        caller_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<DmChannelInfo, JolkrError> {
        if caller_id == target_user_id {
            return Err(JolkrError::BadRequest("Cannot DM yourself".into()));
        }

        // Enforce target user's DM privacy filter. `Forbidden` is the
        // semantically correct status, but `JolkrError::Forbidden` is unit-
        // only and would lose the user-facing message. `BadRequest` is the
        // closest variant that carries a string and surfaces it via the
        // existing toast plumbing.
        let target = UserRepo::get_by_id(pool, target_user_id).await?;
        match target.dm_filter.as_str() {
            "none" => {
                return Err(JolkrError::BadRequest(
                    "This user is not accepting DMs".into(),
                ));
            }
            "friends" => {
                let are_friends = FriendshipRepo::are_friends(pool, caller_id, target_user_id).await?;
                if !are_friends {
                    return Err(JolkrError::BadRequest(
                        "This user only accepts DMs from friends".into(),
                    ));
                }
            }
            _ => {} // "all" — no gate
        }

        let channel = DmRepo::get_or_create_dm(pool, caller_id, target_user_id).await?;
        // Clear `closed_at` for any soft-closed members so a reopened DM
        // reappears in their list immediately. Without this, `list_dms`
        // filters the channel out for the caller and the new conversation
        // never shows up on the initiator's side.
        DmRepo::reopen_dm(pool, channel.id).await.ok();
        let members = DmRepo::get_dm_members(pool, channel.id).await?;
        let member_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();

        Ok(DmChannelInfo {
            id: channel.id,
            is_group: channel.is_group,
            name: channel.name,
            members: member_ids,
            created_at: channel.created_at,
            last_message: None,
        })
    }

    /// List all DM channels for the caller (batch loads members).
    pub async fn list_dms(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<DmChannelInfo>, JolkrError> {
        let channels = DmRepo::list_dm_channels(pool, user_id).await?;

        // Batch load members + last messages in parallel. The caller's hidden
        // messages are filtered out so the sidebar preview never shows
        // something they removed from their own view.
        let channel_ids: Vec<Uuid> = channels.iter().map(|ch| ch.id).collect();
        let (all_members, last_messages) = tokio::try_join!(
            DmRepo::get_members_for_channels(pool, &channel_ids),
            DmRepo::get_last_messages_for_user(pool, &channel_ids, Some(user_id)),
        )?;

        let result = channels
            .into_iter()
            .map(|ch| {
                let member_ids: Vec<Uuid> = all_members
                    .iter()
                    .filter(|m| m.dm_channel_id == ch.id)
                    .map(|m| m.user_id)
                    .collect();
                let last_msg = last_messages.iter().find(|m| m.dm_channel_id == ch.id).map(|m| {
                    use base64::Engine;
                    let engine = base64::engine::general_purpose::STANDARD;
                    DmLastMessage {
                        id: m.id,
                        author_id: m.author_id,
                        content: m.content.clone(),
                        nonce: m.nonce.as_ref().map(|n| engine.encode(n)),
                        created_at: m.created_at,
                    }
                });
                DmChannelInfo {
                    id: ch.id,
                    is_group: ch.is_group,
                    name: ch.name,
                    members: member_ids,
                    created_at: ch.created_at,
                    last_message: last_msg,
                }
            })
            .collect();

        Ok(result)
    }

    /// Create a group DM with multiple users.
    pub async fn create_group_dm(
        pool: &PgPool,
        caller_id: Uuid,
        req: CreateGroupDmRequest,
    ) -> Result<DmChannelInfo, JolkrError> {
        // Caller must not be in the user_ids list
        let mut member_ids: Vec<Uuid> = req.user_ids.into_iter().filter(|id| *id != caller_id).collect();
        member_ids.push(caller_id);
        member_ids.sort();
        member_ids.dedup();

        if member_ids.len() < 3 {
            return Err(JolkrError::Validation(
                "Group DM requires at least 3 members (you + 2 others)".into(),
            ));
        }
        if member_ids.len() > MAX_GROUP_DM_MEMBERS {
            return Err(JolkrError::Validation(
                format!("Group DM cannot exceed {MAX_GROUP_DM_MEMBERS} members"),
            ));
        }

        // Trim name, treat whitespace-only as None
        let name = req.name.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty());
        if let Some(ref name) = name {
            if name.len() > MAX_GROUP_NAME_LENGTH {
                return Err(JolkrError::Validation(
                    format!("Group name cannot exceed {MAX_GROUP_NAME_LENGTH} characters"),
                ));
            }
        }

        // Verify all users exist + enforce per-member DM privacy filter so
        // group creation is consistent with 1:1 `open_dm`. If ANY non-caller
        // member rejects DMs from the caller, the whole group fails.
        for &uid in &member_ids {
            let row = UserRepo::get_by_id(pool, uid).await?;
            if uid == caller_id { continue; }
            match row.dm_filter.as_str() {
                "none" => {
                    return Err(JolkrError::BadRequest(format!(
                        "{} is not accepting DMs",
                        row.display_name.clone().unwrap_or(row.username),
                    )));
                }
                "friends" => {
                    let are_friends = FriendshipRepo::are_friends(pool, caller_id, uid).await?;
                    if !are_friends {
                        return Err(JolkrError::BadRequest(format!(
                            "{} only accepts DMs from friends",
                            row.display_name.clone().unwrap_or(row.username),
                        )));
                    }
                }
                _ => {}
            }
        }

        let channel = DmRepo::create_group_dm(pool, name.as_deref(), &member_ids).await?;

        Ok(DmChannelInfo {
            id: channel.id,
            is_group: true,
            name: channel.name,
            members: member_ids,
            created_at: channel.created_at,
            last_message: None,
        })
    }

    /// Add a member to a group DM.
    pub async fn add_member(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<DmChannelInfo, JolkrError> {
        let channel = DmRepo::get_channel(pool, dm_channel_id).await?;
        if !channel.is_group {
            return Err(JolkrError::BadRequest("Cannot add members to a 1-on-1 DM".into()));
        }
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }

        let count = DmRepo::count_members(pool, dm_channel_id).await?;
        if count >= MAX_GROUP_DM_MEMBERS as i64 {
            return Err(JolkrError::Validation(
                format!("Group DM cannot exceed {MAX_GROUP_DM_MEMBERS} members"),
            ));
        }

        // Verify target user exists
        UserRepo::get_by_id(pool, target_user_id).await?;

        DmRepo::add_member(pool, dm_channel_id, target_user_id).await?;

        let members = DmRepo::get_dm_members(pool, dm_channel_id).await?;
        let member_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();

        Ok(DmChannelInfo {
            id: channel.id,
            is_group: true,
            name: channel.name,
            members: member_ids,
            created_at: channel.created_at,
            last_message: None,
        })
    }

    /// Leave a group DM.
    pub async fn leave_group(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<DmChannelInfo, JolkrError> {
        let channel = DmRepo::get_channel(pool, dm_channel_id).await?;
        if !channel.is_group {
            return Err(JolkrError::BadRequest("Cannot leave a 1-on-1 DM".into()));
        }
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }

        DmRepo::remove_member(pool, dm_channel_id, caller_id).await?;

        let members = DmRepo::get_dm_members(pool, dm_channel_id).await?;
        let member_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();

        Ok(DmChannelInfo {
            id: channel.id,
            is_group: true,
            name: channel.name,
            members: member_ids,
            created_at: channel.created_at,
            last_message: None,
        })
    }

    /// Update a group DM (name).
    pub async fn update_group(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
        req: UpdateGroupDmRequest,
    ) -> Result<DmChannelInfo, JolkrError> {
        let channel = DmRepo::get_channel(pool, dm_channel_id).await?;
        if !channel.is_group {
            return Err(JolkrError::BadRequest("Cannot update a 1-on-1 DM".into()));
        }
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }

        // Trim name, treat whitespace-only as None
        let name = req.name.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty());
        if let Some(ref name) = name {
            if name.len() > MAX_GROUP_NAME_LENGTH {
                return Err(JolkrError::Validation(
                    format!("Group name cannot exceed {MAX_GROUP_NAME_LENGTH} characters"),
                ));
            }
        }

        let updated = DmRepo::update_group_dm(pool, dm_channel_id, name.as_deref()).await?;

        let members = DmRepo::get_dm_members(pool, dm_channel_id).await?;
        let member_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();

        Ok(DmChannelInfo {
            id: updated.id,
            is_group: true,
            name: updated.name,
            members: member_ids,
            created_at: updated.created_at,
            last_message: None,
        })
    }

    /// Close (hide) a DM channel for the caller.
    pub async fn close_dm(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<(), JolkrError> {
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }
        DmRepo::close_dm(pool, dm_channel_id, caller_id).await?;
        Ok(())
    }

    /// Mark messages as read up to a given message ID.
    /// Returns `true` if the read receipt should be broadcast (user has `show_read_receipts` enabled).
    pub async fn mark_as_read(
        pool: &PgPool,
        dm_channel_id: Uuid,
        user_id: Uuid,
        message_id: Uuid,
    ) -> Result<bool, JolkrError> {
        // Validate user is a member of the DM
        if !DmRepo::is_member(pool, dm_channel_id, user_id).await? {
            return Err(JolkrError::Forbidden);
        }

        // Validate message belongs to this DM channel
        let msg = DmRepo::get_message(pool, message_id).await?;
        if msg.dm_channel_id != dm_channel_id {
            return Err(JolkrError::BadRequest("Message does not belong to this DM channel".into()));
        }

        // Update last_read_message_id
        DmRepo::update_last_read(pool, dm_channel_id, user_id, message_id).await?;

        // Check if user has show_read_receipts enabled
        let user = UserRepo::get_by_id(pool, user_id).await?;
        Ok(user.show_read_receipts)
    }

    /// Send a message in a DM channel.
    pub async fn send_message(
        pool: &PgPool,
        dm_channel_id: Uuid,
        author_id: Uuid,
        req: SendDmRequest,
    ) -> Result<DmMessageInfo, JolkrError> {
        if req.content.is_none() {
            return Err(JolkrError::Validation(
                "Message must have content".into(),
            ));
        }

        if let Some(ref content) = req.content {
            if content.trim().is_empty() {
                return Err(JolkrError::Validation("Message content cannot be empty".into()));
            }
            if content.len() > MAX_DM_MESSAGE_LENGTH {
                return Err(JolkrError::Validation(
                    format!("Message content exceeds {MAX_DM_MESSAGE_LENGTH} characters"),
                ));
            }
        }

        if !DmRepo::is_member(pool, dm_channel_id, author_id).await? {
            return Err(JolkrError::Forbidden);
        }

        // Block messages to system users (announcement-only DMs)
        let members = DmRepo::get_dm_members(pool, dm_channel_id).await?;
        let other_member_ids: Vec<Uuid> = members
            .iter()
            .filter(|m| m.user_id != author_id)
            .map(|m| m.user_id)
            .collect();
        if !other_member_ids.is_empty() {
            let other_users = UserRepo::get_by_ids(pool, &other_member_ids).await?;
            if other_users.iter().any(|u| u.is_system) {
                return Err(JolkrError::BadRequest(
                    "Cannot reply to announcement messages".into(),
                ));
            }
        }

        // Validate reply_to_id belongs to the same DM channel
        if let Some(reply_id) = req.reply_to_id {
            let reply_msg = DmRepo::get_message(pool, reply_id).await?;
            if reply_msg.dm_channel_id != dm_channel_id {
                return Err(JolkrError::BadRequest(
                    "Cannot reply to a message from a different conversation".into(),
                ));
            }
        }

        // Decode optional nonce (base64 → bytes)
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let nonce = req.nonce.as_deref()
            .map(|s| engine.decode(s))
            .transpose()
            .map_err(|_| JolkrError::Validation("Invalid base64 for nonce".into()))?;

        let msg_id = Uuid::new_v4();
        let row = DmRepo::send_message(
            pool,
            msg_id,
            dm_channel_id,
            author_id,
            req.content.as_deref(),
            nonce.as_deref(),
            req.reply_to_id,
        )
        .await?;

        // Reopen the DM for any members who closed it
        DmRepo::reopen_dm(pool, dm_channel_id).await.ok();

        Ok(DmMessageInfo::from(row))
    }

    /// Edit a DM message.
    pub async fn edit_message(
        pool: &PgPool,
        message_id: Uuid,
        caller_id: Uuid,
        req: EditDmRequest,
    ) -> Result<DmMessageInfo, JolkrError> {
        let msg = DmRepo::get_message(pool, message_id).await?;
        if msg.author_id != caller_id {
            return Err(JolkrError::Forbidden);
        }

        let content = req.content.trim().to_owned();
        if content.is_empty() {
            return Err(JolkrError::Validation("Message content cannot be empty".into()));
        }
        if content.len() > MAX_DM_MESSAGE_LENGTH {
            return Err(JolkrError::Validation(
                format!("Message content exceeds {MAX_DM_MESSAGE_LENGTH} characters"),
            ));
        }

        // Decode optional nonce (base64 → bytes)
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let nonce_bytes = req.nonce.as_deref()
            .map(|s| engine.decode(s))
            .transpose()
            .map_err(|_| JolkrError::Validation("Invalid base64 for nonce".into()))?;

        let row = DmRepo::update_message(pool, message_id, &content, nonce_bytes.as_deref()).await?;
        Ok(DmMessageInfo::from(row))
    }

    /// Delete a DM message (only author can delete).
    pub async fn delete_message(
        pool: &PgPool,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Uuid, JolkrError> {
        let msg = DmRepo::get_message(pool, message_id).await?;
        if msg.author_id != caller_id {
            return Err(JolkrError::Forbidden);
        }
        let dm_channel_id = msg.dm_channel_id;
        DmRepo::delete_message(pool, message_id).await?;
        Ok(dm_channel_id)
    }

    /// Soft-hide a DM message for the calling user only. Anyone who is a
    /// member of the channel may hide any message — used for the "Only for
    /// me" delete option and for shift-deleting messages from other users.
    /// Returns the DM channel id so the route can broadcast to the user's
    /// other sessions.
    pub async fn hide_message_for_me(
        pool: &PgPool,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Uuid, JolkrError> {
        let msg = DmRepo::get_message(pool, message_id).await?;
        if !DmRepo::is_member(pool, msg.dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }
        DmRepo::hide_message_for_user(pool, message_id, caller_id, msg.dm_channel_id).await?;
        Ok(msg.dm_channel_id)
    }

    /// List every attachment shared in a DM channel for the "Shared Files"
    /// side panel. Membership is enforced and per-user hidden messages are
    /// excluded so the caller never sees an attachment from a message they
    /// removed from their view.
    pub async fn list_attachments(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
        limit: Option<i64>,
    ) -> Result<Vec<AttachmentInfo>, JolkrError> {
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }
        let rows = DmRepo::list_attachments_for_dm(
            pool,
            dm_channel_id,
            caller_id,
            limit.unwrap_or(100),
        )
        .await?;
        Ok(rows
            .into_iter()
            .map(|a| AttachmentInfo {
                id: a.id,
                filename: a.filename,
                content_type: a.content_type,
                size_bytes: a.size_bytes,
                url: attachment_proxy_url(a.id),
            })
            .collect())
    }

    /// Get messages in a DM channel with cursor pagination (batch loads attachments).
    pub async fn get_messages(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
        query: DmMessageQuery,
    ) -> Result<Vec<DmMessageInfo>, JolkrError> {
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }

        let limit = query.limit.unwrap_or(50).min(100).max(1);
        let rows = DmRepo::get_messages(pool, dm_channel_id, caller_id, query.before, limit).await?;
        let mut messages: Vec<DmMessageInfo> = rows.into_iter().map(DmMessageInfo::from).collect();

        // Batch load all attachments in one query
        let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
        let all_atts = match DmRepo::list_attachments_for_messages(pool, &msg_ids).await {
            Ok(atts) => atts,
            Err(e) => {
                warn!(error = %e, "Failed to load DM attachments");
                Vec::new()
            }
        };
        for att in all_atts {
            if let Some(msg) = messages.iter_mut().find(|m| m.id == att.dm_message_id) {
                msg.attachments.push(AttachmentInfo {
                    id: att.id,
                    filename: att.filename,
                    content_type: att.content_type,
                    size_bytes: att.size_bytes,
                    url: attachment_proxy_url(att.id),
                });
            }
        }

        // Batch load all reactions in one query
        let all_reactions = match DmRepo::list_reactions_for_messages(pool, &msg_ids).await {
            Ok(reactions) => reactions,
            Err(e) => {
                warn!(error = %e, "Failed to load DM reactions");
                Vec::new()
            }
        };
        {
            use std::collections::HashMap;
            let mut by_msg: HashMap<Uuid, (Vec<String>, HashMap<String, (i64, Vec<Uuid>)>)> = HashMap::new();
            for r in all_reactions {
                let (order, map) = by_msg.entry(r.dm_message_id).or_insert_with(|| (Vec::new(), HashMap::new()));
                if !map.contains_key(&r.emoji) {
                    order.push(r.emoji.clone());
                }
                let emoji_entry = map.entry(r.emoji).or_insert((0, Vec::new()));
                emoji_entry.0 += 1;
                emoji_entry.1.push(r.user_id);
            }
            for msg in &mut messages {
                if let Some((order, mut map)) = by_msg.remove(&msg.id) {
                    msg.reactions = order
                        .into_iter()
                        .filter_map(|emoji| map.remove(&emoji).map(|(count, user_ids)| ReactionInfo { emoji, count, user_ids }))
                        .collect();
                }
            }
        }

        // Batch load DM embeds
        {
            use jolkr_db::repo::EmbedRepo;
            let all_embeds = match EmbedRepo::list_for_dm_messages(pool, &msg_ids).await {
                Ok(embeds) => embeds,
                Err(e) => {
                    warn!(error = %e, "Failed to load DM embeds");
                    Vec::new()
                }
            };
            use std::collections::HashMap;
            let mut by_msg: HashMap<Uuid, Vec<EmbedInfo>> = HashMap::new();
            for e in all_embeds {
                by_msg.entry(e.dm_message_id).or_default().push(EmbedInfo {
                    url: e.url,
                    title: e.title,
                    description: e.description,
                    image_url: e.image_url,
                    site_name: e.site_name,
                    color: e.color,
                });
            }
            for msg in &mut messages {
                if let Some(embeds) = by_msg.remove(&msg.id) {
                    msg.embeds = embeds;
                }
            }
        }

        Ok(messages)
    }

    // ── Enrichment helper ──────────────────────────────────────────

    /// Enrich DM messages with reactions, attachments, and embeds.
    async fn enrich_dm_messages(pool: &PgPool, messages: &mut Vec<DmMessageInfo>) -> Result<(), JolkrError> {
        if messages.is_empty() { return Ok(()); }

        let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();

        // Attachments
        let all_atts = DmRepo::list_attachments_for_messages(pool, &msg_ids).await.unwrap_or_default();
        for att in all_atts {
            if let Some(msg) = messages.iter_mut().find(|m| m.id == att.dm_message_id) {
                msg.attachments.push(AttachmentInfo {
                    id: att.id,
                    filename: att.filename,
                    content_type: att.content_type,
                    size_bytes: att.size_bytes,
                    url: attachment_proxy_url(att.id),
                });
            }
        }

        // Reactions (preserving order by first created_at — DB returns ORDER BY created_at ASC)
        let all_reactions = DmRepo::list_reactions_for_messages(pool, &msg_ids).await.unwrap_or_default();
        {
            use std::collections::HashMap;
            // Track per-message: emoji insertion order + aggregated data
            let mut by_msg: HashMap<Uuid, (Vec<String>, HashMap<String, (i64, Vec<Uuid>)>)> = HashMap::new();
            for r in all_reactions {
                let (order, map) = by_msg.entry(r.dm_message_id).or_insert_with(|| (Vec::new(), HashMap::new()));
                if !map.contains_key(&r.emoji) {
                    order.push(r.emoji.clone());
                }
                let emoji_entry = map.entry(r.emoji).or_insert((0, Vec::new()));
                emoji_entry.0 += 1;
                emoji_entry.1.push(r.user_id);
            }
            for msg in messages.iter_mut() {
                if let Some((order, mut map)) = by_msg.remove(&msg.id) {
                    msg.reactions = order
                        .into_iter()
                        .filter_map(|emoji| map.remove(&emoji).map(|(count, user_ids)| ReactionInfo { emoji, count, user_ids }))
                        .collect();
                }
            }
        }

        // Embeds
        {
            use jolkr_db::repo::EmbedRepo;
            use std::collections::HashMap;
            let all_embeds = EmbedRepo::list_for_dm_messages(pool, &msg_ids).await.unwrap_or_default();
            let mut by_msg: HashMap<Uuid, Vec<EmbedInfo>> = HashMap::new();
            for e in all_embeds {
                by_msg.entry(e.dm_message_id).or_default().push(EmbedInfo {
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
        }

        Ok(())
    }

    // ── Pins ─────────────────────────────────────────────────────────

    /// Pin a message in a DM channel.
    pub async fn pin_message(
        pool: &PgPool,
        dm_channel_id: Uuid,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<DmMessageInfo, JolkrError> {
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }
        let msg = DmRepo::get_message(pool, message_id).await?;
        if msg.dm_channel_id != dm_channel_id {
            return Err(JolkrError::BadRequest("Message does not belong to this DM channel".into()));
        }

        DmRepo::pin_message(pool, dm_channel_id, message_id, caller_id).await?;

        // Re-fetch and enrich with reactions/attachments/embeds
        let row = DmRepo::get_message(pool, message_id).await?;
        let mut msgs = vec![DmMessageInfo::from(row)];
        Self::enrich_dm_messages(pool, &mut msgs).await?;
        Ok(msgs.into_iter().next().unwrap())
    }

    /// Unpin a message in a DM channel.
    pub async fn unpin_message(
        pool: &PgPool,
        dm_channel_id: Uuid,
        message_id: Uuid,
        caller_id: Uuid,
    ) -> Result<DmMessageInfo, JolkrError> {
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }

        DmRepo::unpin_message(pool, dm_channel_id, message_id).await?;

        // Re-fetch and enrich with reactions/attachments/embeds
        let row = DmRepo::get_message(pool, message_id).await?;
        let mut msgs = vec![DmMessageInfo::from(row)];
        Self::enrich_dm_messages(pool, &mut msgs).await?;
        Ok(msgs.into_iter().next().unwrap())
    }

    /// List pinned messages in a DM channel (enriched with attachments, reactions, embeds).
    pub async fn list_pinned(
        pool: &PgPool,
        dm_channel_id: Uuid,
        caller_id: Uuid,
    ) -> Result<Vec<DmMessageInfo>, JolkrError> {
        if !DmRepo::is_member(pool, dm_channel_id, caller_id).await? {
            return Err(JolkrError::Forbidden);
        }

        let rows = DmRepo::list_pinned(pool, dm_channel_id).await?;
        let mut messages: Vec<DmMessageInfo> = rows.into_iter().map(DmMessageInfo::from).collect();
        Self::enrich_dm_messages(pool, &mut messages).await?;
        Ok(messages)
    }
}
