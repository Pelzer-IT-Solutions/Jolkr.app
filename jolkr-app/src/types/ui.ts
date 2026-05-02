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
