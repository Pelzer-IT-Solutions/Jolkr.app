import type { Channel as GeneratedChannel } from './generated/Channel';
import type { Member as GeneratedMember } from './generated/Member';
import type { MeProfile as GeneratedMeProfile } from './generated/MeProfile';
import type { Message as GeneratedMessage } from './generated/Message';
import type { Poll } from './generated/Poll';
import type { Reaction as GeneratedReaction } from './generated/Reaction';
import type { Server as GeneratedServer } from './generated/Server';
import type { User as GeneratedUser } from './generated/User';

export type { Attachment } from './generated/Attachment';
export type { Ban } from './generated/Ban';
export type { Category } from './generated/Category';
export type { ChannelOverwrite } from './generated/ChannelOverwrite';
export type { DmChannel } from './generated/DmChannel';
export type { DmLastMessage } from './generated/DmLastMessage';
export type { Friendship } from './generated/Friendship';
export type { FriendshipUser } from './generated/FriendshipUser';
export type { GifFavorite } from './generated/GifFavorite';
export type { Invite } from './generated/Invite';
export type { MessageEmbed } from './generated/MessageEmbed';
export type { NotificationSetting } from './generated/NotificationSetting';
export type { Poll } from './generated/Poll';
export type { PollOption } from './generated/PollOption';
export type { Role } from './generated/Role';
export type { ServerEmoji } from './generated/ServerEmoji';
export type { Thread } from './generated/Thread';
export type { TokenPair } from './generated/TokenPair';
export type { UpdateMeBody } from './generated/UpdateMeBody';
export type { Webhook } from './generated/Webhook';

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

/**
 * Wire reaction shape with FE-only `me` flag (derived from `user_ids` on the
 * FE side — BE does not send it because the wire shape is per-message, not
 * per-viewer).
 */
export type Reaction = GeneratedReaction & { me?: boolean };

/**
 * Wire message shape with several FE-side overlays:
 * - `author` is resolved via the users store (not on the wire).
 * - `poll` is typed (BE keeps it as JSON for forward-compat).
 * - `reactions` overrides the generated `Array<Reaction>` so the FE-only
 *   `me` flag and pre-existing optional shape are preserved.
 * - Several optional fields keep their legacy `| null` form to match the
 *   pervasive `?? null` normalization in stores/messages.ts.
 */
export type Message = Omit<
  GeneratedMessage,
  'poll' | 'reactions' | 'thread_id' | 'thread_reply_count'
  | 'webhook_id' | 'webhook_name' | 'webhook_avatar' | 'updated_at'
> & {
  author?: User | null;
  poll?: Poll;
  reactions?: Reaction[];
  thread_id?: string | null;
  thread_reply_count?: number | null;
  webhook_id?: string | null;
  webhook_name?: string | null;
  webhook_avatar?: string | null;
  updated_at?: string | null;
};

/**
 * Wire member shape with FE-only `user` overlay. BE never sends the joined-in
 * user object — it is resolved client-side from the users store and attached
 * by transforms.ts so downstream code can branch on a single shape.
 */
export type Member = GeneratedMember & { user?: User };

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

