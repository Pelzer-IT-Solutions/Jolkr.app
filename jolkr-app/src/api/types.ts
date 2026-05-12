import type { Channel as GeneratedChannel } from './generated/Channel';
import type { MeProfile as GeneratedMeProfile } from './generated/MeProfile';
import type { Server as GeneratedServer } from './generated/Server';
import type { User as GeneratedUser } from './generated/User';

export type { Category } from './generated/Category';
export type { UpdateMeBody } from './generated/UpdateMeBody';

/** Who is allowed to start a new DM with the user. */
export type DmFilter = 'all' | 'friends' | 'none';

export type ChannelKind = 'text' | 'voice' | 'category';

/**
 * Theme blob attached to a server. Backend stores it as untyped JSON, so
 * the typed shape is layered on top of the generated `Server` here.
 */
export interface ServerThemeData {
  hue: number | null;
  orbs: { id: string; x: number; y: number; hue: number; scale?: number }[];
}

/** Wire user profile from BE. Narrows `dm_filter` to the typed union. */
export type User = Omit<GeneratedUser, 'dm_filter'> & { dm_filter: DmFilter | null };

/** Self-profile from `/users/@me`. Narrows `dm_filter` to the typed union. */
export type MeProfile = Omit<GeneratedMeProfile, 'dm_filter'> & { dm_filter: DmFilter | null };

/** Wire server shape with a typed `theme` overlay (BE keeps it as JSON). */
export type Server = Omit<GeneratedServer, 'theme'> & { theme?: ServerThemeData | null };

/**
 * Wire channel shape with FE-only `is_system` overlay. BE `ChannelInfo` does
 * not expose this field yet — see `todos.md` ("is_system BE acceptance").
 */
export type Channel = GeneratedChannel & { is_system?: boolean };

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
  user_ids?: string[]; // Backend sends user IDs who reacted (for tooltip)
}

export interface Message {
  id: string;
  /**
   * Carries the channel id for server-channel messages and the DM channel id
   * for DM messages — backend `dm_to_message_info` unifies the two on both
   * HTTP and WS, so consumers don't need a separate `dm_channel_id` branch.
   */
  channel_id: string;
  author_id: string;
  /**
   * Plaintext message content. `null` when the message is end-to-end
   * encrypted — in that case `nonce` is set and the renderer must decrypt.
   */
  content: string | null;
  nonce?: string | null;
  created_at: string;
  updated_at?: string | null;
  is_edited: boolean;
  is_pinned: boolean;
  reply_to_id?: string | null;
  thread_id?: string | null;
  thread_reply_count?: number | null;
  author?: User | null;
  attachments: Attachment[];
  reactions?: Reaction[];
  embeds?: MessageEmbed[];
  poll?: Poll;
  webhook_id?: string | null;
  webhook_name?: string | null;
  webhook_avatar?: string | null;
}

export interface Thread {
  id: string;
  channel_id: string;
  starter_msg_id?: string | null;
  name?: string | null;
  is_archived: boolean;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  url: string;
}

export interface MessageEmbed {
  url: string;
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  site_name?: string | null;
  color?: string | null;
}

export interface Member {
  id: string;
  server_id: string;
  user_id: string;
  nickname?: string | null;
  joined_at: string;
  timeout_until?: string | null;
  user?: User;
  role_ids?: string[];
}

export interface Webhook {
  id: string;
  channel_id: string;
  server_id: string;
  creator_id: string;
  name: string;
  avatar_url?: string | null;
  token?: string;
}

export interface Poll {
  id: string;
  message_id: string;
  channel_id: string;
  question: string;
  multi_select: boolean;
  anonymous: boolean;
  expires_at?: string | null;
  options: PollOption[];
  votes: Record<string, number>;
  my_votes?: string[];
  total_votes: number;
}

export interface PollOption {
  id: string;
  poll_id: string;
  position: number;
  text: string;
}

export interface Role {
  id: string;
  server_id: string;
  name: string;
  color: number;
  position: number;
  permissions: number;
  is_default: boolean;
}

export interface ChannelOverwrite {
  id: string;
  channel_id: string;
  target_type: 'role' | 'member';
  target_id: string;
  allow: number;
  deny: number;
}

export interface DmLastMessage {
  id: string;
  author_id: string;
  content?: string | null;
  nonce?: string | null;
  created_at: string;
}

export interface DmChannel {
  id: string;
  is_group: boolean;
  name?: string | null;
  members: string[];
  created_at: string;
  last_message?: DmLastMessage | null;
}

/**
 * Lightweight user shape embedded in `Friendship.requester` / `addressee` —
 * the backend only joins these four fields to power the friends panel
 * without an extra round-trip. This is intentionally narrower than `User`.
 */
export interface FriendshipUser {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  requester?: FriendshipUser;
  addressee?: FriendshipUser;
}

export interface Ban {
  id: string;
  server_id: string;
  user_id: string;
  banned_by?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface Invite {
  id: string;
  server_id: string;
  code: string;
  creator_id: string;
  max_uses?: number | null;
  use_count: number;
  expires_at?: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface ServerEmoji {
  id: string;
  server_id: string;
  name: string;
  image_url: string;
  uploader_id: string;
  animated: boolean;
}

export interface NotificationSetting {
  target_type: 'server' | 'channel';
  target_id: string;
  muted: boolean;
  mute_until?: string | null;
  suppress_everyone: boolean;
}

export interface AuditLogEntry {
  id: string;
  server_id: string;
  user_id: string;
  action_type: string;
  target_id?: string | null;
  target_type?: string | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
  created_at: string;
}

export interface PreKeyBundleResponse {
  user_id: string;
  device_id: string;
  identity_key: string;
  signed_prekey: string;
  signed_prekey_signature: string;
  one_time_prekey?: string | null;
  pq_signed_prekey?: string | null;
  pq_signed_prekey_signature?: string | null;
}

export interface GifFavorite {
  gif_id: string
  gif_url: string
  preview_url: string
  title: string
  added_at: string
}
