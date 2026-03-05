use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use jolkr_common::JolkrError;
use jolkr_db::models::DmMessageRow;
use jolkr_db::repo::{DmRepo, UserRepo};

use super::message::{AttachmentInfo, EmbedInfo, ReactionInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmChannelInfo {
    pub id: Uuid,
    pub is_group: bool,
    pub name: Option<String>,
    pub members: Vec<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmMessageInfo {
    pub id: Uuid,
    pub dm_channel_id: Uuid,
    pub author_id: Uuid,
    pub content: Option<String>,
    pub encrypted_content: Option<String>,
    pub nonce: Option<String>,
    pub is_edited: bool,
    pub reply_to_id: Option<Uuid>,
    pub attachments: Vec<AttachmentInfo>,
    #[serde(default)]
    pub reactions: Vec<ReactionInfo>,
    #[serde(default)]
    pub embeds: Vec<EmbedInfo>,
    pub created_at: DateTime<Utc>,
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
            encrypted_content: row.encrypted_content.map(|b| engine.encode(&b)),
            nonce: row.nonce.map(|b| engine.encode(&b)),
            is_edited: row.is_edited,
            reply_to_id: row.reply_to_id,
            attachments: Vec::new(),
            reactions: Vec::new(),
            embeds: Vec::new(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SendDmRequest {
    pub content: Option<String>,
    pub encrypted_content: Option<String>,
    pub nonce: Option<String>,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct EditDmRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct DmMessageQuery {
    pub before: Option<DateTime<Utc>>,
    pub limit: Option<i64>,
}

/// Maximum DM message content length (4000 characters).
const MAX_DM_MESSAGE_LENGTH: usize = 4000;

/// Maximum number of members in a group DM.
const MAX_GROUP_DM_MEMBERS: usize = 10;

/// Maximum length of a group DM name.
const MAX_GROUP_NAME_LENGTH: usize = 100;

#[derive(Debug, Deserialize)]
pub struct CreateGroupDmRequest {
    pub user_ids: Vec<Uuid>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct UpdateGroupDmRequest {
    pub name: Option<String>,
}

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

        let channel = DmRepo::get_or_create_dm(pool, caller_id, target_user_id).await?;
        let members = DmRepo::get_dm_members(pool, channel.id).await?;
        let member_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();

        Ok(DmChannelInfo {
            id: channel.id,
            is_group: channel.is_group,
            name: channel.name,
            members: member_ids,
            created_at: channel.created_at,
        })
    }

    /// List all DM channels for the caller (batch loads members).
    pub async fn list_dms(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<DmChannelInfo>, JolkrError> {
        let channels = DmRepo::list_dm_channels(pool, user_id).await?;

        // Batch load all members in one query
        let channel_ids: Vec<Uuid> = channels.iter().map(|ch| ch.id).collect();
        let all_members = DmRepo::get_members_for_channels(pool, &channel_ids).await?;

        let result = channels
            .into_iter()
            .map(|ch| {
                let member_ids: Vec<Uuid> = all_members
                    .iter()
                    .filter(|m| m.dm_channel_id == ch.id)
                    .map(|m| m.user_id)
                    .collect();
                DmChannelInfo {
                    id: ch.id,
                    is_group: ch.is_group,
                    name: ch.name,
                    members: member_ids,
                    created_at: ch.created_at,
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
        let name = req.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if let Some(ref name) = name {
            if name.len() > MAX_GROUP_NAME_LENGTH {
                return Err(JolkrError::Validation(
                    format!("Group name cannot exceed {MAX_GROUP_NAME_LENGTH} characters"),
                ));
            }
        }

        // Verify all users exist
        for &uid in &member_ids {
            UserRepo::get_by_id(pool, uid).await?;
        }

        let channel = DmRepo::create_group_dm(pool, name.as_deref(), &member_ids).await?;

        Ok(DmChannelInfo {
            id: channel.id,
            is_group: true,
            name: channel.name,
            members: member_ids,
            created_at: channel.created_at,
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
        let name = req.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
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
        })
    }

    /// Send a message in a DM channel.
    pub async fn send_message(
        pool: &PgPool,
        dm_channel_id: Uuid,
        author_id: Uuid,
        req: SendDmRequest,
    ) -> Result<DmMessageInfo, JolkrError> {
        if req.content.is_none() && req.encrypted_content.is_none() {
            return Err(JolkrError::Validation(
                "Message must have content or encrypted_content".into(),
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

        // Validate reply_to_id belongs to the same DM channel
        if let Some(reply_id) = req.reply_to_id {
            let reply_msg = DmRepo::get_message(pool, reply_id).await?;
            if reply_msg.dm_channel_id != dm_channel_id {
                return Err(JolkrError::BadRequest(
                    "Cannot reply to a message from a different conversation".into(),
                ));
            }
        }

        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let encrypted = req.encrypted_content.as_deref()
            .map(|s| engine.decode(s))
            .transpose()
            .map_err(|_| JolkrError::Validation("Invalid base64 for encrypted_content".into()))?;
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
            encrypted.as_deref(),
            nonce.as_deref(),
            req.reply_to_id,
        )
        .await?;

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

        let content = req.content.trim().to_string();
        if content.is_empty() {
            return Err(JolkrError::Validation("Message content cannot be empty".into()));
        }
        if content.len() > MAX_DM_MESSAGE_LENGTH {
            return Err(JolkrError::Validation(
                format!("Message content exceeds {MAX_DM_MESSAGE_LENGTH} characters"),
            ));
        }

        let row = DmRepo::update_message(pool, message_id, &content).await?;
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
        let rows = DmRepo::get_messages(pool, dm_channel_id, query.before, limit).await?;
        let mut messages: Vec<DmMessageInfo> = rows.into_iter().map(DmMessageInfo::from).collect();

        // Batch load all attachments in one query
        let msg_ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
        let all_atts = DmRepo::list_attachments_for_messages(pool, &msg_ids).await.unwrap_or_default();
        for att in all_atts {
            if let Some(msg) = messages.iter_mut().find(|m| m.id == att.dm_message_id) {
                msg.attachments.push(AttachmentInfo {
                    id: att.id,
                    filename: att.filename,
                    content_type: att.content_type,
                    size_bytes: att.size_bytes,
                    url: att.url,
                });
            }
        }

        // Batch load all reactions in one query
        let all_reactions = DmRepo::list_reactions_for_messages(pool, &msg_ids).await.unwrap_or_default();
        {
            use std::collections::HashMap;
            let mut by_msg: HashMap<Uuid, HashMap<String, (i64, Vec<Uuid>)>> = HashMap::new();
            for r in all_reactions {
                let entry = by_msg.entry(r.dm_message_id).or_default();
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
        }

        // Batch load DM embeds
        {
            use jolkr_db::repo::EmbedRepo;
            let all_embeds = EmbedRepo::list_for_dm_messages(pool, &msg_ids).await.unwrap_or_default();
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
            for msg in messages.iter_mut() {
                if let Some(embeds) = by_msg.remove(&msg.id) {
                    msg.embeds = embeds;
                }
            }
        }

        Ok(messages)
    }
}
