import { useMemo } from 'react'
import type { ChannelDisplay, DMConversation } from '../../types/ui'
import { useTypingUsers } from '../../stores/typing'
import { getApiBaseUrl } from '../../platform/config'
import {
  transformServer,
  transformMessages,
  transformMemberGroup,
  transformDmConversation,
  hashColor,
  avatarLetter,
} from '../../adapters/transforms'
import { displayName } from '../../utils/format'
import { useAnimatedTheme } from '../../utils/useAnimatedTheme'
import { useColorMode } from '../../utils/colorMode'
import {
  hasPermission, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_SERVER,
  MANAGE_MESSAGES, ADD_REACTIONS, SEND_MESSAGES, ATTACH_FILES, CREATE_INVITE,
} from '../../utils/permissions'

import type { User, Message as ApiMessage } from '../../api/types'
import type { useAppInit } from './useAppInit'

export function useAppMemos(init: ReturnType<typeof useAppInit>) {
  const { isDark, pref: colorPref, setPreference: setColorPref } = useColorMode()

  const {
    user, servers, channelsByServer, membersByServer, categoriesByServer,
    storeMessages, presences, unreadCounts, serverPermissions,
    dmList, dmUsers, activeServerId, activeChannelId, dmActive, activeDmId,
    tabbedIds, serverThemes, channelPermissions,
    viewport, userOverrideLeft, userOverrideRight, autoLeftCollapsed, autoRightCollapsed,
    rightPanelMode,
  } = init

  // ── Effective collapse state — userOverride wins, falls back to auto-rule ──
  const effectiveLeftCollapsed =
    userOverrideLeft === 'closed' ? true  :
    userOverrideLeft === 'open'   ? false :
    autoLeftCollapsed
  const effectiveRightCollapsed =
    userOverrideRight === 'closed' ? true  :
    userOverrideRight === 'open'   ? false :
    autoRightCollapsed
  // Mode is preserved while collapsed so re-opening shows the last tab.
  const effectiveRightMode: 'members' | 'pinned' | 'threads' | null =
    effectiveRightCollapsed ? null : (rightPanelMode ?? 'members')

  // ── Presence map ──
  const presenceMap = useMemo(() => new Map(Object.entries(presences)), [presences])

  // ── User info for TabBar/Settings ──
  const userInfo = useMemo(() => {
    if (!user) return undefined
    return {
      displayName: displayName(user),
      username: user.username,
      email: user.email ?? '',
      avatarLetter: avatarLetter(user),
      avatarColor: hashColor(user.id),
      avatarUrl: user.avatar_url
        ? `${getApiBaseUrl()}/avatars/${user.id}?v=${user.avatar_url.split('/').pop()?.split('.')[0] ?? ''}`
        : null,
      bio: user.bio ?? undefined,
      bannerColor: user.banner_color ?? undefined,
    }
  }, [user])

  // ── User profile for new TabBar format ──
  const userProfile = useMemo(() => {
    if (!user) return undefined
    return {
      display_name: displayName(user),
      username: user.username,
      banner_color: user.banner_color ?? hashColor(user.id),
      avatar_url: user.avatar_url
        ? `${getApiBaseUrl()}/avatars/${user.id}?v=${user.avatar_url.split('/').pop()?.split('.')[0] ?? ''}`
        : null,
    }
  }, [user])

  // ── Build user map from server members ──
  const userMap = useMemo(() => {
    const map = new Map<string, User>(dmUsers)
    // Add users from server members
    Object.values(membersByServer).flat().forEach(m => {
      if (m.user && !map.has(m.user.id)) map.set(m.user.id, m.user)
    })
    // Add current user
    if (user) map.set(user.id, user)
    return map
  }, [membersByServer, dmUsers, user])

  // ── Transform: servers → UI ──
  const uiServers = useMemo(() => {
    return servers.map(srv => {
      const chs = channelsByServer[srv.id] ?? []
      const cats = categoriesByServer[srv.id] ?? []
      const mems = membersByServer[srv.id] ?? []
      const memberGroup = transformMemberGroup(mems, userMap, presenceMap)
      const totalUnread = chs.reduce((sum, ch) => sum + (unreadCounts[ch.id] ?? 0), 0)
      return transformServer(srv, chs, cats, memberGroup, totalUnread, unreadCounts)
    })
  }, [servers, channelsByServer, categoriesByServer, membersByServer, userMap, presenceMap, unreadCounts])

  // ── Transform: messages → UI ──
  const effectiveChannelId = dmActive ? activeDmId : activeChannelId
  const currentApiMessages = storeMessages[effectiveChannelId] ?? []
  const uiMessages = useMemo(() => {
    return transformMessages(currentApiMessages, userMap, dmActive)
  }, [currentApiMessages, userMap])

  // ── Transform: DMs → UI ──
  const uiDmList = useMemo<DMConversation[]>(() => {
    if (!user) return []
    return dmList.map(dm => {
      const msgs = storeMessages[dm.id]
      const storeLastMsg = msgs?.[msgs.length - 1] as ApiMessage | undefined
      // Use store message if loaded, otherwise fall back to API's last_message preview
      const lastMsg = storeLastMsg ?? (dm.last_message ? {
        id: dm.last_message.id,
        author_id: dm.last_message.author_id,
        content: dm.last_message.content ?? '',
        nonce: dm.last_message.nonce ?? null,
        created_at: dm.last_message.created_at,
      } as ApiMessage : undefined)
      return transformDmConversation(dm, userMap, presenceMap, user.id, lastMsg, unreadCounts[dm.id])
    })
  }, [dmList, userMap, presenceMap, user, storeMessages, unreadCounts])

  // ── Derived ──
  const tabbedServers = tabbedIds.map(id => uiServers.find(s => s.id === id)).filter(Boolean) as typeof uiServers
  const activeServer = uiServers.find(s => s.id === activeServerId)
  const activeRawServer = servers.find(s => s.id === activeServerId)
  const isServerOwner = !!user && activeRawServer?.owner_id === user.id
  const myPerms = serverPermissions[activeServerId] ?? 0
  const canAccessSettings = isServerOwner || hasPermission(myPerms, MANAGE_SERVER) || hasPermission(myPerms, MANAGE_CHANNELS) || hasPermission(myPerms, MANAGE_ROLES)
  const canManageChannels = isServerOwner || hasPermission(myPerms, MANAGE_CHANNELS)
  const canEditTheme = isServerOwner || hasPermission(myPerms, MANAGE_SERVER)

  // Channel-level permissions (account for channel overwrites, fall back to server perms)
  const chanPerms = (!dmActive && activeChannelId) ? (channelPermissions[activeChannelId] ?? myPerms) : 0
  const canManageMessages = dmActive || isServerOwner || hasPermission(chanPerms, MANAGE_MESSAGES)
  const canAddReactions   = dmActive || isServerOwner || hasPermission(chanPerms, ADD_REACTIONS)
  const canSendMessages   = dmActive || isServerOwner || hasPermission(chanPerms, SEND_MESSAGES)
  const canAttachFiles    = dmActive || isServerOwner || hasPermission(chanPerms, ATTACH_FILES)

  // Per-server invite permission for the "invite to server" list in UserContextMenu
  const inviteableServerIds = useMemo(() => servers.filter(srv => {
    if (user && srv.owner_id === user.id) return true
    const p = serverPermissions[srv.id] ?? 0
    return hasPermission(p, CREATE_INVITE)
  }).map(s => s.id), [servers, user, serverPermissions])

  const ownerServerIds = useMemo(() => user ? servers.filter(s => s.owner_id === user.id).map(s => s.id) : [], [servers, user])
  const settingsServerIds = useMemo(() => servers.filter(srv => {
    if (user && srv.owner_id === user.id) return true
    const p = serverPermissions[srv.id] ?? 0
    return hasPermission(p, MANAGE_SERVER) || hasPermission(p, MANAGE_CHANNELS) || hasPermission(p, MANAGE_ROLES)
  }).map(s => s.id), [servers, user, serverPermissions])
  const activeTheme = useMemo(() =>
    dmActive
      ? { hue: null, orbs: [] as import('../../types/ui').ThemeOrb[] }
      : (serverThemes[activeServerId] ?? { hue: null, orbs: [] as import('../../types/ui').ThemeOrb[] }),
    [dmActive, activeServerId, serverThemes]
  )
  const themeKey = dmActive ? '__dm__' : activeServerId
  const chatAnimKey = dmActive ? activeDmId : `${activeServerId}:${activeChannelId}`
  const typingUsers = useTypingUsers(effectiveChannelId, user?.id)

  const appStyle = useAnimatedTheme(themeKey, activeTheme, isDark)

  const activeDmConv = uiDmList.find(d => d.id === activeDmId)

  // Check if DM partner is a system user (announcements only — no sending/reacting)
  const isDmWithSystemUser = useMemo(() => {
    if (!dmActive || !activeDmId || !user) return false
    const dm = dmList.find(d => d.id === activeDmId)
    if (!dm || dm.is_group) return false
    const otherId = dm.members.find(id => id !== user.id)
    if (!otherId) return false
    const otherUser = userMap.get(otherId)
    return otherUser?.is_system === true
  }, [dmActive, activeDmId, dmList, user, userMap])

  const activeChannel: ChannelDisplay = dmActive
    ? (activeDmConv
      ? { id: 'main', name: activeDmConv.name ?? activeDmConv.participants[0]?.name ?? 'DM', icon: '@', desc: '', unread: 0 }
      : { id: '', name: 'Direct Messages', icon: '@', desc: '', unread: 0 })
    : (activeServer?.channels.find(c => c.id === activeChannelId) ?? activeServer?.channels[0] ?? { id: '', name: 'No channel', icon: '#', desc: '', unread: 0 })

  // Empty channels/DMs show a true empty-state placeholder rendered by ChatArea
  // itself — keeping the message list genuinely empty avoids a synthetic
  // "system" message that picks up hover affordances (reply / more / delete).
  const displayMessages = uiMessages

  // ── Mentionable users for current channel ──
  const mentionableUsers = useMemo(() => {
    if (dmActive) return []
    const members = membersByServer[activeServerId] ?? []
    return members.flatMap(m =>
      m.user?.username ? [{ id: m.user_id, username: m.user.username }] : []
    )
  }, [dmActive, activeServerId, membersByServer])

  return {
    isDark, colorPref, setColorPref,
    presenceMap, userInfo, userProfile, userMap,
    uiServers, effectiveChannelId, currentApiMessages, uiMessages, uiDmList,
    tabbedServers, activeServer, activeRawServer, isServerOwner, myPerms,
    canAccessSettings, canManageChannels, canEditTheme,
    canManageMessages, canAddReactions, canSendMessages, canAttachFiles,
    inviteableServerIds, ownerServerIds, settingsServerIds,
    activeTheme, chatAnimKey, typingUsers, appStyle, activeDmConv,
    isDmWithSystemUser, activeChannel, displayMessages,
    mentionableUsers,
    viewport, effectiveLeftCollapsed, effectiveRightCollapsed, effectiveRightMode,
  }
}
