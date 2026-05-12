/**
 * Transforms backend API types → UI component types.
 * The UI components are pure and don't know about the backend.
 * This adapter layer bridges the two type systems.
 */

import { tStatic } from '../hooks/useT'
import { formatDate, formatTime } from '../i18n/formatters'
import { getApiBaseUrl } from '../platform/config'
import { getLocaleCode } from '../stores/locale'
import { displayName } from '../utils/format'
import type {
  User,
  Server as ApiServer,
  Channel as ApiChannel,
  Category as ApiCategory,
  Member as ApiMember,
  Message as ApiMessage,
  DmChannel,
} from '../api/types'
import type {
  ServerDisplay,
  ChannelDisplay,
  CategoryDisplay,
  MemberSummary,
  MemberGroup,
  MemberStatus,
  MessageVM,
  ReactionDisplay,
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
export function avatarLetter(user: { display_name?: string | null; username: string }): string {
  return (displayName(user)?.[0] ?? '?').toUpperCase()
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
    color: user.banner_color ?? hashColor(user.id),
    letter: avatarLetter(user),
    // Use the dedicated avatar endpoint — cached by nginx, no presigned URLs
    avatarUrl: user.avatar_url ? avatarEndpoint(user.id) : null,
  }
}

/**
 * Format an ISO timestamp into a locale-aware display string.
 * Hot path — called for every message in the chat. Reads the active locale
 * via `getLocaleCode()` (zustand store, sync), then formats the time/date
 * fragments through the cached `Intl.*` wrappers and substitutes them into
 * the active dict's `time.todayAt` / `time.yesterdayAt` / `time.dateAt`
 * templates so the word-order and separators stay correct in every locale.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const locale = getLocaleCode()
  const time = formatTime(iso, locale)

  const isToday = date.toDateString() === now.toDateString()
  if (isToday) return tStatic('time.todayAt', { time })

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) {
    return tStatic('time.yesterdayAt', { time })
  }

  return tStatic('time.dateAt', { date: formatDate(iso, locale, 'short'), time })
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
): MessageVM {
  const author = users.get(msg.author_id) ?? msg.author
  const { color, letter, avatarUrl } = author ? userToAvatar(author) : { color: 'oklch(50% 0 0)', letter: '?', avatarUrl: null }
  const authorName = displayName(author)

  // Continued = same author as previous message
  const continued = !!prevMsg && prevMsg.author_id === msg.author_id

  // Reply reference. For E2EE messages we forward the encryption inputs so
  // the renderer can decrypt — synchronously baking 'Encrypted message' here
  // would lose the data forever.
  let replyTo: ReplyRef | undefined
  if (msg.reply_to_id) {
    const replyMsg = allMessages.get(msg.reply_to_id)
    if (replyMsg) {
      const replyAuthor = replyMsg.author ?? users.get(replyMsg.author_id)
      const fallbackText = replyMsg.nonce
        ? '' // ciphertext slice would be gibberish; renderer must decrypt
        : (replyMsg.content?.slice(0, 100) ?? '')
      replyTo = {
        id: replyMsg.id,
        author: displayName(replyAuthor),
        text: fallbackText,
        content: replyMsg.content,
        nonce: replyMsg.nonce,
        channelId: replyMsg.channel_id ?? null,
      }
    }
  }

  // Reactions — map to UI format with userIds for tooltip
  const reactions: ReactionDisplay[] = (msg.reactions ?? []).map(r => ({
    emoji: r.emoji,
    count: r.count,
    me: r.me ?? false,
    userIds: r.user_ids ?? [],
  }))

  return {
    id: msg.id,
    author: authorName,
    color,
    letter,
    avatarUrl,
    time: formatTimestamp(msg.created_at),
    created_at: msg.created_at,
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
    embeds: msg.embeds,
    attachments: msg.attachments,
    thread_id: msg.thread_id ?? null,
    thread_reply_count: msg.thread_reply_count ?? null,
    poll: msg.poll ?? null,
    webhook_id: msg.webhook_id ?? null,
    webhook_name: msg.webhook_name ?? null,
    webhook_avatar: msg.webhook_avatar ?? null,
  }
}

/** Transform a list of API messages into UI messages with continued flags. */
export function transformMessages(
  msgs: ApiMessage[],
  users: Map<string, User>,
  isDm?: boolean,
): MessageVM[] {
  const msgMap = new Map(msgs.map(m => [m.id, m]))
  return msgs.map((msg, i) => {
    const ui = transformMessage(msg, users, msgMap, i > 0 ? msgs[i - 1] : null)
    if (isDm) {
      ui.isDm = true
      if (ui.replyTo) ui.replyTo.isDm = true
    }
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
): ServerDisplay {
  const sortedCats = [...categories].sort((a, b) => a.position - b.position)

  const uiCategories: CategoryDisplay[] = sortedCats.map(cat => ({
    id: cat.id,
    name: cat.name,
    channels: channels
      .filter(ch => ch.category_id === cat.id)
      .sort((a, b) => a.position - b.position)
      .map(ch => ch.id),
  }))

  const uiChannels: ChannelDisplay[] = channels
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(ch => ({
      id: ch.id,
      name: ch.name,
      icon: channelIcon(ch.kind),
      desc: ch.topic || '',
      unread: channelUnreads?.[ch.id] ?? 0,
      is_system: ch.is_system,
      kind: ch.kind === 'voice' ? 'voice' : 'text',
    }))

  return {
    id: server.id,
    name: server.name,
    icon: (server.name?.[0] ?? '?').toUpperCase(),
    color: hashColor(server.id),
    unread: unreadCount > 0,
    iconUrl: server.icon_url ? `${iconEndpoint(server.id)}?v=${encodeURIComponent(server.icon_url.slice(-8))}` : null,
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
  const online: MemberSummary[] = []
  const offline: MemberSummary[] = []

  for (const member of members) {
    const user = member.user ?? users.get(member.user_id)
    if (!user) continue

    const status = toMemberStatus(presences.get(user.id) ?? user.status)
    const { color, letter, avatarUrl } = userToAvatar(user)
    const uiMember: MemberSummary = {
      name: member.nickname || displayName(user),
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
        name: displayName(user),
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
