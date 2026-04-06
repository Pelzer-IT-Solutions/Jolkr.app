export interface Channel {
  id:        string
  name:      string
  icon:      string
  desc:      string
  unread:    number
  is_system?: boolean
}

export interface Category {
  name:     string
  channels: string[]
}

export interface Server {
  id:         string
  name:       string
  icon:       string
  color:      string
  unread:     boolean
  hue?:       number
  iconUrl?:   string | null
  categories: Category[]
  channels:   Channel[]
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

export interface Member {
  name:      string
  status:    MemberStatus
  color:     string
  letter:    string
  avatarUrl?: string | null
  userId?:   string
}

export interface MemberGroup {
  online:  Member[]
  offline: Member[]
}

export interface Reaction {
  emoji: string
  count: number
  me:    boolean
}

export interface ReplyRef {
  id?:    string
  author: string
  text:   string
}

export interface Message {
  id:        string
  author:    string
  color:     string
  letter:    string
  avatarUrl?: string | null
  time:      string
  content:   string
  reactions: Reaction[]
  continued: boolean
  replyTo?:  ReplyRef
  edited?:   boolean
  // E2EE fields (passed through for decryption)
  nonce?:             string | null
  author_id?:         string
  channel_id?:        string
  isDm?:              boolean
  is_pinned?:         boolean
}

export type MessageStore = Record<string, Record<string, Message[]>>

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

export interface MemberDisplay {
  user_id:       string
  username:      string
  display_name?: string | null
  status:        MemberStatus
  color:         string
  letter:        string
  avatar_url?:   string | null
}

export interface PermissionOverwrite {
  id:          string
  channel_id:  string
  target_type: 'role' | 'member'
  target_id:   string
  allow:       number  // Permission bitfield
  deny:        number  // Permission bitfield
}
