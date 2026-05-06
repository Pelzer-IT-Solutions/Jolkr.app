/** Who is allowed to start a new DM with the user. */
export type DmFilter = 'all' | 'friends' | 'none';

export interface User {
  id: string;
  username: string;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  status?: string | null;
  bio?: string | null;
  is_online?: boolean;
  show_read_receipts?: boolean | null;
  is_system?: boolean;
  email_verified?: boolean;
  banner_color?: string | null;
  /** Privacy: who can start a new DM with this user. */
  dm_filter?: DmFilter | null;
  /** Privacy: whether others can send friend requests to this user. */
  allow_friend_requests?: boolean | null;
  created_at?: string | null;
}

/**
 * Body accepted by `PATCH /users/@me`. Mirrors the server `UpdateMeRequest`.
 * Used by both `api.updateMe` and `useAuthStore.updateProfile` so the shape
 * stays in one place.
 */
export interface UpdateMeBody {
  username?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string;
  status?: string | null;
  show_read_receipts?: boolean;
  banner_color?: string;
  dm_filter?: DmFilter;
  allow_friend_requests?: boolean;
}

export interface Server {
  id: string;
  name: string;
  icon_url?: string | null;
  banner_url?: string | null;
  owner_id: string;
  description?: string | null;
  is_public?: boolean;
  member_count?: number;
  theme?: { hue: number | null; orbs: { id: string; x: number; y: number; hue: number; scale?: number }[] } | null;
  created_at?: string | null;
}

export type ChannelKind = 'text' | 'voice' | 'category';

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  kind: ChannelKind;
  topic?: string | null;
  position: number;
  category_id?: string | null;
  is_nsfw?: boolean;
  is_system?: boolean;
  slowmode_seconds?: number;
  e2ee_key_generation?: number;
  created_at?: string | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
  user_ids?: string[]; // Backend sends user IDs who reacted (for tooltip)
}

export interface Message {
  id: string;
  channel_id: string;
  /** Backend variant for DM messages — when present, used in place of
   *  `channel_id` so the message lands in the right DM bucket. */
  dm_channel_id?: string | null;
  author_id: string;
  content: string;
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

export interface Category {
  id: string;
  server_id: string;
  name: string;
  position: number;
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

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  requester?: User;
  addressee?: User;
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
