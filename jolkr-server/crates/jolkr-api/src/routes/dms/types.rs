use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::services::dm::{DmChannelInfo, DmMessageInfo};
use jolkr_core::services::message::MessageInfo;

#[derive(Serialize)]
pub struct DmChannelResponse {
    pub channel: DmChannelInfo,
}

#[derive(Serialize)]
pub struct DmChannelsResponse {
    pub channels: Vec<DmChannelInfo>,
}

#[derive(Serialize)]
pub struct DmMessageResponse {
    pub message: DmMessageInfo,
}

#[derive(Serialize)]
pub struct DmMessagesResponse {
    pub messages: Vec<DmMessageInfo>,
}

/// Accept either `{ "user_id": "..." }` for 1-on-1 or `{ "user_ids": [...], "name"?: "..." }` for group DM.
#[derive(Deserialize)]
#[serde(untagged)]
pub enum CreateDmRequest {
    Group { user_ids: Vec<Uuid>, name: Option<String> },
    OneOnOne { user_id: Uuid },
}

pub fn dm_to_message_info(msg: &DmMessageInfo) -> MessageInfo {
    MessageInfo {
        id: msg.id,
        channel_id: msg.dm_channel_id,
        author_id: msg.author_id,
        content: msg.content.clone(),
        nonce: msg.nonce.clone(),
        is_edited: msg.is_edited,
        is_pinned: msg.is_pinned,
        reply_to_id: msg.reply_to_id,
        thread_id: None,
        thread_reply_count: None,
        attachments: msg.attachments.clone(),
        reactions: msg.reactions.clone(),
        embeds: msg.embeds.clone(),
        webhook_id: None,
        webhook_name: None,
        webhook_avatar: None,
        poll: None,
        created_at: msg.created_at,
        updated_at: msg.updated_at,
    }
}
