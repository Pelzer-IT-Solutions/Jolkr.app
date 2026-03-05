use serde::{Deserialize, Serialize};

/// Bitfield-based permissions, inspired by Discord's permission model.
///
/// Each permission is a single bit in a `u64`. Combine them with `|` and check
/// them with `has()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Permissions(pub u64);

// ── Permission flag constants ──────────────────────────────────────────

impl Permissions {
    // General
    pub const NONE: u64 = 0;
    pub const ADMINISTRATOR: u64 = 1 << 0;
    pub const VIEW_CHANNELS: u64 = 1 << 1;
    pub const MANAGE_CHANNELS: u64 = 1 << 2;
    pub const MANAGE_ROLES: u64 = 1 << 3;
    pub const MANAGE_SERVER: u64 = 1 << 4;

    // Membership
    pub const KICK_MEMBERS: u64 = 1 << 5;
    pub const BAN_MEMBERS: u64 = 1 << 6;
    pub const CREATE_INVITE: u64 = 1 << 7;
    pub const CHANGE_NICKNAME: u64 = 1 << 8;
    pub const MANAGE_NICKNAMES: u64 = 1 << 9;

    // Text
    pub const SEND_MESSAGES: u64 = 1 << 10;
    pub const EMBED_LINKS: u64 = 1 << 11;
    pub const ATTACH_FILES: u64 = 1 << 12;
    pub const ADD_REACTIONS: u64 = 1 << 13;
    pub const MENTION_EVERYONE: u64 = 1 << 14;
    pub const MANAGE_MESSAGES: u64 = 1 << 15;
    pub const READ_MESSAGE_HISTORY: u64 = 1 << 16;
    pub const USE_EXTERNAL_EMOJIS: u64 = 1 << 17;
    pub const SEND_TTS_MESSAGES: u64 = 1 << 18;

    // Voice
    pub const CONNECT: u64 = 1 << 20;
    pub const SPEAK: u64 = 1 << 21;
    pub const VIDEO: u64 = 1 << 22;
    pub const MUTE_MEMBERS: u64 = 1 << 23;
    pub const DEAFEN_MEMBERS: u64 = 1 << 24;
    pub const MOVE_MEMBERS: u64 = 1 << 25;
    pub const USE_VOICE_ACTIVITY: u64 = 1 << 26;
    pub const PRIORITY_SPEAKER: u64 = 1 << 27;

    // Moderation (extended)
    pub const MODERATE_MEMBERS: u64 = 1 << 28;
    pub const MANAGE_WEBHOOKS: u64 = 1 << 29;

    /// Default permissions granted to @everyone role.
    pub const DEFAULT: u64 = Self::VIEW_CHANNELS
        | Self::SEND_MESSAGES
        | Self::READ_MESSAGE_HISTORY
        | Self::EMBED_LINKS
        | Self::ATTACH_FILES
        | Self::ADD_REACTIONS
        | Self::USE_EXTERNAL_EMOJIS
        | Self::CONNECT
        | Self::SPEAK
        | Self::VIDEO
        | Self::USE_VOICE_ACTIVITY
        | Self::CHANGE_NICKNAME
        | Self::CREATE_INVITE;

    /// All permissions combined.
    pub const ALL: u64 = u64::MAX;
}

// ── Methods ────────────────────────────────────────────────────────────

impl Permissions {
    /// Create an empty permission set.
    pub fn empty() -> Self {
        Self(Self::NONE)
    }

    /// Create a permission set with the default @everyone permissions.
    pub fn default_everyone() -> Self {
        Self(Self::DEFAULT)
    }

    /// Check whether a specific permission flag (or flags) is/are set.
    /// If the user has ADMINISTRATOR, every check returns true.
    pub fn has(&self, permission: u64) -> bool {
        if self.0 & Self::ADMINISTRATOR != 0 {
            return true;
        }
        self.0 & permission == permission
    }

    /// Add one or more permission flags.
    pub fn add(&mut self, permission: u64) {
        self.0 |= permission;
    }

    /// Remove one or more permission flags.
    pub fn remove(&mut self, permission: u64) {
        self.0 &= !permission;
    }

    /// Merge another permission set into this one (union).
    pub fn merge(&mut self, other: Permissions) {
        self.0 |= other.0;
    }

    /// Returns the raw `u64` value.
    pub fn bits(&self) -> u64 {
        self.0
    }
}

impl Default for Permissions {
    fn default() -> Self {
        Self::empty()
    }
}

impl From<u64> for Permissions {
    fn from(v: u64) -> Self {
        Self(v)
    }
}

impl From<i64> for Permissions {
    fn from(v: i64) -> Self {
        Self(v as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_single_permission() {
        let perms = Permissions(Permissions::SEND_MESSAGES);
        assert!(perms.has(Permissions::SEND_MESSAGES));
        assert!(!perms.has(Permissions::MANAGE_CHANNELS));
    }

    #[test]
    fn test_administrator_bypasses_all() {
        let perms = Permissions(Permissions::ADMINISTRATOR);
        assert!(perms.has(Permissions::SEND_MESSAGES));
        assert!(perms.has(Permissions::BAN_MEMBERS));
        assert!(perms.has(Permissions::MANAGE_SERVER));
    }

    #[test]
    fn test_add_remove() {
        let mut perms = Permissions::empty();
        perms.add(Permissions::SEND_MESSAGES);
        assert!(perms.has(Permissions::SEND_MESSAGES));

        perms.remove(Permissions::SEND_MESSAGES);
        assert!(!perms.has(Permissions::SEND_MESSAGES));
    }

    #[test]
    fn test_merge() {
        let mut a = Permissions(Permissions::SEND_MESSAGES);
        let b = Permissions(Permissions::MANAGE_CHANNELS);
        a.merge(b);
        assert!(a.has(Permissions::SEND_MESSAGES));
        assert!(a.has(Permissions::MANAGE_CHANNELS));
    }
}
