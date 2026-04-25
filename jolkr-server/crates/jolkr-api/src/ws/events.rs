use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::services::category::CategoryInfo;
use jolkr_core::services::channel::ChannelInfo;
use jolkr_core::services::dm::DmChannelInfo;
use jolkr_core::services::message::MessageInfo;
use jolkr_core::services::server::ServerInfo;
use jolkr_core::services::thread::ThreadInfo;

/// Events sent FROM the client TO the server over the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", content = "d")]
pub(crate) enum ClientEvent {
    /// First message after connecting; includes the access token.
    Identify {
        token: String,
    },

    /// Periodic heartbeat to keep the connection alive.
    Heartbeat {
        seq: u64,
    },

    /// Subscribe to events from a specific channel.
    Subscribe {
        channel_id: Uuid,
    },

    /// Unsubscribe from a channel's events.
    Unsubscribe {
        channel_id: Uuid,
    },

    /// Request to start typing indicator.
    TypingStart {
        channel_id: Uuid,
    },

    /// Update the user's presence status.
    PresenceUpdate {
        status: String, // "online", "idle", "dnd", "offline"
    },
}

/// Events sent FROM the server TO the client over the WebSocket.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", content = "d")]
pub enum GatewayEvent {
    /// Sent after a successful Identify; confirms the session is ready.
    Ready {
        user_id: Uuid,
        session_id: Uuid,
    },

    /// Heartbeat acknowledgment.
    HeartbeatAck {
        seq: u64,
    },

    /// A new message was created.
    MessageCreate {
        message: MessageInfo,
    },

    /// A message was edited.
    MessageUpdate {
        message: MessageInfo,
    },

    /// A message was deleted.
    MessageDelete {
        message_id: Uuid,
        channel_id: Uuid,
    },

    /// Someone started typing.
    TypingStart {
        channel_id: Uuid,
        user_id: Uuid,
        timestamp: i64,
    },

    /// A user's presence changed.
    PresenceUpdate {
        user_id: Uuid,
        status: String,
    },

    /// A new DM channel was created (group DM).
    DmCreate {
        channel: DmChannelInfo,
    },

    /// A DM channel was updated (member added/removed, name changed).
    DmUpdate {
        channel: DmChannelInfo,
    },

    /// A new thread was created.
    ThreadCreate {
        thread: ThreadInfo,
    },

    /// A thread was updated (name changed, archived).
    ThreadUpdate {
        thread: ThreadInfo,
    },

    /// A channel was created in a server.
    ChannelCreate {
        channel: ChannelInfo,
    },

    /// A channel was updated.
    ChannelUpdate {
        channel: ChannelInfo,
    },

    /// A channel was deleted.
    ChannelDelete {
        channel_id: Uuid,
        server_id: Uuid,
    },

    /// A category was created in a server.
    CategoryCreate {
        category: CategoryInfo,
    },

    /// A category was updated.
    CategoryUpdate {
        category: CategoryInfo,
    },

    /// A category was deleted.
    CategoryDelete {
        category_id: Uuid,
        server_id: Uuid,
    },

    /// A member joined a server.
    MemberJoin {
        server_id: Uuid,
        user_id: Uuid,
    },

    /// A member left/was kicked/banned from a server.
    MemberLeave {
        server_id: Uuid,
        user_id: Uuid,
    },

    /// A server was updated.
    ServerUpdate {
        server: ServerInfo,
    },

    /// A server was deleted.
    ServerDelete {
        server_id: Uuid,
    },

    /// A member was updated (timeout, etc).
    MemberUpdate {
        server_id: Uuid,
        user_id: Uuid,
        timeout_until: Option<String>,
    },

    /// Reactions on a message were updated.
    ReactionUpdate {
        channel_id: Uuid,
        message_id: Uuid,
        reactions: Vec<jolkr_core::services::message::ReactionInfo>,
    },

    /// A poll was updated (new vote).
    PollUpdate {
        poll: serde_json::Value,
        channel_id: Uuid,
        message_id: Uuid,
    },

    /// A DM call is ringing (sent to the recipient).
    DmCallRing {
        dm_id: Uuid,
        caller_id: Uuid,
        caller_username: String,
    },

    /// A DM call was accepted.
    DmCallAccept {
        dm_id: Uuid,
        user_id: Uuid,
    },

    /// A DM call was rejected.
    DmCallReject {
        dm_id: Uuid,
        user_id: Uuid,
    },

    /// A DM call was ended.
    DmCallEnd {
        dm_id: Uuid,
        user_id: Uuid,
    },

    /// A user has read messages up to a specific message in a DM.
    DmMessagesRead {
        dm_id: Uuid,
        user_id: Uuid,
        message_id: Uuid,
    },

    /// A user has read messages up to a specific message in a channel.
    ChannelMessagesRead {
        channel_id: Uuid,
        user_id: Uuid,
        message_id: Uuid,
    },

    /// A user has marked all channels in a server as read.
    ServerMessagesRead {
        server_id: Uuid,
        user_id: Uuid,
    },

    /// A user's profile was updated (status, display name, etc).
    UserUpdate {
        user_id: Uuid,
        status: Option<String>,
        display_name: Option<String>,
        avatar_url: Option<String>,
        bio: Option<String>,
    },

    /// Generic error event.
    Error {
        message: String,
    },
}
