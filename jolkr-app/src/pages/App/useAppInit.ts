import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { ServerTheme } from '../../types/ui'
import { useViewport } from '../../hooks/useViewport'
import { useAuthStore } from '../../stores/auth'
import { useServersStore } from '../../stores/servers'
import { useMessagesStore } from '../../stores/messages'
import { usePresenceStore } from '../../stores/presence'
import { useUnreadStore } from '../../stores/unread'
import { wsClient } from '../../api/ws'
import * as api from '../../api/client'
import { useGifFavoritesStore } from '../../stores/gif-favorites'

import type { DmChannel, User } from '../../api/types'
import type { UserContextMenuState } from '../../components/UserContextMenu/UserContextMenu'
import type { ProfileCardState } from '../../components/ProfileCard/ProfileCard'
import { lookupFriendship } from '../../services/friendshipCache'
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
  const channelPermissions = useServersStore(s => s.channelPermissions)
  const { fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions, fetchChannelPermissions } = useServersStore.getState()
  const { fetchMessages, sendMessage, sendDmMessage, editMessage, deleteMessage } = useMessagesStore.getState()

  // ── DMs ──
  const [dmList, setDmList] = useState<DmChannel[]>([])
  const [dmUsers, setDmUsers] = useState<Map<string, User>>(new Map())

  // ── UI state ──
  const [tabbedIds, setTabbedIds] = useState<string[]>([])
  const [activeServerId, setActiveServerId] = useState('')
  const [activeChannelId, setActiveChannelId] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<'members' | 'pinned' | 'threads' | null>('members')

  // Responsive collapse state — see plan-responsive-collapsing.md
  // Asymmetric model: 'closed' is sticky across resizes, 'open' is transient
  // and auto-clears once the auto-rule itself flips back to "open".
  const viewport = useViewport()
  const [userOverrideLeft,  setUserOverrideLeft]  = useState<'closed' | 'open' | null>(null)
  const [userOverrideRight, setUserOverrideRight] = useState<'closed' | 'open' | null>(null)
  const [activeMobilePane,  setActiveMobilePane]  = useState<'left' | 'chat' | 'right'>('chat')

  const autoLeftCollapsed  = viewport.isCompact   // < 768
  const autoRightCollapsed = viewport.isTablet    // < 1024

  // Auto-clear 'open' override once the auto-rule no longer demands closing.
  // This is what makes a manual-open on a small screen "expire" when the
  // user later resizes back into the closed regime.
  useEffect(() => {
    if (userOverrideLeft === 'open' && !autoLeftCollapsed) setUserOverrideLeft(null)
  }, [autoLeftCollapsed, userOverrideLeft])
  useEffect(() => {
    if (userOverrideRight === 'open' && !autoRightCollapsed) setUserOverrideRight(null)
  }, [autoRightCollapsed, userOverrideRight])

  // Reset mobile pane to 'chat' whenever we ENTER mobile regime so the user
  // doesn't land in a stale pane after a resize.
  const wasMobileRef = useRef(viewport.isMobile)
  useEffect(() => {
    if (viewport.isMobile && !wasMobileRef.current) setActiveMobilePane('chat')
    wasMobileRef.current = viewport.isMobile
  }, [viewport.isMobile])
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
  const [channelSettingsOpen, setChannelSettingsOpen] = useState(false)
  const [reportTarget, setReportTarget] = useState<MemberDisplay | null>(null)
  const [userContextMenu, setUserContextMenu] = useState<UserContextMenuState | null>(null)
  /** Whether the user the context menu targets is already an accepted friend.
   *  Resolved asynchronously from the friendship cache when the menu opens —
   *  drives the "Add Friend" ↔ "Remove Friend" toggle. */
  const [contextMenuIsFriend, setContextMenuIsFriend] = useState(false)
  const [profileCard, setProfileCard] = useState<ProfileCardState | null>(null)

  // ── Content availability for conditional icon display ──
  const [pinnedCount, setPinnedCount] = useState(0)
  const [pinnedVersion, setPinnedVersion] = useState(0)
  const [threadsCount, setThreadsCount] = useState(0)

  const lastChannelPerServer = useRef<Record<string, string>>({})
  const themeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

      // Fetch servers, DMs, and GIF favorites in parallel
      const [, dms] = await Promise.all([
        fetchServers(),
        api.getDms(),
        useGifFavoritesStore.getState().load(),
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
      srvs.forEach(srv => {
        if (srv.theme && typeof srv.theme === 'object' && 'orbs' in srv.theme) {
          themes[srv.id] = srv.theme as unknown as ServerTheme
        } else {
          themes[srv.id] = { hue: null, orbs: [] }
        }
      })
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
  // Uses push (not replace) so each user-driven server/channel/DM switch
  // adds a webview history entry. The Android hardware back button then
  // navigates to the previous channel instead of closing the app.
  useEffect(() => {
    if (!ready) return
    let target: string
    if (dmActive && activeDmId) {
      target = `/dm/${activeDmId}`
    } else if (dmActive) {
      target = `/dm`
    } else if (activeServerId && activeChannelId) {
      target = `/servers/${activeServerId}/channels/${activeChannelId}`
    } else if (activeServerId) {
      target = `/servers/${activeServerId}`
    } else {
      target = '/'
    }
    if (location.pathname !== target) {
      navigate(target)
    }
  }, [ready, dmActive, activeDmId, activeServerId, activeChannelId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sync URL → state (popstate / programmatic history.back) ──
  // When the user presses the Android back button or otherwise pops history,
  // the URL changes but state doesn't. Re-derive activeServerId / activeChannelId
  // / activeDmId / dmActive from the current path so the UI follows the URL.
  useEffect(() => {
    if (!ready) return
    const path = location.pathname
    const dmMatch = path.match(/^\/dm(?:\/([^/]+))?/)
    const serverMatch = path.match(/^\/servers\/([^/]+)(?:\/channels\/([^/]+))?/)
    if (dmMatch) {
      const dmId = dmMatch[1] ?? ''
      if (!dmActive) setDmActive(true)
      if (dmId !== activeDmId) setActiveDmId(dmId)
    } else if (serverMatch) {
      const sid = serverMatch[1]
      const cid = serverMatch[2] ?? ''
      if (dmActive) setDmActive(false)
      if (sid !== activeServerId) setActiveServerId(sid)
      if (cid !== activeChannelId) setActiveChannelId(cid)
    }
  }, [ready, location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch channel data when switching servers (after init) ──
  useEffect(() => {
    if (!ready || !activeServerId || dmActive) return
    Promise.all([
      fetchChannels(activeServerId),
      fetchMembers(activeServerId),
      fetchCategories(activeServerId),
      fetchPermissions(activeServerId),
    ]).then(() => {
      // Ensure a valid channel is selected after fresh channel data arrives
      const chs = useServersStore.getState().channels[activeServerId]
      if (!chs?.length) return
      const currentValid = activeChannelId && chs.some(c => c.id === activeChannelId)
      if (!currentValid) {
        setActiveChannelId(chs.find(c => c.kind === 'text')?.id ?? chs[0].id)
      }
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

    // Fetch channel-level permissions (accounts for channel overwrites)
    if (!dmActive) fetchChannelPermissions(channelId)

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

    // Fetch pinned count and threads count for conditional icon display
    const fetchCounts = async () => {
      try {
        const pinned = dmActive
          ? await api.getDmPinnedMessages(channelId)
          : await api.getPinnedMessages(channelId)
        setPinnedCount(pinned.length)
      } catch {
        setPinnedCount(0)
      }
      // TODO: Fetch threads count when API is available
      setThreadsCount(0)
    }
    fetchCounts()

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

  // ── Resolve friendship state for the open user-context-menu ──
  // Drives the "Add Friend" ↔ "Remove Friend" toggle in the menu.
  useEffect(() => {
    if (!userContextMenu?.user.user_id) {
      setContextMenuIsFriend(false)
      return
    }
    let cancelled = false
    lookupFriendship(userContextMenu.user.user_id)
      .then((lookup) => { if (!cancelled) setContextMenuIsFriend(lookup.state === 'accepted') })
      .catch(() => { if (!cancelled) setContextMenuIsFriend(false) })
    return () => { cancelled = true }
  }, [userContextMenu?.user.user_id])

  // ── Real-time DM channel sync ──
  // Without this, a new DM from a stranger only shows up after a manual refresh
  // because the backend's MessageCreate event lands in messages store but the
  // recipient has no entry in dmList for that channel — so it's invisible.
  // Backend fires DmUpdate on create, reopen, member-add, group rename, leave.
  useEffect(() => {
    return wsClient.on((op, d) => {
      if (op !== 'DmUpdate' && op !== 'DmCreate') return
      const channel = d.channel as DmChannel | undefined
      if (!channel?.id) return

      setDmList(prev => {
        const idx = prev.findIndex(c => c.id === channel.id)
        if (idx >= 0) {
          // Existing DM — replace with the fresh server view
          const next = prev.slice()
          next[idx] = channel
          return next
        }
        // New DM — prepend so it's visible at the top of the list
        return [channel, ...prev]
      })

      // Fetch user details for any unknown members so the DM can render with
      // a name + avatar instead of "Unknown".
      setDmUsers(prevUsers => {
        const missing = channel.members.filter(id => !prevUsers.has(id))
        if (missing.length === 0) return prevUsers
        Promise.all(missing.map(id => api.getUser(id).catch(() => null)))
          .then(fetched => {
            setDmUsers(curr => {
              const merged = new Map(curr)
              fetched.forEach(u => { if (u) merged.set(u.id, u) })
              return merged
            })
          })
          .catch(console.warn)
        // Also fetch presence so the status dot is correct.
        api.queryPresence(missing)
          .then(p => usePresenceStore.getState().setBulk(p))
          .catch(console.warn)
        return prevUsers
      })
    })
  }, [])

  // ── Sync serverThemes when store servers change (e.g. via WS ServerUpdate) ──
  useEffect(() => {
    setServerThemes(prev => {
      const next = { ...prev }
      let changed = false
      for (const srv of servers) {
        if (srv.theme && typeof srv.theme === 'object' && 'orbs' in srv.theme) {
          const t = srv.theme as unknown as ServerTheme
          if (prev[srv.id]?.hue !== t.hue || prev[srv.id]?.orbs !== t.orbs) {
            next[srv.id] = t
            changed = true
          }
        }
      }
      return changed ? next : prev
    })
  }, [servers])

  return {
    navigate, location,
    user, servers, channelsByServer, membersByServer, categoriesByServer,
    storeMessages, presences, unreadCounts, serverPermissions, channelPermissions,
    fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions, fetchChannelPermissions,
    fetchMessages, sendMessage, sendDmMessage, editMessage, deleteMessage,
    dmList, setDmList, dmUsers, setDmUsers,
    tabbedIds, setTabbedIds, activeServerId, setActiveServerId,
    activeChannelId, setActiveChannelId, sidebarCollapsed, setSidebarCollapsed,
    rightPanelMode, setRightPanelMode, dmActive, setDmActive,
    viewport,
    userOverrideLeft, setUserOverrideLeft,
    userOverrideRight, setUserOverrideRight,
    activeMobilePane, setActiveMobilePane,
    autoLeftCollapsed, autoRightCollapsed,
    activeDmId, setActiveDmId, settingsOpen, setSettingsOpen,
    newDmOpen, setNewDmOpen, joinServerOpen, setJoinServerOpen,
    createServerOpen, setCreateServerOpen, searchActive, setSearchActive,
    notificationsActive, setNotificationsActive, friendsPanelOpen, setFriendsPanelOpen,
    serverSettingsOpen, setServerSettingsOpen,
    channelSettingsOpen, setChannelSettingsOpen,
    reportTarget, setReportTarget,
    userContextMenu, setUserContextMenu,
    contextMenuIsFriend, setContextMenuIsFriend,
    profileCard, setProfileCard,
    pinnedCount, setPinnedCount, pinnedVersion, setPinnedVersion, threadsCount, setThreadsCount,
    lastChannelPerServer, themeSaveTimer, ready, serverThemes, setServerThemes,
  }
}
