export interface ChannelDisplay {
  id:        string
  name:      string
  icon:      string
  desc:      string
  unread:    number
  is_system?: boolean
  kind?:     'text' | 'voice'
}

export interface CategoryDisplay {
  id:       string
  name:     string
  channels: string[]
}

export interface ServerDisplay {
  id:         string
  name:       string
  icon:       string
  color:      string
  unread:     boolean
  hue?:       number
  iconUrl?:   string | null
  categories: CategoryDisplay[]
  channels:   ChannelDisplay[]
  members:    MemberGroup
}

export type MemberStatus = 'online' | 'idle' | 'dnd' | 'offline'

export interface DMParticipant {
  name:      string
  status:    MemberStatus
  color:     string
  letter:    string
  avatarUrl?: string | null
  userId?:   string
}

export interface DMConversation {
  id:           string
  type:         'direct' | 'group'
  participants: DMParticipant[]
  name?:        string
  lastMessage?: string
  lastMessageNonce?: string | null
  lastTime?:    string
  unread:       number
}

/** Lightweight member used by MemberPanel and other "card"-style listings. */
export interface MemberSummary {
  name:      string
  status:    MemberStatus
  color:     string
  letter:    string
  avatarUrl?: string | null
  userId?:   string
}

export interface MemberGroup {
  online:  MemberSummary[]
  offline: MemberSummary[]
}

export interface ReactionDisplay {
  emoji:   string
  count:   number
  me:      boolean
  userIds: string[]  // List of user IDs who reacted (for tooltip)
}

export interface ReplyRef {
  id?:    string
  author: string
  text:   string
}

/**
 * View-model for a chat message. Mixes camelCase display fields
 * (`author`, `color`, `letter`, `time`, `replyTo`, …) with snake_case
 * passthrough fields (`author_id`, `channel_id`, `is_pinned`, …) for
 * the e2ee/edit/reaction handlers that need the raw API identifiers.
 *
 * The two halves serve different layers: display fields are produced by
 * `adapters/transforms.ts`, while passthrough fields are kept verbatim
 * from the wire. A "pure" UI shape would force every consumer to
 * re-map the API record on access, so the mix is intentional. New
 * fields should follow the same rule:
 *   - displayed in the UI directly  →  camelCase
 *   - sent back to the API verbatim →  snake_case (mirror api/types.ts)
 */
export interface MessageVM {
  id:        string
  author:    string
  color:     string
  letter:    string
  avatarUrl?: string | null
  time:      string
  /** Raw ISO timestamp from the backend — used for day-boundary separators. */
  created_at: string
  content:   string
  reactions: ReactionDisplay[]
  continued: boolean
  replyTo?:  ReplyRef
  edited?:   boolean
  // E2EE fields (passed through for decryption)
  nonce?:             string | null
  author_id?:         string
  channel_id?:        string
  isDm?:              boolean
  is_pinned?:         boolean
  is_system?:         boolean
  embeds?:            import('../api/types').MessageEmbed[]
  attachments?:       import('../api/types').Attachment[]
  // Thread metadata. `thread_id` on a parent message is the id of the
  // thread that hangs off it (set by the backend when the thread is created
  // from this message). `thread_reply_count` is the number of replies the
  // thread currently has — drives the "{n} replies in thread" badge.
  thread_id?:         string | null
  thread_reply_count?: number | null
  // Poll attached to this message (set by the backend when the message is a
  // poll-host message). Refreshed live via `PollUpdate` WS events handled by
  // the messages store.
  poll?:              import('../api/types').Poll | null
}

export type MessageStore = Record<string, Record<string, MessageVM[]>>

export interface ThemeOrb {
  id:     string
  x:      number   // 0 – 1 (fraction of canvas width)
  y:      number   // 0 – 1 (fraction of canvas height)
  hue:    number   // OKLCH hue (0 – 360)
  scale?: number   // 0.5 – 2.0 (orb size multiplier, default 1.0)
}

export interface ServerTheme {
  hue:  number | null  // primary hue — drives all UI tint tokens; null = theme-less / neutral
  orbs: ThemeOrb[]     // background gradient blobs
}

// ── Display types for components ──

/** Member rendered in lists/profile cards with original snake_case API fields. */
export interface MemberDisplay {
  user_id:       string
  username:      string
  display_name?: string | null
  status:        MemberStatus
  color:         string
  letter:        string
  avatar_url?:   string | null
}

export interface PermissionOverwriteDisplay {
  id:          string
  channel_id:  string
  target_type: 'role' | 'member'
  target_id:   string
  allow:       number  // Permission bitfield
  deny:        number  // Permission bitfield
}
