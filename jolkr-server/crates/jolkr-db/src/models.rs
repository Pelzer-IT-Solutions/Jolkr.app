use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ── Users & Auth ───────────────────────────────────────────────────────

/// Database row for `user`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Email address.
    pub email: String,
    /// Login username.
    pub username: String,
    /// Optional display name shown in the UI.
    pub display_name: Option<String>,
    /// Avatar image URL.
    pub avatar_url: Option<String>,
    /// Argon2 password hash.
    #[serde(skip_serializing)]
    pub password_hash: String,
    /// Current status.
    pub status: Option<String>,
    /// Bio.
    pub bio: Option<String>,
    /// Whether the user is currently online.
    pub is_online: bool,
    /// Last seen timestamp.
    pub last_seen_at: Option<DateTime<Utc>>,
    /// Show read receipts.
    pub show_read_receipts: bool,
    /// Whether this is a system-generated entity.
    pub is_system: bool,
    /// Email verified.
    pub email_verified: bool,
    /// Banner color.
    pub banner_color: Option<String>,
    /// Privacy: who can start a new DM with this user (`all` | `friends` | `none`).
    pub dm_filter: String,
    /// Privacy: whether others can send friend requests to this user.
    pub allow_friend_requests: bool,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// Database row for `device`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DeviceRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Device name.
    pub device_name: String,
    /// Device type.
    pub device_type: String,
    /// Push token.
    pub push_token: Option<String>,
    /// Last active timestamp.
    pub last_active_at: Option<DateTime<Utc>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `session`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SessionRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Device identifier.
    pub device_id: Option<Uuid>,
    /// Refresh token hash.
    pub refresh_token_hash: String,
    /// Expiration timestamp.
    pub expires_at: DateTime<Utc>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Servers ────────────────────────────────────────────────────────────

/// Database row for `server`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// Description text.
    pub description: Option<String>,
    /// Icon image URL.
    pub icon_url: Option<String>,
    /// Banner image URL.
    pub banner_url: Option<String>,
    /// Owner identifier.
    pub owner_id: Uuid,
    /// Whether this entry is publicly visible.
    pub is_public: bool,
    /// Theme.
    pub theme: Option<serde_json::Value>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// Database row for `category`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CategoryRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Display name.
    pub name: String,
    /// Sort position.
    pub position: i32,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `channel`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Owning category identifier.
    pub category_id: Option<Uuid>,
    /// Display name.
    pub name: String,
    /// Topic.
    pub topic: Option<String>,
    /// Discriminator describing the variant.
    pub kind: String,
    /// Sort position.
    pub position: i32,
    /// Whether nsfw.
    pub is_nsfw: bool,
    /// Slowmode seconds.
    pub slowmode_seconds: i32,
    /// Active E2EE key rotation generation.
    pub e2ee_key_generation: i32,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// Database row for `member`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MemberRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Nickname.
    pub nickname: Option<String>,
    /// Join timestamp.
    pub joined_at: DateTime<Utc>,
    /// Timestamp until which the user is timed out.
    pub timeout_until: Option<DateTime<Utc>>,
    /// Server position.
    pub server_position: i32,
}

/// Database row for `role`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoleRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Display name.
    pub name: String,
    /// Color value (RGB).
    pub color: i32,
    /// Sort position.
    pub position: i32,
    /// Permission bitmask.
    pub permissions: i64,
    /// Whether this is the default entry.
    pub is_default: bool,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `invite`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InviteRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Creator user identifier.
    pub creator_id: Uuid,
    /// Status or error code.
    pub code: String,
    /// Maximum allowed uses (None = unlimited).
    pub max_uses: Option<i32>,
    /// Number of times this entry has been used.
    pub use_count: i32,
    /// Expiration timestamp.
    pub expires_at: Option<DateTime<Utc>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Bans ───────────────────────────────────────────────────────────────

/// Database row for `ban`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BanRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Identifier of the user who issued the ban.
    pub banned_by: Option<Uuid>,
    /// Reason text.
    pub reason: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Channel Permission Overwrites ──────────────────────────────────────

/// Database row for `channeloverwrite`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelOverwriteRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Target type.
    pub target_type: String,
    /// Target identifier.
    pub target_id: Uuid,
    /// Allow.
    pub allow: i64,
    /// Deny.
    pub deny: i64,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

// ── Threads ───────────────────────────────────────────────────────────

/// Database row for `thread`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ThreadRow {
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
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

// ── Messages ───────────────────────────────────────────────────────────

/// Database row for `message`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Author user identifier.
    pub author_id: Uuid,
    /// Message content (may be encrypted).
    pub content: Option<String>,
    /// Encryption nonce when content is encrypted.
    pub nonce: Option<Vec<u8>>,
    /// Whether the message has been edited.
    pub is_edited: bool,
    /// Whether the message is pinned.
    pub is_pinned: bool,
    /// Reply to identifier.
    pub reply_to_id: Option<Uuid>,
    /// Owning thread identifier.
    pub thread_id: Option<Uuid>,
    /// Webhook identifier.
    pub webhook_id: Option<Uuid>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// Database row for `attachment`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AttachmentRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// File name.
    pub filename: String,
    /// Content type.
    pub content_type: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// Resource URL.
    pub url: String,
    /// Encrypted key.
    pub encrypted_key: Option<Vec<u8>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `reaction`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ReactionRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Emoji.
    pub emoji: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Pins ──────────────────────────────────────────────────────────────

/// Database row for `pin`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PinRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Pinned by.
    pub pinned_by: Uuid,
    /// Pinned timestamp.
    pub pinned_at: DateTime<Utc>,
}

// ── DMs ────────────────────────────────────────────────────────────────

/// Database row for `dmchannel`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmChannelRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Whether this is a group conversation.
    pub is_group: bool,
    /// Display name.
    pub name: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

/// Database row for `dmmember`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMemberRow {
    /// Unique identifier.
    pub id: Uuid,
    /// DM channel identifier.
    pub dm_channel_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Join timestamp.
    pub joined_at: DateTime<Utc>,
    /// Last read message identifier.
    pub last_read_message_id: Option<Uuid>,
    /// Closed timestamp.
    pub closed_at: Option<DateTime<Utc>>,
}

/// Database row for `dmmessage`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMessageRow {
    /// Unique identifier.
    pub id: Uuid,
    /// DM channel identifier.
    pub dm_channel_id: Uuid,
    /// Author user identifier.
    pub author_id: Uuid,
    /// Message content (may be encrypted).
    pub content: Option<String>,
    /// Encryption nonce when content is encrypted.
    pub nonce: Option<Vec<u8>>,
    /// Whether the message has been edited.
    pub is_edited: bool,
    /// Whether the message is pinned.
    pub is_pinned: bool,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Reply to identifier.
    pub reply_to_id: Option<Uuid>,
}

/// Database row for `dmpin`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmPinRow {
    /// Unique identifier.
    pub id: Uuid,
    /// DM channel identifier.
    pub dm_channel_id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Pinned by.
    pub pinned_by: Uuid,
    /// Pinned timestamp.
    pub pinned_at: DateTime<Utc>,
}

/// Database row for `dmattachment`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmAttachmentRow {
    /// Unique identifier.
    pub id: Uuid,
    /// DM message identifier.
    pub dm_message_id: Uuid,
    /// File name.
    pub filename: String,
    /// Content type.
    pub content_type: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// Resource URL.
    pub url: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `dmreaction`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmReactionRow {
    /// Unique identifier.
    pub id: Uuid,
    /// DM message identifier.
    pub dm_message_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Emoji.
    pub emoji: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Friendships ────────────────────────────────────────────────────────

/// Database row for `friendship`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FriendshipRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Requesting user identifier.
    pub requester_id: Uuid,
    /// Addressee user identifier.
    pub addressee_id: Uuid,
    /// Current status.
    pub status: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

// ── Password Reset Tokens ──────────────────────────────────────────────

/// Database row for `passwordreset`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PasswordResetRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// SHA-256 hash of the token.
    pub token_hash: String,
    /// Expiration timestamp.
    pub expires_at: DateTime<Utc>,
    /// Used timestamp.
    pub used_at: Option<DateTime<Utc>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Email Verification Tokens ──────────────────────────────────────────

/// Database row for `emailverification`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EmailVerificationRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// SHA-256 hash of the token.
    pub token_hash: String,
    /// Expiration timestamp.
    pub expires_at: DateTime<Utc>,
    /// Used timestamp.
    pub used_at: Option<DateTime<Utc>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Message Embeds ────────────────────────────────────────────────────

/// Database row for `messageembed`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageEmbedRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Resource URL.
    pub url: String,
    /// Title text.
    pub title: Option<String>,
    /// Description text.
    pub description: Option<String>,
    /// Image URL.
    pub image_url: Option<String>,
    /// Site name.
    pub site_name: Option<String>,
    /// Color value (RGB).
    pub color: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `dmmessageembed`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMessageEmbedRow {
    /// Unique identifier.
    pub id: Uuid,
    /// DM message identifier.
    pub dm_message_id: Uuid,
    /// Resource URL.
    pub url: String,
    /// Title text.
    pub title: Option<String>,
    /// Description text.
    pub description: Option<String>,
    /// Image URL.
    pub image_url: Option<String>,
    /// Site name.
    pub site_name: Option<String>,
    /// Color value (RGB).
    pub color: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Server Emojis ─────────────────────────────────────────────────────

/// Database row for `serveremoji`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerEmojiRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Display name.
    pub name: String,
    /// Image key.
    pub image_key: String,
    /// Uploader user identifier.
    pub uploader_id: Uuid,
    /// Whether the asset is animated.
    pub animated: bool,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Notification Settings ──────────────────────────────────────────────

/// Database row for `notificationsetting`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct NotificationSettingRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Target type.
    pub target_type: String,
    /// Target identifier.
    pub target_id: Uuid,
    /// Muted.
    pub muted: bool,
    /// Mute until.
    pub mute_until: Option<DateTime<Utc>>,
    /// Suppress everyone.
    pub suppress_everyone: bool,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

// ── Audit Log ─────────────────────────────────────────────────────────

/// Database row for `auditlog`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLogRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning server identifier.
    pub server_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Action type.
    pub action_type: String,
    /// Target identifier.
    pub target_id: Option<Uuid>,
    /// Target type.
    pub target_type: Option<String>,
    /// Changes.
    pub changes: Option<serde_json::Value>,
    /// Reason text.
    pub reason: Option<String>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Polls ──────────────────────────────────────────────────────────────

/// Database row for `poll`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PollRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Referenced message identifier.
    pub message_id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Question.
    pub question: String,
    /// Whether multiple options can be selected.
    pub multi_select: bool,
    /// Whether votes are anonymous.
    pub anonymous: bool,
    /// Expiration timestamp.
    pub expires_at: Option<DateTime<Utc>>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `polloption`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PollOptionRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Poll identifier.
    pub poll_id: Uuid,
    /// Sort position.
    pub position: i32,
    /// Text.
    pub text: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

/// Database row for `pollvote`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PollVoteRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Poll identifier.
    pub poll_id: Uuid,
    /// Option identifier.
    pub option_id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Webhooks ───────────────────────────────────────────────────────────

/// Database row for `webhook`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WebhookRow {
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
    /// SHA-256 hash of the token.
    pub token_hash: String,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Last-update timestamp.
    pub updated_at: DateTime<Utc>,
}

// ── E2EE Keys ──────────────────────────────────────────────────────────

/// Database row for `userkey`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserKeyRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning user identifier.
    pub user_id: Uuid,
    /// Device identifier.
    pub device_id: Uuid,
    /// Identity key.
    pub identity_key: Vec<u8>,
    /// Signed prekey.
    pub signed_prekey: Vec<u8>,
    /// Signed prekey signature.
    pub signed_prekey_signature: Vec<u8>,
    /// One time prekey.
    pub one_time_prekey: Option<Vec<u8>>,
    /// Pq signed prekey.
    pub pq_signed_prekey: Option<Vec<u8>>,
    /// Pq signed prekey signature.
    pub pq_signed_prekey_signature: Option<Vec<u8>>,
    /// Whether used.
    pub is_used: bool,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}

// ── Channel Encryption Keys ──────────────────────────────────────────

/// Database row for `channelencryptionkey`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelEncryptionKeyRow {
    /// Unique identifier.
    pub id: Uuid,
    /// Owning channel identifier.
    pub channel_id: Uuid,
    /// Recipient user identifier.
    pub recipient_user_id: Uuid,
    /// Encrypted key.
    pub encrypted_key: String,
    /// Encryption nonce when content is encrypted.
    pub nonce: String,
    /// Key rotation generation counter.
    pub key_generation: i32,
    /// Distributor user identifier.
    pub distributor_user_id: Uuid,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
}
