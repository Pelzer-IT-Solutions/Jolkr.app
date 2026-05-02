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
  Message, Server, Channel, Member, Category, DmChannel,
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
  | { op: 'PollUpdate'; d: { channel_id: string; message_id: string; poll: unknown } }
  | { op: 'ThreadCreate' | 'ThreadUpdate'; d: { thread: unknown } }

  // ── Server / channel / category ───────────────────────────────────
  | { op: 'ChannelCreate' | 'ChannelUpdate'; d: { channel: Channel } }
  | { op: 'ChannelDelete'; d: { channel_id: string; server_id: string } }
  | { op: 'CategoryCreate' | 'CategoryUpdate'; d: { category: Category } }
  | { op: 'CategoryDelete'; d: { server_id: string; category_id: string } }
  | { op: 'ServerUpdate'; d: { server: Server } }
  | { op: 'ServerDelete'; d: { server_id: string } }
  | { op: 'MemberJoin'; d: { server_id: string; user_id: string; member?: Member } }
  | { op: 'MemberLeave'; d: { server_id: string; user_id: string } }
  | { op: 'MemberUpdate'; d: { server_id: string; user_id: string; timeout_until?: string | null; nickname?: string | null; role_ids?: string[] } }

  // ── DM ────────────────────────────────────────────────────────────
  | { op: 'DmCreate' | 'DmUpdate'; d: { channel: DmChannel } }
  | { op: 'DmCallRing'; d: { dm_id: string; caller_id: string; caller_username: string; is_video: boolean } }
  | { op: 'DmCallAccept' | 'DmCallReject' | 'DmCallEnd'; d: { dm_id: string } }
  | { op: 'DmMessagesRead'; d: { dm_id: string; user_id: string; message_id: string } }
  | { op: 'ChannelMessagesRead'; d: { channel_id: string; user_id: string; message_id: string } }
  | { op: 'ServerMessagesRead'; d: { server_id: string; user_id: string } }

  // ── Presence / typing ─────────────────────────────────────────────
  | { op: 'PresenceUpdate'; d: { user_id: string; status: string } }
  | { op: 'TypingStart'; d: { channel_id: string; user_id: string; username?: string; display_name?: string } }

  // ── User profile ──────────────────────────────────────────────────
  | { op: 'UserUpdate'; d: Record<string, unknown> }
  | { op: 'EmailVerified'; d: { user_id?: string } }
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
