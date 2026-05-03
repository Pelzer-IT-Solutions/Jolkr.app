/**
 * Discriminated union over the WebSocket events the backend emits.
 *
 * Each variant fixes the `op` literal and shape of its `d` payload, so
 * `switch (event.op)` automatically narrows `event.d` for the consumer.
 *
 * Adding a new event:
 *   1. Append a new variant to `WsEvent`.
 *   2. Handle it in the relevant store/hook via `case 'YourOp':` —
 *      TypeScript will tell you which switches need updating.
 */

import type {
  Message, Server, Channel, Member, Category, DmChannel, GifFavorite, Friendship, Thread, Poll, Role, ChannelOverwrite, DmFilter,
} from './types';

/** Reactions on the wire have `user_ids` (snake) — see `Reaction` in api/types.ts. */
interface ReactionPayload {
  emoji: string;
  count: number;
  me: boolean;
  user_ids: string[];
}

export type WsEvent =
  // ── Connection lifecycle ──────────────────────────────────────────
  | { op: 'Ready'; d: { user_id?: string } }
  | { op: 'HeartbeatAck'; d: Record<string, unknown> }
  /** Synthetic event emitted by the client after MAX_ATTEMPTS failed reconnects. */
  | { op: 'Disconnected'; d: { reason: string } }

  // ── Messages ──────────────────────────────────────────────────────
  | { op: 'MessageCreate' | 'MessageUpdate'; d: { message: Message } }
  | { op: 'MessageDelete'; d: { message_id: string; channel_id?: string; dm_channel_id?: string } }
  | { op: 'ReactionUpdate'; d: { channel_id: string; message_id: string; reactions: ReactionPayload[] } }
  | { op: 'PollUpdate'; d: { channel_id: string; message_id: string; poll: Poll } }
  | { op: 'ThreadCreate' | 'ThreadUpdate'; d: { thread: Thread } }

  // ── Server / channel / category ───────────────────────────────────
  | { op: 'ChannelCreate' | 'ChannelUpdate'; d: { channel: Channel } }
  | { op: 'ChannelDelete'; d: { channel_id: string; server_id: string } }
  | { op: 'CategoryCreate' | 'CategoryUpdate'; d: { category: Category } }
  | { op: 'CategoryDelete'; d: { server_id: string; category_id: string } }
  | { op: 'ServerUpdate'; d: { server: Server } }
  | { op: 'ServerDelete'; d: { server_id: string } }
  | { op: 'MemberJoin'; d: { server_id: string; user_id: string; member?: Member } }
  | { op: 'MemberLeave'; d: { server_id: string; user_id: string } }
  /**
   * Per-field semantics:
   *   - `nickname`/`timeout_until`: empty string `""` = cleared, RFC3339/string = set, missing = unchanged.
   *   - `role_ids`: full new role-id array, or missing = unchanged.
   * Consumers MUST use `'field' in event.d` to detect presence — backend
   * omits fields it didn't touch in this update.
   */
  | { op: 'MemberUpdate'; d: { server_id: string; user_id: string; timeout_until?: string; nickname?: string; role_ids?: string[] } }

  // ── Roles (server-wide CRUD) ──────────────────────────────────────
  | { op: 'RoleCreate' | 'RoleUpdate'; d: { server_id: string; role: Role } }
  | { op: 'RoleDelete'; d: { server_id: string; role_id: string } }

  // ── Channel permission overwrites ─────────────────────────────────
  /** Full overwrite list for a channel — replaces local cache wholesale. */
  | { op: 'ChannelPermissionUpdate'; d: { channel_id: string; server_id: string; overwrites: ChannelOverwrite[] } }

  // ── DM ────────────────────────────────────────────────────────────
  | { op: 'DmCreate' | 'DmUpdate'; d: { channel: DmChannel } }
  | { op: 'DmClose'; d: { dm_id: string } }
  | { op: 'DmMessageHide'; d: { dm_id: string; message_id: string } }
  | { op: 'DmCallRing'; d: { dm_id: string; caller_id: string; caller_username: string; is_video: boolean } }
  | { op: 'DmCallAccept' | 'DmCallReject' | 'DmCallEnd'; d: { dm_id: string; user_id: string } }
  | { op: 'DmMessagesRead'; d: { dm_id: string; user_id: string; message_id: string } }
  | { op: 'ChannelMessagesRead'; d: { channel_id: string; user_id: string; message_id: string } }
  | { op: 'ServerMessagesRead'; d: { server_id: string; user_id: string } }

  // ── Presence / typing ─────────────────────────────────────────────
  | { op: 'PresenceUpdate'; d: { user_id: string; status: string } }
  | { op: 'TypingStart'; d: { channel_id: string; user_id: string; username?: string; display_name?: string } }

  // ── User profile ──────────────────────────────────────────────────
  /**
   * Profile changed (display_name / avatar_url / bio / status).
   * Fanned out to the user themselves PLUS every mutual server/DM member so
   * everyone's local cache stays in sync without polling.
   */
  | { op: 'UserUpdate'; d: { user_id: string; display_name?: string | null; avatar_url?: string | null; bio?: string | null; status?: string | null; banner_color?: string | null; show_read_receipts?: boolean | null; dm_filter?: DmFilter | null; allow_friend_requests?: boolean | null } }
  | { op: 'EmailVerified'; d: { user_id?: string } }

  // ── GIF favorites (cross-session sync) ────────────────────────────
  | { op: 'GifFavoriteUpdate'; d: { added?: GifFavorite | null; removed_gif_id?: string | null } }

  // ── Friend lifecycle (sent to both parties so panels refresh live) ─
  | { op: 'FriendshipUpdate'; d: { friendship: Friendship; kind: 'created' | 'accepted' | 'declined' | 'removed' | 'blocked' } }

  // ── Cross-session call presence ───────────────────────────────────
  /** Sibling sessions of the same user get this when the user joins/leaves
   *  a DM call OR a server voice channel. `dm_id` and `channel_id` are
   *  mutually exclusive — at most one is set. Both `null` means the user
   *  is no longer in a call. */
  | { op: 'UserCallPresence'; d: { dm_id?: string | null; channel_id?: string | null; is_video?: boolean | null } }

  // ── Notification settings (cross-session sync) ────────────────────
  /** A per-target notification setting (mute, suppress_everyone) was
   *  changed. Sent to the user's own user-channel. `setting: null` means
   *  the row was deleted (defaults restored). */
  | { op: 'NotificationSettingUpdate'; d: { target_type: string; target_id: string; setting?: { muted: boolean; mute_until?: string | null; suppress_everyone: boolean } | null } }
  ;

/**
 * What `wsClient.on(...)` listeners receive. Backend events with an `op` that
 * is not yet listed above are still dispatched at runtime — they fall through
 * the default branch of consumer `switch`-statements without breaking the
 * build. The dispatcher casts the raw `{ op, d }` to `WsEvent`, so adding a
 * new event purely on the backend is safe; consumers that *want* to handle it
 * just need a new variant added here.
 */
export type WsListenerEvent = WsEvent;
