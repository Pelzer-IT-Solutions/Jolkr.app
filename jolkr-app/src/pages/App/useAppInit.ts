import { useState, useEffect, useRef, useMemo } from 'react'
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
import { ServerThemeSchema } from '../../api/schemas'

import type { UserContextMenuState } from '../../components/UserContextMenu/UserContextMenu'
import type { ProfileCardState } from '../../components/ProfileCard/ProfileCard'
import { lookupFriendship } from '../../services/friendshipCache'
import { syncPresence } from '../../services/presenceSync'
import type { MemberDisplay } from '../../types/ui'
import { useWsSubscriptions } from './useWsSubscriptions'
import { useRouting } from './useRouting'
import { useDmSync } from './useDmSync'
import { useAuthInit } from './useAuthInit'

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
  const threadListVersion = useMessagesStore(s => s.threadListVersion)
  const presences = usePresenceStore(s => s.statuses)
  const unreadCounts = useUnreadStore(s => s.counts)
  const serverPermissions = useServersStore(s => s.permissions)
  const channelPermissions = useServersStore(s => s.channelPermissions)
  const { fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions, fetchChannelPermissions } = useServersStore.getState()
  const { fetchMessages, sendMessage, sendDmMessage, editMessage, deleteMessage } = useMessagesStore.getState()

  // ── DMs ──
  const { dmList, setDmList, dmUsers, setDmUsers } = useDmSync()

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

  // The "currently visible" container id — the channel id when on a server,
  // the DM id when in a DM. Memoised so effects can list it as a single
  // dep instead of `dmActive ? activeDmId : activeChannelId` (which the
  // exhaustive-deps lint rule cannot collapse).
  const currentChannelId = useMemo(
    () => dmActive ? activeDmId : activeChannelId,
    [dmActive, activeDmId, activeChannelId],
  )
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

  // Currently-open thread inside the right panel. null = show the list view.
  // Lives here (not in messages store) so it follows the existing pattern of
  // ephemeral UI state living next to the panel mode.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)

  const lastChannelPerServer = useRef<Record<string, string>>({})
  const themeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Per-server themes ──
  const [serverThemes, setServerThemes] = useState<Record<string, ServerTheme>>({})

  // ── Bootstrap: mount-only fetch flow + initial routing decision ──
  // useAuthInit owns the `ready` flag and the parallel servers + DMs + GIF
  // favorites fetch; only after that completes does it flip ready=true and
  // every other effect (URL sync, channel data fetch, WS subscribe) gates on
  // ready before doing anything.
  const { ready } = useAuthInit({
    setDmList, setDmUsers, setServerThemes, setTabbedIds,
    setActiveServerId, setActiveDmId, setActiveChannelId, setDmActive,
    fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions,
  })

  // ── URL ↔ state sync (only after ready) ──
  // useRouting owns the two effects that keep activeServerId/Channel/Dm in
  // sync with the browser URL. See useRouting for the rationale on why both
  // effects keep an exhaustive-deps disable.
  useRouting({
    ready, dmActive, activeDmId, activeServerId, activeChannelId,
    setActiveServerId, setActiveDmId, setActiveChannelId, setDmActive,
  })

  // ── Fetch channel data when switching servers (after init) ──
  // activeChannelId is read inside the .then to validate selection but we
  // don't want it in deps — a channel-switch within the same server should
  // not trigger a refetch. Mirror it through a ref kept current via the
  // effect below.
  const activeChannelIdRef = useRef(activeChannelId)
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId
  }, [activeChannelId])

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
      const currChan = activeChannelIdRef.current
      const currentValid = currChan && chs.some(c => c.id === currChan)
      if (!currentValid) {
        setActiveChannelId(chs.find(c => c.kind === 'text')?.id ?? chs[0].id)
      }
      const mems = useServersStore.getState().members[activeServerId]
      if (mems?.length) {
        syncPresence(mems.map(m => m.user_id))
      }
    })
  }, [activeServerId, ready, dmActive, fetchChannels, fetchMembers, fetchCategories, fetchPermissions])

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
  }, [ready, servers, dmActive, activeServerId, channelsByServer, dmList, tabbedIds])

  // ── Fetch messages when channel changes ──
  useEffect(() => {
    const channelId = currentChannelId
    if (!channelId) return
    // Draft DMs only exist locally — skip every server-side load (messages,
    // pinned, presence-marker) so we don't 404 on an id the server doesn't
    // know about. The draft is promoted on first send (handleSend).
    const isDraft = dmActive && channelId.startsWith('draft:')
    if (isDraft) {
      setPinnedCount(0)
      setThreadsCount(0)
      return
    }
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
      // Threads only exist in server text channels — DMs have none.
      if (dmActive) {
        setThreadsCount(0)
        return
      }
      try {
        const threads = await api.getThreads(channelId, false)
        setThreadsCount(threads.filter(t => !t.is_archived).length)
      } catch {
        setThreadsCount(0)
      }
    }
    fetchCounts()

    return () => {
      useUnreadStore.getState().setActiveChannel(null)
    }
    // threadListVersion is included so the count refreshes when ThreadCreate/Update fires.
  }, [currentChannelId, dmActive, threadListVersion, fetchMessages, fetchChannelPermissions])

  // ── Reset open thread when channel/DM changes ──
  // Otherwise the thread panel would try to render messages from a thread
  // that doesn't belong to the new channel.
  useEffect(() => {
    setOpenThreadId(null)
  }, [activeChannelId, activeDmId, dmActive])

  // ── WS channel subscribe/unsubscribe ──
  useEffect(() => {
    const channelId = currentChannelId
    if (!channelId) return
    // Draft DMs aren't subscribable — the server has no channel for them.
    if (dmActive && channelId.startsWith('draft:')) return
    wsClient.subscribe(channelId)
    return () => { wsClient.unsubscribe(channelId) }
  }, [currentChannelId, dmActive])

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

  // ── Real-time WebSocket subscriptions ──
  // DM channel sync (DmCreate/Update/Close), DM message hides, role +
  // permission updates, GIF favorites, and cross-session call presence are
  // all dispatched centrally inside useWsSubscriptions.
  useWsSubscriptions({
    activeDmId,
    setDmList,
    setActiveDmId,
    setDmUsers,
    fetchPermissions,
    fetchChannelPermissions,
  })

  // ── Sync serverThemes when store servers change (e.g. via WS ServerUpdate) ──
  useEffect(() => {
    setServerThemes(prev => {
      const next = { ...prev }
      let changed = false
      for (const srv of servers) {
        const parsed = ServerThemeSchema.safeParse(srv.theme)
        if (!parsed.success) continue
        const t = parsed.data
        if (prev[srv.id]?.hue !== t.hue || prev[srv.id]?.orbs !== t.orbs) {
          next[srv.id] = t
          changed = true
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
    openThreadId, setOpenThreadId,
    lastChannelPerServer, themeSaveTimer, ready, serverThemes, setServerThemes,
  }
}
