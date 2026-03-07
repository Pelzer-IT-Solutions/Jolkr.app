use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ── Users & Auth ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserRow {
    pub id: Uuid,
    pub email: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub status: Option<String>,
    pub bio: Option<String>,
    pub is_online: bool,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub show_read_receipts: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DeviceRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_name: String,
    pub device_type: String,
    pub push_token: Option<String>,
    pub last_active_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SessionRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_id: Option<Uuid>,
    pub refresh_token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

// ── Servers ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerRow {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub owner_id: Uuid,
    pub is_public: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CategoryRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub category_id: Option<Uuid>,
    pub name: String,
    pub topic: Option<String>,
    pub kind: String,
    pub position: i32,
    pub is_nsfw: bool,
    pub slowmode_seconds: i32,
    pub e2ee_key_generation: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MemberRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
    pub timeout_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RoleRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub color: i32,
    pub position: i32,
    pub permissions: i64,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InviteRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub creator_id: Uuid,
    pub code: String,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ── Bans ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct BanRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub banned_by: Option<Uuid>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Channel Permission Overwrites ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelOverwriteRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub allow: i64,
    pub deny: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Threads ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ThreadRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub starter_msg_id: Option<Uuid>,
    pub name: Option<String>,
    pub is_archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Messages ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Uuid,
    pub content: Option<String>,
    pub encrypted_content: Option<Vec<u8>>,
    pub nonce: Option<Vec<u8>>,
    pub is_edited: bool,
    pub is_pinned: bool,
    pub reply_to_id: Option<Uuid>,
    pub thread_id: Option<Uuid>,
    pub webhook_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AttachmentRow {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub url: String,
    pub encrypted_key: Option<Vec<u8>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ReactionRow {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji: String,
    pub created_at: DateTime<Utc>,
}

// ── Pins ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PinRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub message_id: Uuid,
    pub pinned_by: Uuid,
    pub pinned_at: DateTime<Utc>,
}

// ── DMs ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmChannelRow {
    pub id: Uuid,
    pub is_group: bool,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMemberRow {
    pub id: Uuid,
    pub dm_channel_id: Uuid,
    pub user_id: Uuid,
    pub joined_at: DateTime<Utc>,
    pub last_read_message_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMessageRow {
    pub id: Uuid,
    pub dm_channel_id: Uuid,
    pub author_id: Uuid,
    pub content: Option<String>,
    pub encrypted_content: Option<Vec<u8>>,
    pub nonce: Option<Vec<u8>>,
    pub is_edited: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub reply_to_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmAttachmentRow {
    pub id: Uuid,
    pub dm_message_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub url: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmReactionRow {
    pub id: Uuid,
    pub dm_message_id: Uuid,
    pub user_id: Uuid,
    pub emoji: String,
    pub created_at: DateTime<Utc>,
}

// ── Friendships ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct FriendshipRow {
    pub id: Uuid,
    pub requester_id: Uuid,
    pub addressee_id: Uuid,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Password Reset Tokens ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PasswordResetRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

// ── Message Embeds ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageEmbedRow {
    pub id: Uuid,
    pub message_id: Uuid,
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub color: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DmMessageEmbedRow {
    pub id: Uuid,
    pub dm_message_id: Uuid,
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub site_name: Option<String>,
    pub color: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Server Emojis ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ServerEmojiRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub image_key: String,
    pub uploader_id: Uuid,
    pub animated: bool,
    pub created_at: DateTime<Utc>,
}

// ── Notification Settings ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct NotificationSettingRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub target_type: String,
    pub target_id: Uuid,
    pub muted: bool,
    pub mute_until: Option<DateTime<Utc>>,
    pub suppress_everyone: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── Audit Log ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLogRow {
    pub id: Uuid,
    pub server_id: Uuid,
    pub user_id: Uuid,
    pub action_type: String,
    pub target_id: Option<Uuid>,
    pub target_type: Option<String>,
    pub changes: Option<serde_json::Value>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ── Polls ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PollRow {
    pub id: Uuid,
    pub message_id: Uuid,
    pub channel_id: Uuid,
    pub question: String,
    pub multi_select: bool,
    pub anonymous: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PollOptionRow {
    pub id: Uuid,
    pub poll_id: Uuid,
    pub position: i32,
    pub text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PollVoteRow {
    pub id: Uuid,
    pub poll_id: Uuid,
    pub option_id: Uuid,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
}

// ── Webhooks ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WebhookRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub server_id: Uuid,
    pub creator_id: Uuid,
    pub name: String,
    pub avatar_url: Option<String>,
    pub token: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ── E2EE Keys ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserKeyRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub identity_key: Vec<u8>,
    pub signed_prekey: Vec<u8>,
    pub signed_prekey_signature: Vec<u8>,
    pub one_time_prekey: Option<Vec<u8>>,
    pub pq_signed_prekey: Option<Vec<u8>>,
    pub pq_signed_prekey_signature: Option<Vec<u8>>,
    pub is_used: bool,
    pub created_at: DateTime<Utc>,
}

// ── Channel Encryption Keys ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChannelEncryptionKeyRow {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub recipient_user_id: Uuid,
    pub encrypted_key: String,
    pub nonce: String,
    pub key_generation: i32,
    pub distributor_user_id: Uuid,
    pub created_at: DateTime<Utc>,
}
