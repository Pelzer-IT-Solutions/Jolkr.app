/** Bitfield permission flags — mirrors backend jolkr_common::Permissions */

// General
export const ADMINISTRATOR = 1 << 0;
export const VIEW_CHANNELS = 1 << 1;
export const MANAGE_CHANNELS = 1 << 2;
export const MANAGE_ROLES = 1 << 3;
export const MANAGE_SERVER = 1 << 4;

// Membership
export const KICK_MEMBERS = 1 << 5;
export const BAN_MEMBERS = 1 << 6;
export const CREATE_INVITE = 1 << 7;
export const CHANGE_NICKNAME = 1 << 8;
export const MANAGE_NICKNAMES = 1 << 9;

// Text
export const SEND_MESSAGES = 1 << 10;
export const EMBED_LINKS = 1 << 11;
export const ATTACH_FILES = 1 << 12;
export const ADD_REACTIONS = 1 << 13;
export const MENTION_EVERYONE = 1 << 14;
export const MANAGE_MESSAGES = 1 << 15;
export const READ_MESSAGE_HISTORY = 1 << 16;

// Extended Moderation
export const MODERATE_MEMBERS = 1 << 28;
export const MANAGE_WEBHOOKS = 1 << 29;

// Voice
export const CONNECT = 1 << 20;
export const SPEAK = 1 << 21;
export const MUTE_MEMBERS = 1 << 23;
export const DEAFEN_MEMBERS = 1 << 24;
export const MOVE_MEMBERS = 1 << 25;

/** Check if a permissions bitfield has a specific permission. ADMINISTRATOR bypasses all. */
export function hasPermission(perms: number, permission: number): boolean {
  if ((perms & ADMINISTRATOR) !== 0) return true;
  return (perms & permission) === permission;
}

/** Channel-specific permission labels for channel overwrite editor */
export const CHANNEL_PERMISSION_LABELS: Array<{ key: string; flag: number; label: string; category: string }> = [
  { key: 'view_channels', flag: VIEW_CHANNELS, label: 'View Channel', category: 'General' },
  { key: 'manage_channels', flag: MANAGE_CHANNELS, label: 'Manage Channel', category: 'General' },
  { key: 'send_messages', flag: SEND_MESSAGES, label: 'Send Messages', category: 'Text' },
  { key: 'embed_links', flag: EMBED_LINKS, label: 'Embed Links', category: 'Text' },
  { key: 'attach_files', flag: ATTACH_FILES, label: 'Attach Files', category: 'Text' },
  { key: 'add_reactions', flag: ADD_REACTIONS, label: 'Add Reactions', category: 'Text' },
  { key: 'mention_everyone', flag: MENTION_EVERYONE, label: 'Mention Everyone', category: 'Text' },
  { key: 'manage_messages', flag: MANAGE_MESSAGES, label: 'Manage Messages', category: 'Text' },
  { key: 'read_message_history', flag: READ_MESSAGE_HISTORY, label: 'Read Message History', category: 'Text' },
  { key: 'connect', flag: CONNECT, label: 'Connect', category: 'Voice' },
  { key: 'speak', flag: SPEAK, label: 'Speak', category: 'Voice' },
  { key: 'mute_members', flag: MUTE_MEMBERS, label: 'Mute Members', category: 'Voice' },
  { key: 'deafen_members', flag: DEAFEN_MEMBERS, label: 'Deafen Members', category: 'Voice' },
  { key: 'move_members', flag: MOVE_MEMBERS, label: 'Move Members', category: 'Voice' },
];

/** Named permission labels for the role editor UI */
export const PERMISSION_LABELS: Array<{ key: string; flag: number; label: string; category: string }> = [
  { key: 'administrator', flag: ADMINISTRATOR, label: 'Administrator', category: 'General' },
  { key: 'manage_server', flag: MANAGE_SERVER, label: 'Manage Server', category: 'General' },
  { key: 'manage_channels', flag: MANAGE_CHANNELS, label: 'Manage Channels', category: 'General' },
  { key: 'manage_roles', flag: MANAGE_ROLES, label: 'Manage Roles', category: 'General' },
  { key: 'kick_members', flag: KICK_MEMBERS, label: 'Kick Members', category: 'Membership' },
  { key: 'ban_members', flag: BAN_MEMBERS, label: 'Ban Members', category: 'Membership' },
  { key: 'create_invite', flag: CREATE_INVITE, label: 'Create Invite', category: 'Membership' },
  { key: 'manage_nicknames', flag: MANAGE_NICKNAMES, label: 'Manage Nicknames', category: 'Membership' },
  { key: 'moderate_members', flag: MODERATE_MEMBERS, label: 'Timeout Members', category: 'Membership' },
  { key: 'manage_webhooks', flag: MANAGE_WEBHOOKS, label: 'Manage Webhooks', category: 'General' },
  { key: 'send_messages', flag: SEND_MESSAGES, label: 'Send Messages', category: 'Text' },
  { key: 'manage_messages', flag: MANAGE_MESSAGES, label: 'Manage Messages', category: 'Text' },
  { key: 'attach_files', flag: ATTACH_FILES, label: 'Attach Files', category: 'Text' },
  { key: 'add_reactions', flag: ADD_REACTIONS, label: 'Add Reactions', category: 'Text' },
  { key: 'mention_everyone', flag: MENTION_EVERYONE, label: 'Mention Everyone', category: 'Text' },
  { key: 'connect', flag: CONNECT, label: 'Connect', category: 'Voice' },
  { key: 'speak', flag: SPEAK, label: 'Speak', category: 'Voice' },
  { key: 'mute_members', flag: MUTE_MEMBERS, label: 'Mute Members', category: 'Voice' },
  { key: 'deafen_members', flag: DEAFEN_MEMBERS, label: 'Deafen Members', category: 'Voice' },
  { key: 'move_members', flag: MOVE_MEMBERS, label: 'Move Members', category: 'Voice' },
];
