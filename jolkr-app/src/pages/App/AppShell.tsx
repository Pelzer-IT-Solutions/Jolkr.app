import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { Channel, ServerTheme, ReplyRef, DMConversation } from '../../types/ui'
import { useAuthStore } from '../../stores/auth'
import { useServersStore } from '../../stores/servers'
import { useMessagesStore } from '../../stores/messages'
import { usePresenceStore } from '../../stores/presence'
import { useUnreadStore } from '../../stores/unread'
import { useTypingUsers } from '../../stores/typing'
import { wsClient } from '../../api/ws'
import * as api from '../../api/client'
import { getApiBaseUrl } from '../../platform/config'
import {
  transformServer,
  transformMessages,
  transformMemberGroup,
  transformDmConversation,
  hashColor,
  avatarLetter,
} from '../../adapters/transforms'
import { getLocalKeys } from '../../services/e2ee'
import { encryptChannelMessage } from '../../crypto/channelKeys'
import { orbsForHue } from '../../utils/theme'
import { useAnimatedTheme } from '../../utils/useAnimatedTheme'
import { useColorMode } from '../../utils/colorMode'
import { hasPermission, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_SERVER, KICK_MEMBERS, BAN_MEMBERS } from '../../utils/permissions'

import { TabBar } from '../../components/TabBar/TabBar'
import { ChannelSidebar } from '../../components/ChannelSidebar/ChannelSidebar'
import { DMSidebar } from '../../components/DMSidebar/DMSidebar'
import { ChatArea } from '../../components/ChatArea/ChatArea'
import { MemberPanel } from '../../components/MemberPanel/MemberPanel'
import { DMInfoPanel } from '../../components/DMInfoPanel/DMInfoPanel'
import { Settings } from '../../components/Settings/Settings'
import { NewDMModal } from '../../components/NewDMModal/NewDMModal'
import { JoinServerModal } from '../../components/JoinServerModal/JoinServerModal'
import { CreateServerModal } from '../../components/CreateServerModal/CreateServerModal'
import { NotificationsPanel } from '../../components/NotificationsPanel/NotificationsPanel'
import { PinnedMessagesPanel } from '../../components/PinnedMessagesPanel/PinnedMessagesPanel'
import { FriendsPanel } from '../../components/FriendsPanel'
import { ServerSettings } from '../../components/ServerSettings/ServerSettings'
import { ReportModal } from '../../components/ReportModal'
import { UserContextMenu } from '../../components/UserContextMenu'
import type { UserContextMenuState } from '../../components/UserContextMenu/UserContextMenu'
import type { MemberDisplay } from '../../types/ui'

import type { DmChannel, User, Message as ApiMessage } from '../../api/types'

import s from '../../components/AppShell/AppShell.module.css'

export default function AppShell() {
  const { isDark, pref: colorPref, setPreference: setColorPref } = useColorMode()
  const navigate = useNavigate()
  const location = useLocation()

  // ── Backend state from stores ──
  const user = useAuthStore(s => s.user)
  const servers = useServersStore(s => s.servers)
  const channelsByServer = useServersStore(s => s.channels)
  const membersByServer = useServersStore(s => s.members)
  const categoriesByServer = useServersStore(s => s.categories)
  const storeMessages = useMessagesStore(s => s.messages)
  const presences = usePresenceStore(s => s.statuses)
  const unreadCounts = useUnreadStore(s => s.counts)
  const serverPermissions = useServersStore(s => s.permissions)
  const { fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions } = useServersStore.getState()
  const { fetchMessages, sendMessage, sendDmMessage, editMessage, deleteMessage } = useMessagesStore.getState()

  // ── DMs ──
  const [dmList, setDmList] = useState<DmChannel[]>([])
  const [dmUsers, setDmUsers] = useState<Map<string, User>>(new Map())

  // ── UI state ──
  const [tabbedIds, setTabbedIds] = useState<string[]>([])
  const [activeServerId, setActiveServerId] = useState('')
  const [activeChannelId, setActiveChannelId] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [membersVisible, setMembersVisible] = useState(true)
  const [dmActive, setDmActive] = useState(false)
  const [activeDmId, setActiveDmId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newDmOpen, setNewDmOpen] = useState(false)
  const [joinServerOpen, setJoinServerOpen] = useState(false)
  const [createServerOpen, setCreateServerOpen] = useState(false)
  const [searchActive, setSearchActive] = useState(false)
  const [notificationsActive, setNotificationsActive] = useState(false)
  const [friendsPanelOpen, setFriendsPanelOpen] = useState(false)
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false)
  const [reportTarget, setReportTarget] = useState<MemberDisplay | null>(null)
  const [userContextMenu, setUserContextMenu] = useState<UserContextMenuState | null>(null)
  const [pinnedPanelOpen, setPinnedPanelOpen] = useState(false)

  const lastChannelPerServer = useRef<Record<string, string>>({})
  const [ready, setReady] = useState(false)

  // ── Per-server themes ──
  const [serverThemes, setServerThemes] = useState<Record<string, ServerTheme>>({})

  // ── Init: fetch servers + DMs, then navigate to correct place ──
  useEffect(() => {
    let cancelled = false

    async function init() {
      // ── Parse URL FIRST — we need to know where to go ──
      const path = location.pathname
      const urlDmId = path.match(/\/dm\/([^/]+)/)?.[1]
      const urlServerId = path.match(/\/servers\/([^/]+)/)?.[1]
      const urlChannelId = path.match(/\/servers\/[^/]+\/channels\/([^/]+)/)?.[1]

      // Fetch servers and DMs in parallel
      const [, dms] = await Promise.all([
        fetchServers(),
        api.getDms(),
      ])
      if (cancelled) return

      setDmList(dms)

      // DM user details — fire & forget, don't block init
      const userIds = new Set<string>()
      dms.forEach(dm => dm.members.forEach(id => userIds.add(id)))
      if (userIds.size > 0) {
        const idArr = Array.from(userIds)
        Promise.all(
          idArr.map(id => api.getUser(id).catch(() => null))
        ).then(users => {
          if (cancelled) return
          const map = new Map<string, User>()
          users.forEach(u => { if (u) map.set(u.id, u) })
          setDmUsers(map)
        })
        // Fetch presence for DM participants
        api.queryPresence(idArr).then(p => {
          if (!cancelled) usePresenceStore.getState().setBulk(p)
        }).catch(console.warn)
      }

      const srvs = useServersStore.getState().servers
      const themes: Record<string, ServerTheme> = {}
      srvs.forEach(srv => { themes[srv.id] = { hue: null, orbs: [] } })
      setServerThemes(themes)

      const ids = srvs.slice(0, 5).map(s => s.id)

      if (urlDmId) {
        setDmActive(true)
        setActiveDmId(urlDmId)
        setTabbedIds(ids)
        // Load first server data in background — don't block
        if (ids[0]) {
          setActiveServerId(ids[0])
          loadServerData(ids[0], null) // no await
        }
      } else if (urlServerId && srvs.some(s => s.id === urlServerId)) {
        if (!ids.includes(urlServerId)) ids.unshift(urlServerId)
        setTabbedIds(ids)
        setDmActive(false)
        setActiveServerId(urlServerId)
        await loadServerData(urlServerId, urlChannelId ?? null)
      } else if (srvs.length > 0) {
        setTabbedIds(ids)
        setDmActive(false)
        setActiveServerId(ids[0])
        await loadServerData(ids[0], null)
        if (!cancelled) navigate(`/servers/${ids[0]}`, { replace: true })
      } else if (dms.length > 0) {
        setTabbedIds([])
        setDmActive(true)
        setActiveDmId(dms[0].id)
        if (!cancelled) navigate(`/dm/${dms[0].id}`, { replace: true })
      }

      if (!cancelled) setReady(true)
    }

    async function loadServerData(serverId: string, wantedChannelId: string | null) {
      await Promise.all([
        fetchChannels(serverId),
        fetchMembers(serverId),
        fetchCategories(serverId),
        fetchPermissions(serverId),
      ])
      if (cancelled) return
      const chs = useServersStore.getState().channels[serverId]
      if (chs?.length > 0) {
        const channelId = wantedChannelId && chs.some(c => c.id === wantedChannelId)
          ? wantedChannelId
          : chs.find(c => c.kind === 'text')?.id ?? chs[0].id
        setActiveChannelId(channelId)
      }
      // Fetch presence for all server members
      const mems = useServersStore.getState().members[serverId]
      if (mems?.length) {
        const userIds = mems.map(m => m.user_id)
        api.queryPresence(userIds).then(p => {
          if (!cancelled) usePresenceStore.getState().setBulk(p)
        }).catch(console.warn)
      }
    }

    init().catch(console.error)
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync state → URL (only AFTER init is done) ──
  useEffect(() => {
    if (!ready) return
    let target: string
    if (dmActive && activeDmId) {
      target = `/dm/${activeDmId}`
    } else if (activeServerId && activeChannelId) {
      target = `/servers/${activeServerId}/channels/${activeChannelId}`
    } else if (activeServerId) {
      target = `/servers/${activeServerId}`
    } else {
      target = '/'
    }
    if (location.pathname !== target) {
      navigate(target, { replace: true })
    }
  }, [ready, dmActive, activeDmId, activeServerId, activeChannelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch channel data when switching servers (after init) ──
  useEffect(() => {
    if (!ready || !activeServerId || dmActive) return
    Promise.all([
      fetchChannels(activeServerId),
      fetchMembers(activeServerId),
      fetchCategories(activeServerId),
      fetchPermissions(activeServerId),
    ]).then(() => {
      const mems = useServersStore.getState().members[activeServerId]
      if (mems?.length) {
        api.queryPresence(mems.map(m => m.user_id)).then(p => {
          usePresenceStore.getState().setBulk(p)
        }).catch(console.warn)
      }
    })
  }, [activeServerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Safety: if active server disappears (deleted/left), fall back ──
  useEffect(() => {
    if (!ready || dmActive) return
    if (activeServerId && servers.length > 0 && !servers.some(s => s.id === activeServerId)) {
      // Server gone — switch to first available
      const fallback = tabbedIds.find(id => servers.some(s => s.id === id)) ?? servers[0]?.id
      if (fallback) {
        setTabbedIds(prev => prev.filter(id => servers.some(s => s.id === id)))
        setActiveServerId(fallback)
        const chs = channelsByServer[fallback]
        setActiveChannelId(chs?.find(c => c.kind === 'text')?.id ?? chs?.[0]?.id ?? '')
      } else {
        // No servers left → go to DMs
        setDmActive(true)
        setTabbedIds([])
        if (dmList.length > 0) setActiveDmId(dmList[0].id)
      }
    }
  }, [ready, servers, dmActive, activeServerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch messages when channel changes ──
  useEffect(() => {
    const channelId = dmActive ? activeDmId : activeChannelId
    if (!channelId) return
    fetchMessages(channelId, dmActive)

    // Mark as read locally
    const prevUnread = useUnreadStore.getState().counts[channelId] ?? 0
    useUnreadStore.getState().setActiveChannel(channelId)

    // If there were unread messages in a server channel, tell the backend
    if (prevUnread > 0 && !dmActive) {
      const msgs = useMessagesStore.getState().messages[channelId]
      const lastMsg = msgs?.[msgs.length - 1]
      if (lastMsg) {
        api.markChannelRead(channelId, lastMsg.id).catch(console.warn)
      }
    }

    return () => {
      useUnreadStore.getState().setActiveChannel(null)
    }
  }, [dmActive ? activeDmId : activeChannelId, dmActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── WS channel subscribe/unsubscribe ──
  useEffect(() => {
    const channelId = dmActive ? activeDmId : activeChannelId
    if (!channelId) return
    wsClient.subscribe(channelId)
    return () => { wsClient.unsubscribe(channelId) }
  }, [dmActive ? activeDmId : activeChannelId, dmActive]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Presence map ──
  const presenceMap = useMemo(() => new Map(Object.entries(presences)), [presences])

  // ── User info for TabBar/Settings ──
  const userInfo = useMemo(() => {
    if (!user) return undefined
    return {
      displayName: user.display_name || user.username,
      username: user.username,
      email: user.email ?? '',
      avatarLetter: avatarLetter(user),
      avatarColor: hashColor(user.id),
      avatarUrl: user.avatar_url ? `${getApiBaseUrl()}/avatars/${user.id}` : null,
    }
  }, [user])

  // ── User profile for new TabBar format ──
  const userProfile = useMemo(() => {
    if (!user) return undefined
    return {
      display_name: user.display_name || user.username,
      username: user.username,
      banner_color: hashColor(user.id),
      avatar_url: user.avatar_url ? `${getApiBaseUrl()}/avatars/${user.id}` : null,
    }
  }, [user])

  // ── Muted servers (UI-only local state, no backend yet) ──
  const [mutedServerIds, setMutedServerIds] = useState<string[]>([])
  const handleToggleMuteServer = useCallback((serverId: string) => {
    setMutedServerIds(prev =>
      prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]
    )
  }, [])

  // ── Logout handler ──
  const handleLogout = useCallback(async () => {
    await useAuthStore.getState().logout()
    navigate('/login')
  }, [navigate])

  // ── Status change handler ──
  const handleStatusChange = useCallback((status: string) => {
    if (user?.id) usePresenceStore.getState().setStatus(user.id, status)
    wsClient.updatePresence(status)
  }, [user?.id])

  // ── Profile update handler ──
  const handleUpdateProfile = useCallback(async (data: { display_name?: string; username?: string }) => {
    await useAuthStore.getState().updateProfile(data)
  }, [])

  // ── Avatar upload handler ──
  const handleUploadAvatar = useCallback(async (file: File) => {
    const { key } = await api.uploadFile(file, 'avatar')
    // Store the S3 key — the avatar is served via /api/avatars/:userId (no presigned URL)
    await useAuthStore.getState().updateProfile({ avatar_url: key })
  }, [])

  // ── Password change handler ──
  const handleChangePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.changePassword(currentPassword, newPassword)
  }, [])

  // ── Typing indicator (throttled) ──
  const lastTypingRef = useRef(0)
  const handleTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingRef.current < 3000) return // throttle 3s
    lastTypingRef.current = now
    const channelId = dmActive ? activeDmId : activeChannelId
    if (channelId) wsClient.sendTyping(channelId)
  }, [dmActive, activeDmId, activeChannelId])

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
      const lastMsg = msgs?.[msgs.length - 1] as ApiMessage | undefined
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
  const ownerServerIds = useMemo(() => user ? servers.filter(s => s.owner_id === user.id).map(s => s.id) : [], [servers, user])
  const settingsServerIds = useMemo(() => servers.filter(srv => {
    if (user && srv.owner_id === user.id) return true
    const p = serverPermissions[srv.id] ?? 0
    return hasPermission(p, MANAGE_SERVER) || hasPermission(p, MANAGE_CHANNELS) || hasPermission(p, MANAGE_ROLES)
  }).map(s => s.id), [servers, user, serverPermissions])
  const activeTheme = serverThemes[activeServerId] ?? { hue: null, orbs: [] }
  const chatAnimKey = dmActive ? activeDmId : `${activeServerId}:${activeChannelId}`
  const typingUsers = useTypingUsers(effectiveChannelId, user?.id)

  const appStyle = useAnimatedTheme(activeServerId, activeTheme, isDark)

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

  const activeChannel: Channel = dmActive && activeDmConv
    ? { id: 'main', name: activeDmConv.name ?? activeDmConv.participants[0]?.name ?? 'DM', icon: '@', desc: '', unread: 0 }
    : (activeServer?.channels.find(c => c.id === activeChannelId) ?? activeServer?.channels[0] ?? { id: '', name: 'No channel', icon: '#', desc: '', unread: 0 })

  const fallbackMessages = useMemo(() => [{
    id: 'welcome',
    continued: false,
    author: 'Jolkr',
    color: 'oklch(60% 0.18 136.69)',
    letter: 'J',
    time: 'Today',
    content: dmActive
      ? `Start a conversation with ${activeDmConv?.name ?? activeDmConv?.participants[0]?.name ?? 'someone'}!`
      : `Welcome to #${activeChannelId}! Be the first to say something.`,
    reactions: [],
    edited: false,
  }], [dmActive, activeDmConv, activeChannelId])

  const displayMessages = uiMessages.length > 0 ? uiMessages : fallbackMessages

  // ── Handlers ──

  function handleSwitchServer(id: string) {
    if (id === activeServerId) return
    lastChannelPerServer.current[activeServerId] = activeChannelId
    setActiveServerId(id)
    const srv = uiServers.find(s => s.id === id)
    const saved = lastChannelPerServer.current[id]
    const channelExists = saved && srv?.channels.some(c => c.id === saved)
    setActiveChannelId(channelExists ? saved : (srv?.channels[0]?.id ?? ''))
  }

  function handleCloseTab(id: string) {
    if (tabbedIds.length === 1) return
    const idx = tabbedIds.indexOf(id)
    const next = tabbedIds.filter(t => t !== id)
    setTabbedIds(next)
    if (activeServerId === id) {
      const fallbackId = next[Math.max(0, idx - 1)]
      setActiveServerId(fallbackId)
      const srv = uiServers.find(s => s.id === fallbackId)
      setActiveChannelId(srv?.channels[0]?.id ?? '')
    }
  }

  function handleOpenServer(id: string) {
    if (!tabbedIds.includes(id)) {
      setTabbedIds(prev => [id, ...prev])
    }
    handleSwitchServer(id)
  }

  function handleSwitchChannel(id: string) {
    if (id === activeChannelId) return
    setActiveChannelId(id)
  }

  const handleSend = useCallback(async (text: string, replyTo?: ReplyRef) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    const isDm = dmActive
    const localKeys = getLocalKeys()

    if (!localKeys) {
      console.error('E2EE keys not available — cannot send message')
      return
    }

    // Get member IDs for key distribution (first message in channel creates the key)
    const getMemberIds = async () => {
      if (isDm) {
        const dm = dmList.find(d => d.id === channelId)
        return dm?.members ?? []
      }
      const members = membersByServer[activeServerId] ?? []
      return members.map(m => m.user_id)
    }

    const encrypted = await encryptChannelMessage(channelId, localKeys, text, getMemberIds, isDm)
    if (!encrypted) {
      console.error('E2EE encryption failed — cannot send message')
      return
    }

    // content = encrypted ciphertext, nonce = encryption nonce
    if (isDm) {
      sendDmMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce)
    } else {
      sendMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce)
    }
  }, [dmActive, activeDmId, activeChannelId, activeServerId, dmList, membersByServer]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleReaction = useCallback((msgId: string, emoji: string) => {
    // Check if user already reacted
    const msg = currentApiMessages.find(m => m.id === msgId)
    const existing = msg?.reactions?.find(r => r.emoji === emoji)
    if (existing?.me) {
      api.removeReaction(msgId, emoji).catch(console.error)
    } else {
      api.addReaction(msgId, emoji).catch(console.error)
    }
  }, [currentApiMessages])

  const handleDeleteMessage = useCallback((msgId: string) => {
    deleteMessage(msgId, effectiveChannelId, dmActive)
  }, [effectiveChannelId, dmActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditMessage = useCallback((msgId: string, newText: string) => {
    editMessage(msgId, effectiveChannelId, newText, dmActive)
  }, [effectiveChannelId, dmActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePinMessage = useCallback(async (msgId: string) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    const msg = currentApiMessages.find(m => m.id === msgId)
    if (!msg) return
    try {
      if (msg.is_pinned) {
        if (dmActive) await api.unpinDmMessage(channelId, msgId)
        else await api.unpinMessage(channelId, msgId)
      } else {
        if (dmActive) await api.pinDmMessage(channelId, msgId)
        else await api.pinMessage(channelId, msgId)
      }
    } catch (err) {
      console.error('Pin toggle failed:', err)
    }
  }, [dmActive, activeDmId, activeChannelId, currentApiMessages])

  const handleUnpinMessage = useCallback(async (msgId: string) => {
    const channelId = dmActive ? activeDmId : activeChannelId
    try {
      if (dmActive) await api.unpinDmMessage(channelId, msgId)
      else await api.unpinMessage(channelId, msgId)
    } catch (err) {
      console.error('Unpin failed:', err)
    }
  }, [dmActive, activeDmId, activeChannelId])

  function handleThemeChange(theme: ServerTheme) {
    setServerThemes(prev => ({ ...prev, [activeServerId]: theme }))
  }

  // ── Channel CRUD handlers ──
  const handleCreateChannel = useCallback(async (name: string, kind: 'text' | 'voice') => {
    await api.createChannel(activeServerId, { name, kind })
    await fetchChannels(activeServerId)
  }, [activeServerId])

  const handleCreateCategory = useCallback(async (name: string) => {
    await api.createCategory(activeServerId, { name })
    await fetchCategories(activeServerId)
    await fetchChannels(activeServerId)
  }, [activeServerId])

  const handleDeleteChannel = useCallback(async (channelId: string) => {
    await api.deleteChannel(channelId)
    await fetchChannels(activeServerId)
    if (channelId === activeChannelId) {
      const chs = useServersStore.getState().channels[activeServerId]
      setActiveChannelId(chs?.find(c => c.kind === 'text')?.id ?? chs?.[0]?.id ?? '')
    }
  }, [activeServerId, activeChannelId])

  async function handleJoinServer(serverId: string, _accessCode: string): Promise<boolean> {
    try {
      await api.useInvite(serverId)
      await fetchServers()
      handleOpenServer(serverId)
      setJoinServerOpen(false)
      return true
    } catch {
      return false
    }
  }

  async function handleCreateServer(data: { name: string; icon: string; color: string; hue?: number; privacy: 'public' | 'private' }) {
    try {
      const server = await api.createServer({ name: data.name, description: '' })
      await fetchServers()
      const newTheme: ServerTheme = data.hue != null
        ? { hue: data.hue, orbs: orbsForHue(data.hue) }
        : { hue: null, orbs: [] }
      setServerThemes(prev => ({ ...prev, [server.id]: newTheme }))
      setTabbedIds(prev => [...prev, server.id])
      setDmActive(false)
      setActiveServerId(server.id)
      setActiveChannelId('')
      setCreateServerOpen(false)
    } catch (e) {
      console.error('Failed to create server:', e)
    }
  }

  async function handleCreateDm(names: string[]) {
    try {
      for (const name of names) {
        const found = await api.searchUsers(name)
        const foundUser = found.find(u => u.username === name || u.display_name === name)
        if (foundUser) {
          const dm = await api.openDm(foundUser.id)
          const dms = await api.getDms()
          setDmList(dms)
          // Add all DM members to user map so names resolve immediately
          setDmUsers(prev => {
            const next = new Map(prev)
            next.set(foundUser.id, foundUser)
            // Also fetch any other members we don't have yet
            for (const memberId of dm.members) {
              if (!next.has(memberId)) {
                api.getUser(memberId).then(u => {
                  if (u) setDmUsers(p => new Map(p).set(u.id, u))
                }).catch(() => {})
              }
            }
            return next
          })
          setActiveDmId(dm.id)
          setDmActive(true)
        }
      }
    } catch (e) {
      console.error('Failed to create DM:', e)
    }
    setNewDmOpen(false)
  }

  // ── Render ──

  if (!ready) {
    return (
      <div className={s.app} style={appStyle}>
        <div className={s.splash}>
          <img src="/icon.svg" alt="Jolkr" className={s.splashLogo} />
          <div className={s.splashSpinner} />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={s.app} style={appStyle}>
        <TabBar
          allServers={uiServers}
          tabbedServers={tabbedServers}
          activeServerId={dmActive ? '' : activeServerId}
          dmActive={dmActive}
          searchActive={searchActive}
          notificationsActive={notificationsActive}
          user={userInfo}
          userProfile={userProfile}
          mutedServerIds={mutedServerIds}
          currentUserId={user?.id ?? ''}
          currentStatus={(user?.id ? presences[user.id] : undefined) as 'online' | 'idle' | 'dnd' | 'offline' | undefined}
          ownerServerIds={ownerServerIds}
          onSwitch={id => { setDmActive(false); handleSwitchServer(id) }}
          onClose={handleCloseTab}
          onReorder={setTabbedIds}
          onOpenServer={id => { setDmActive(false); handleOpenServer(id) }}
          onDmClick={() => { setDmActive(v => !v); setNotificationsActive(false) }}
          onSearchClick={() => setSearchActive(v => !v)}
          onNotificationsClick={() => setNotificationsActive(v => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
          onJoinServer={() => setJoinServerOpen(true)}
          onCreateServer={() => setCreateServerOpen(true)}
          onLogout={handleLogout}
          onStatusChange={handleStatusChange}
          onToggleMuteServer={handleToggleMuteServer}
          onMarkAllRead={async (serverId) => {
            try {
              await api.markServerRead(serverId)
              const chs = channelsByServer[serverId] ?? []
              useUnreadStore.getState().markServerRead(chs.map(c => c.id))
            } catch (err) {
              console.error('Mark server read failed:', err)
            }
          }}
          settingsServerIds={settingsServerIds}
          onOpenServerSettings={serverId => { handleSwitchServer(serverId); setServerSettingsOpen(true) }}
        />

        <div className={s.contentRow}>
          <div className={s.shell}>
            <div className={s.workspace}>
              {!dmActive && !activeServer ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', opacity: 0.5 }}>
                  <div style={{ fontSize: '3rem' }}>👋</div>
                  <h2 className="txt-body txt-semibold">Welcome to Jolkr</h2>
                  <p className="txt-small">Join or create a server to get started, or send a direct message.</p>
                </div>
              ) : dmActive ? (
                <DMSidebar
                  conversations={uiDmList}
                  activeId={activeDmId}
                  onSelect={setActiveDmId}
                  onNewMessage={() => setNewDmOpen(true)}
                  onOpenFriends={() => setFriendsPanelOpen(true)}
                />
              ) : activeServer ? (
                <ChannelSidebar
                  server={activeServer}
                  activeChannelId={activeChannelId}
                  onSwitch={handleSwitchChannel}
                  onCollapse={() => setSidebarCollapsed(true)}
                  collapsed={sidebarCollapsed}
                  theme={activeTheme}
                  onThemeChange={handleThemeChange}
                  isDark={isDark}
                  colorPref={colorPref}
                  onSetColorPref={setColorPref}
                  onOpenSettings={canAccessSettings ? () => setServerSettingsOpen(true) : undefined}
                  canManageChannels={canManageChannels}
                  onCreateChannel={canManageChannels ? handleCreateChannel : undefined}
                  onCreateCategory={canManageChannels ? handleCreateCategory : undefined}
                  onDeleteChannel={canManageChannels ? handleDeleteChannel : undefined}
                />
              ) : null}

              <ChatArea
                channel={activeChannel}
                messages={displayMessages}
                sidebarCollapsed={dmActive ? false : sidebarCollapsed}
                membersVisible={membersVisible}
                onExpandSidebar={() => setSidebarCollapsed(false)}
                onToggleMembers={() => setMembersVisible(v => !v)}
                onSend={handleSend}
                onToggleReaction={handleToggleReaction}
                onDeleteMessage={handleDeleteMessage}
                onEditMessage={handleEditMessage}
                isDm={dmActive}
                dmConversation={dmActive ? activeDmConv : undefined}
                animationKey={chatAnimKey}
                onTyping={handleTyping}
                typingUsers={typingUsers}
                onLoadOlder={() => {
                  const { fetchOlder, loadingOlder } = useMessagesStore.getState()
                  const channelId = dmActive ? activeDmId : activeChannelId
                  if (!loadingOlder[channelId]) fetchOlder(channelId, dmActive)
                }}
                hasMore={useMessagesStore.getState().hasMore[dmActive ? activeDmId : activeChannelId] ?? true}
                readOnly={isDmWithSystemUser}
                onPinMessage={handlePinMessage}
                onTogglePinPanel={() => setPinnedPanelOpen(v => !v)}
                pinnedPanelOpen={pinnedPanelOpen}
              />

              {pinnedPanelOpen && (
                <PinnedMessagesPanel
                  channelId={effectiveChannelId}
                  isDm={dmActive}
                  onClose={() => setPinnedPanelOpen(false)}
                  onUnpin={handleUnpinMessage}
                />
              )}

              {dmActive ? (
                <DMInfoPanel visible={membersVisible} />
              ) : activeServer ? (
                <MemberPanel
                  members={activeServer.members}
                  visible={membersVisible}
                  serverId={activeServerId}
                  onMemberClick={(member, e) => {
                    if (!member.userId) return
                    const u = userMap.get(member.userId)
                    setUserContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      user: {
                        user_id: member.userId,
                        username: u?.username ?? member.name,
                        display_name: u?.display_name ?? member.name,
                        status: member.status,
                        color: member.color,
                        letter: member.letter,
                        avatar_url: member.avatarUrl,
                      },
                    })
                  }}
                />
              ) : null}
            </div>
          </div>

          {notificationsActive && (
            <NotificationsPanel
              onNavigate={(serverId, channelId) => {
                setDmActive(false)
                if (!tabbedIds.includes(serverId)) {
                  setTabbedIds(prev => [serverId, ...prev])
                }
                setActiveServerId(serverId)
                setActiveChannelId(channelId)
              }}
            />
          )}
        </div>
      </div>

      {settingsOpen && (
        <Settings
          onClose={() => setSettingsOpen(false)}
          isDark={isDark}
          colorPref={colorPref}
          onSetColorPref={setColorPref}
          user={userInfo}
          onLogout={handleLogout}
          onUpdateProfile={handleUpdateProfile}
          onUploadAvatar={handleUploadAvatar}
          onChangePassword={handleChangePassword}
        />
      )}

      {newDmOpen && (
        <NewDMModal
          onClose={() => setNewDmOpen(false)}
          onCreate={handleCreateDm}
          existingDms={uiDmList}
        />
      )}

      {joinServerOpen && (
        <JoinServerModal
          onClose={() => setJoinServerOpen(false)}
          onJoin={handleJoinServer}
        />
      )}

      {createServerOpen && (
        <CreateServerModal
          onClose={() => setCreateServerOpen(false)}
          onCreate={handleCreateServer}
        />
      )}

      <FriendsPanel
        isOpen={friendsPanelOpen}
        onClose={() => setFriendsPanelOpen(false)}
        onStartDM={async (userId) => {
          const dm = await api.openDm(userId)
          const dms = await api.getDms()
          setDmList(dms)
          setActiveDmId(dm.id)
          setDmActive(true)
          setFriendsPanelOpen(false)
        }}
        onAcceptRequest={async (id) => { await api.acceptFriend(id) }}
        onRejectRequest={async (id) => { await api.declineFriend(id) }}
        onRemoveFriend={async (id) => { await api.declineFriend(id) }}
      />

      {serverSettingsOpen && activeServer && (() => {
        const rawServer = servers.find(s => s.id === activeServerId)
        if (!rawServer) return null
        return (
        <ServerSettings
          server={{
            ...rawServer,
            hue: serverThemes[activeServerId]?.hue ?? null,
            discoverable: false,
          }}
          onClose={() => setServerSettingsOpen(false)}
          onUpdate={async (serverId, data) => {
            await api.updateServer(serverId, { name: data.name, description: data.description ?? undefined })
            fetchServers()
          }}
          onDelete={async (serverId) => {
            await api.deleteServer(serverId)
            setServerSettingsOpen(false)
            await fetchServers() // safety effect handles fallback
          }}
          onLeave={async (serverId) => {
            await api.leaveServer(serverId)
            setServerSettingsOpen(false)
            await fetchServers() // safety effect handles fallback
          }}
        />
        )
      })()}

      <ReportModal
        isOpen={reportTarget !== null}
        onClose={() => setReportTarget(null)}
        user={reportTarget}
      />

      <UserContextMenu
        menu={userContextMenu}
        onClose={() => setUserContextMenu(null)}
        onReport={() => {
          if (userContextMenu) setReportTarget(userContextMenu.user)
          setUserContextMenu(null)
        }}
        onAddFriend={async (userId: string) => {
          await api.sendFriendRequest(userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        onBlock={async (userId: string) => {
          await api.blockUser(userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        onInviteToServer={async (_userId: string, serverId: string) => {
          const invite = await api.createInvite(serverId, { max_uses: 1 }).catch(() => null)
          if (invite) {
            // Copy invite link to clipboard
            const url = `${window.location.origin}/invite/${invite.code}`
            navigator.clipboard.writeText(url).catch(console.warn)
          }
          setUserContextMenu(null)
        }}
        canKick={!dmActive && (isServerOwner || hasPermission(myPerms, KICK_MEMBERS))}
        canBan={!dmActive && (isServerOwner || hasPermission(myPerms, BAN_MEMBERS))}
        onKick={async (userId: string) => {
          if (activeServerId) await api.kickMember(activeServerId, userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        onBan={async (userId: string) => {
          if (activeServerId) await api.banMember(activeServerId, userId).catch(console.warn)
          setUserContextMenu(null)
        }}
        servers={servers.map(s => ({ ...s, hue: serverThemes[s.id]?.hue ?? null }))}
      />
    </>
  )
}
