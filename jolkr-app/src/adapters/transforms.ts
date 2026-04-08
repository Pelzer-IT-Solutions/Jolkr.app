/**
 * Transforms backend API types → UI component types.
 * The UI components are pure and don't know about the backend.
 * This adapter layer bridges the two type systems.
 */

import type {
  User,
  Server as ApiServer,
  Channel as ApiChannel,
  Category as ApiCategory,
  Member as ApiMember,
  Message as ApiMessage,
  DmChannel,
} from '../api/types'
import { getApiBaseUrl } from '../platform/config'

import type {
  Server as UiServer,
  Channel as UiChannel,
  Category as UiCategory,
  Member as UiMember,
  MemberGroup,
  MemberStatus,
  Message as UiMessage,
  Reaction,
  ReplyRef,
  DMConversation,
  DMParticipant,
} from '../types/ui'

// ─── Helpers ───────────────────────────────────────────────

/** Deterministic OKLCH color from a string (user ID or name). */
export function hashColor(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
  }
  const hue = ((hash % 360) + 360) % 360
  return `oklch(55% 0.18 ${hue})`
}

/** First letter of display name or username, uppercased. */
export function avatarLetter(user: User): string {
  const name = user.display_name || user.username
  return (name?.[0] ?? '?').toUpperCase()
}

/** Build the cached avatar endpoint URL for a user (no presigned S3 needed). */
function avatarEndpoint(userId: string): string {
  return `${getApiBaseUrl()}/avatars/${userId}`
}

/** Build the cached icon endpoint URL for a server. */
function iconEndpoint(serverId: string): string {
  return `${getApiBaseUrl()}/icons/${serverId}`
}

/** Avatar props from a User object. */
export function userToAvatar(user: User): { color: string; letter: string; avatarUrl?: string | null } {
  return {
    color: hashColor(user.id),
    letter: avatarLetter(user),
    // Use the dedicated avatar endpoint — cached by nginx, no presigned URLs
    avatarUrl: user.avatar_url ? avatarEndpoint(user.id) : null,
  }
}

/** Format ISO timestamp to display string (e.g. "Today at 3:45 PM"). */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  if (isToday) return `Today at ${time}`
  if (isYesterday) return `Yesterday at ${time}`
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${time}`
}

/** Map backend user status / presence to UI MemberStatus. */
export function toMemberStatus(status?: string | null): MemberStatus {
  switch (status) {
    case 'online': return 'online'
    case 'idle': return 'idle'
    case 'dnd': return 'dnd'
    default: return 'offline'
  }
}

/** Channel icon based on channel kind. */
function channelIcon(kind: string): string {
  switch (kind) {
    case 'voice': return '🔊'
    case 'category': return '📁'
    default: return '#'
  }
}

// ─── Message Transform ─────────────────────────────────────

export function transformMessage(
  msg: ApiMessage,
  users: Map<string, User>,
  allMessages: Map<string, ApiMessage>,
  prevMsg?: ApiMessage | null,
): UiMessage {
  const author = users.get(msg.author_id) ?? msg.author
  const { color, letter, avatarUrl } = author ? userToAvatar(author) : { color: 'oklch(50% 0 0)', letter: '?', avatarUrl: null }
  const displayName = author?.display_name || author?.username || 'Unknown'

  // Continued = same author as previous message
  const continued = !!prevMsg && prevMsg.author_id === msg.author_id

  // Reply reference
  let replyTo: ReplyRef | undefined
  if (msg.reply_to_id) {
    const replyMsg = allMessages.get(msg.reply_to_id)
    if (replyMsg) {
      const replyAuthor = replyMsg.author ?? users.get(replyMsg.author_id)
      replyTo = {
        author: replyAuthor?.display_name || replyAuthor?.username || 'Unknown',
        text: replyMsg.content?.slice(0, 100) || 'Encrypted message',
      }
    }
  }

  // Reactions — map to UI format with userIds for tooltip
  const reactions: Reaction[] = (msg.reactions ?? []).map(r => ({
    emoji: r.emoji,
    count: r.count,
    me: r.me,
    userIds: r.user_ids ?? [],
  }))

  return {
    id: msg.id,
    author: displayName,
    color,
    letter,
    avatarUrl,
    time: formatTimestamp(msg.created_at),
    content: msg.content || '',
    reactions,
    continued,
    replyTo,
    edited: msg.is_edited,
    // Pass through fields for decryption in the Message component
    nonce: msg.nonce,
    author_id: msg.author_id,
    channel_id: msg.channel_id,
    is_pinned: msg.is_pinned,
  }
}

/** Transform a list of API messages into UI messages with continued flags. */
export function transformMessages(
  msgs: ApiMessage[],
  users: Map<string, User>,
  isDm?: boolean,
): UiMessage[] {
  const msgMap = new Map(msgs.map(m => [m.id, m]))
  return msgs.map((msg, i) => {
    const ui = transformMessage(msg, users, msgMap, i > 0 ? msgs[i - 1] : null)
    if (isDm) ui.isDm = true
    return ui
  })
}

// ─── Server Transform ──────────────────────────────────────

export function transformServer(
  server: ApiServer,
  channels: ApiChannel[],
  categories: ApiCategory[],
  memberGroup: MemberGroup,
  unreadCount: number,
  channelUnreads?: Record<string, number>,
): UiServer {
  // Sort categories by position
  const sortedCats = [...categories].sort((a, b) => a.position - b.position)

  // Build UI categories (name + channel ID list)
  const uiCategories: UiCategory[] = sortedCats.map(cat => ({
    name: cat.name,
    channels: channels
      .filter(ch => ch.category_id === cat.id)
      .sort((a, b) => a.position - b.position)
      .map(ch => ch.id),
  }))

  // Add uncategorized channels
  const categorizedIds = new Set(channels.filter(ch => ch.category_id).map(ch => ch.id))
  const uncategorized = channels.filter(ch => !categorizedIds.has(ch.id))
  if (uncategorized.length > 0) {
    uiCategories.unshift({
      name: 'Channels',
      channels: uncategorized.sort((a, b) => a.position - b.position).map(ch => ch.id),
    })
  }

  // Build UI channels
  const uiChannels: UiChannel[] = channels
    .sort((a, b) => a.position - b.position)
    .map(ch => ({
      id: ch.id,
      name: ch.name,
      icon: channelIcon(ch.kind),
      desc: ch.topic || '',
      unread: channelUnreads?.[ch.id] ?? 0,
      is_system: ch.is_system,
    }))

  return {
    id: server.id,
    name: server.name,
    icon: (server.name?.[0] ?? '?').toUpperCase(),
    color: hashColor(server.id),
    unread: unreadCount > 0,
    iconUrl: server.icon_url ? iconEndpoint(server.id) : null,
    categories: uiCategories,
    channels: uiChannels,
    members: memberGroup,
  }
}

// ─── Member Transform ──────────────────────────────────────

export function transformMemberGroup(
  members: ApiMember[],
  users: Map<string, User>,
  presences: Map<string, string>,
): MemberGroup {
  const online: UiMember[] = []
  const offline: UiMember[] = []

  for (const member of members) {
    const user = member.user ?? users.get(member.user_id)
    if (!user) continue

    const status = toMemberStatus(presences.get(user.id) ?? user.status)
    const { color, letter, avatarUrl } = userToAvatar(user)
    const uiMember: UiMember = {
      name: member.nickname || user.display_name || user.username,
      status,
      color,
      letter,
      avatarUrl,
      userId: user.id,
    }

    if (status === 'offline') {
      offline.push(uiMember)
    } else {
      online.push(uiMember)
    }
  }

  return { online, offline }
}

// ─── DM Transform ──────────────────────────────────────────

export function transformDmConversation(
  dm: DmChannel,
  users: Map<string, User>,
  presences: Map<string, string>,
  currentUserId: string,
  lastMessage?: ApiMessage | null,
  unreadCount?: number,
): DMConversation {
  // Build participants (exclude current user for display)
  const participants: DMParticipant[] = dm.members
    .filter(id => id !== currentUserId)
    .map(id => {
      const user = users.get(id)
      if (!user) return { name: 'Unknown', status: 'offline' as MemberStatus, color: 'oklch(50% 0 0)', letter: '?', userId: id }
      const status = toMemberStatus(presences.get(id) ?? user.status)
      const { color, letter, avatarUrl } = userToAvatar(user)
      return {
        name: user.display_name || user.username,
        status,
        color,
        letter,
        avatarUrl,
        userId: user.id,
      }
    })

  return {
    id: dm.id,
    type: dm.is_group ? 'group' : 'direct',
    participants,
    name: dm.name || undefined,
    lastMessage: lastMessage?.content || undefined,
    lastMessageNonce: lastMessage?.nonce,
    lastTime: lastMessage ? formatTimestamp(lastMessage.created_at) : undefined,
    unread: unreadCount ?? 0,
  }
}
