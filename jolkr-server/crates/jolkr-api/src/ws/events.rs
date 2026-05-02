use serde::{Deserialize, Serialize};
use uuid::Uuid;

use jolkr_core::services::category::CategoryInfo;
use jolkr_core::services::channel::ChannelInfo;
use jolkr_core::services::dm::DmChannelInfo;
use jolkr_core::services::friendship::FriendshipInfo;
use jolkr_core::services::message::MessageInfo;
use jolkr_core::services::server::ServerInfo;
use jolkr_core::services::thread::ThreadInfo;

use crate::routes::gifs::FavoriteItem;

/// Type of friendship state change carried by `GatewayEvent::FriendshipUpdate`.
/// Lets clients decide which list (incoming/outgoing/friends) the update
/// belongs in without re-deriving it from the friendship status.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum FriendshipUpdateKind {
    Created,
    Accepted,
    Declined,
    Removed,
    Blocked,
}

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

    /// A DM channel was closed (hidden) for the receiving user. Sent to all
    /// of the closer's sessions so sibling clients hide the DM from the list.
    /// Other DM members receive a `DmUpdate` with the closer removed instead.
    DmClose {
        dm_id: Uuid,
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
        /// `true` if the caller is starting a video call, `false` for voice-only.
        is_video: bool,
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

    /// A user's email has been verified. Fired to all sessions of the user
    /// (incl. the one that initiated the verification flow) so any pending
    /// "verify your email" UI can refresh the user object and unblock.
    EmailVerified {
        user_id: Uuid,
    },

    /// A GIF favorite was added or removed in one of the user's sessions.
    /// Sent only to the user's own user-channel so all their sessions sync.
    GifFavoriteUpdate {
        /// Populated when the change is an add. None means a remove.
        added: Option<FavoriteItem>,
        /// Populated when the change is a remove. None means an add.
        removed_gif_id: Option<String>,
    },

    /// Sync the user's call participation across their open sessions.
    /// Sent only to the user's own user-channel so sibling sessions can show
    /// an "On a call" indicator. Both `dm_id` and `channel_id` are mutually
    /// exclusive — at most one is `Some`. When both are `None`, the user is
    /// no longer in a call (left, ended, or rejected an incoming ring).
    UserCallPresence {
        /// DM call room id (mutually exclusive with `channel_id`).
        dm_id: Option<Uuid>,
        /// Server voice channel id (mutually exclusive with `dm_id`).
        channel_id: Option<Uuid>,
        is_video: Option<bool>,
    },

    /// A friendship state changed for one of the participants. Sent to both
    /// parties so their friends panels can refresh. `kind` indicates the
    /// type of change so clients can decide which list (incoming/outgoing/
    /// friends) the update belongs in.
    FriendshipUpdate {
        friendship: FriendshipInfo,
        kind: FriendshipUpdateKind,
    },

    /// A per-target notification setting (mute, suppress @everyone) was
    /// changed. Sent to the user's own user-channel so sibling sessions
    /// reflect the new state without polling. `setting: None` means the
    /// row was deleted (defaults restored).
    NotificationSettingUpdate {
        target_type: String,
        target_id: Uuid,
        setting: Option<NotificationSettingPayload>,
    },

    /// Generic error event.
    Error {
        message: String,
    },
}

/// Payload mirror of `NotificationSettingResponse` from the REST API,
/// inlined here so the WS layer doesn't depend on the routes module.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NotificationSettingPayload {
    pub muted: bool,
    pub mute_until: Option<chrono::DateTime<chrono::Utc>>,
    pub suppress_everyone: bool,
}
