import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { ServerTheme } from '../../types/ui'
import { useAuthStore } from '../../stores/auth'
import { useServersStore } from '../../stores/servers'
import { useMessagesStore } from '../../stores/messages'
import { usePresenceStore } from '../../stores/presence'
import { useUnreadStore } from '../../stores/unread'
import { wsClient } from '../../api/ws'
import * as api from '../../api/client'

import type { DmChannel, User } from '../../api/types'
import type { UserContextMenuState } from '../../components/UserContextMenu/UserContextMenu'
import type { MemberDisplay } from '../../types/ui'

export function useAppInit() {
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

  return {
    navigate, location,
    user, servers, channelsByServer, membersByServer, categoriesByServer,
    storeMessages, presences, unreadCounts, serverPermissions,
    fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions,
    fetchMessages, sendMessage, sendDmMessage, editMessage, deleteMessage,
    dmList, setDmList, dmUsers, setDmUsers,
    tabbedIds, setTabbedIds, activeServerId, setActiveServerId,
    activeChannelId, setActiveChannelId, sidebarCollapsed, setSidebarCollapsed,
    membersVisible, setMembersVisible, dmActive, setDmActive,
    activeDmId, setActiveDmId, settingsOpen, setSettingsOpen,
    newDmOpen, setNewDmOpen, joinServerOpen, setJoinServerOpen,
    createServerOpen, setCreateServerOpen, searchActive, setSearchActive,
    notificationsActive, setNotificationsActive, friendsPanelOpen, setFriendsPanelOpen,
    serverSettingsOpen, setServerSettingsOpen, reportTarget, setReportTarget,
    userContextMenu, setUserContextMenu, pinnedPanelOpen, setPinnedPanelOpen,
    lastChannelPerServer, ready, serverThemes, setServerThemes,
  }
}
