use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Strongly-typed user identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct UserId(pub Uuid);

/// Strongly-typed server identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ServerId(pub Uuid);

/// Strongly-typed channel identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ChannelId(pub Uuid);

/// Strongly-typed message identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MessageId(pub Uuid);

/// Strongly-typed device identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceId(pub Uuid);

/// Strongly-typed role identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RoleId(pub Uuid);

/// Strongly-typed invite identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct InviteId(pub Uuid);

/// UTC timestamp alias.
pub type Timestamp = DateTime<Utc>;

// ── Constructor helpers ────────────────────────────────────────────────

impl UserId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for UserId {
    fn default() -> Self {
        Self::new()
    }
}

impl ServerId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for ServerId {
    fn default() -> Self {
        Self::new()
    }
}

impl ChannelId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for ChannelId {
    fn default() -> Self {
        Self::new()
    }
}

impl MessageId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for MessageId {
    fn default() -> Self {
        Self::new()
    }
}

impl DeviceId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for DeviceId {
    fn default() -> Self {
        Self::new()
    }
}

impl RoleId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for RoleId {
    fn default() -> Self {
        Self::new()
    }
}

impl InviteId {
    /// Creates a new instance.
    #[must_use] 
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Wraps an existing UUID into the strongly-typed identifier.
    #[must_use] 
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl Default for InviteId {
    fn default() -> Self {
        Self::new()
    }
}

// ── Display impls (delegates to inner Uuid) ────────────────────────────

macro_rules! impl_display {
    ($($t:ty),+) => {
        $(
            impl core::fmt::Display for $t {
                fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                    write!(f, "{}", self.0)
                }
            }
        )+
    };
}

impl_display!(UserId, ServerId, ChannelId, MessageId, DeviceId, RoleId, InviteId);

/// Channel kinds mirror Discord-like categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "channel_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    /// `Text` variant.
    Text,
    /// `Voice` variant.
    Voice,
    /// `Announcement` variant.
    Announcement,
    /// `Category` variant.
    Category,
}

/// Friendship status between two users.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "friendship_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum FriendshipStatus {
    /// `Pending` variant.
    Pending,
    /// `Accepted` variant.
    Accepted,
    /// `Blocked` variant.
    Blocked,
}
