import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import * as api from '../../api/client'
import { wsClient } from '../../api/ws'
import { useViewport } from '../../hooks/useViewport'
import { lookupFriendship } from '../../services/friendshipCache'
import { useAuthStore } from '../../stores/auth'
import { useCallStore } from '../../stores/call'
import { useGifFavoritesStore } from '../../stores/gif-favorites'
import { useMessagesStore } from '../../stores/messages'
import { useNotificationSettingsStore } from '../../stores/notification-settings'
import { usePresenceStore } from '../../stores/presence'
import { useServersStore } from '../../stores/servers'
import { useThreadsStore } from '../../stores/threads'
import { useUnreadStore } from '../../stores/unread'
import { useUsersStore } from '../../stores/users'
import { makeDraftDmId } from '../../utils/draftDm'
import type { DmChannel, User } from '../../api/types'
import type { ProfileCardState } from '../../components/ProfileCard/ProfileCard'
import type { UserContextMenuState } from '../../components/UserContextMenu/UserContextMenu'
import type { ServerTheme } from '../../types/ui'
import type { MemberDisplay } from '../../types/ui'

export function useAppInit() {
  const navigate = useNavigate()
  const location = useLocation()
  const navType = useNavigationType()

  // ── Backend state from stores ──
  const user = useAuthStore(s => s.user)
  const servers = useServersStore(s => s.servers)
  const channelsByServer = useServersStore(s => s.channels)
  const membersByServer = useServersStore(s => s.members)
  const channelMembersByChannel = useServersStore(s => s.channelMembers)
  const categoriesByServer = useServersStore(s => s.categories)
  const storeMessages = useMessagesStore(s => s.messages)
  const threadListVersion = useThreadsStore(s => s.threadListVersion)
  const presences = usePresenceStore(s => s.statuses)
  const unreadCounts = useUnreadStore(s => s.counts)
  const serverPermissions = useServersStore(s => s.permissions)
  const channelPermissions = useServersStore(s => s.channelPermissions)
  const { fetchServers, fetchChannels, fetchMembers, fetchChannelMembers, fetchCategories, fetchPermissions, fetchChannelPermissions } = useServersStore.getState()
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

  // Currently-open thread inside the right panel. null = show the list view.
  // Lives here (not in messages store) so it follows the existing pattern of
  // ephemeral UI state living next to the panel mode.
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)

  const lastChannelPerServer = useRef<Record<string, string>>({})
  const themeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [ready, setReady] = useState(false)

  // Single derived id — replaces `dmActive ? activeDmId : activeChannelId`
  // ternaries inside effect bodies and dep-lists so React sees a primitive
  // dep instead of a re-evaluated expression with an eslint-disable.
  const effectiveChannelId = dmActive ? activeDmId : activeChannelId

  // Cancel any pending theme-save on unmount so a debounced api.updateServer
  // doesn't fire after logout (or page unmount during a server switch).
  useEffect(() => () => {
    if (themeSaveTimer.current) {
      clearTimeout(themeSaveTimer.current)
      themeSaveTimer.current = null
    }
  }, [])

  // ── Per-server themes ──
  // Server.theme on the store is the source of truth. `themeOverrides` is a
  // local optimistic layer for the theme-orb debounce — handleThemeChange
  // writes the in-progress theme here, and the effect below drops the
  // override once the BE-confirmed theme on `servers` catches up.
  const [themeOverrides, setThemeOverrides] = useState<Record<string, ServerTheme>>({})

  // ── Init: fetch servers + DMs, then navigate to correct place ──
  useEffect(() => {
    let cancelled = false

    async function init() {
      // ── Parse URL FIRST — we need to know where to go ──
      const path = location.pathname
      const urlDmId = path.match(/\/dm\/([^/]+)/)?.[1]
      const urlServerId = path.match(/\/servers\/([^/]+)/)?.[1]
      const urlChannelId = path.match(/\/servers\/[^/]+\/channels\/([^/]+)/)?.[1]

      // Fetch servers, DMs, GIF favorites, and notification settings in parallel
      const [, dms] = await Promise.all([
        fetchServers(),
        api.getDms(),
        useGifFavoritesStore.getState().load(),
        useNotificationSettingsStore.getState().load(),
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
          useUsersStore.getState().upsertUsers(users)
        })
        // Fetch presence for DM participants
        api.queryPresence(idArr).then(p => {
          if (!cancelled) usePresenceStore.getState().setBulk(p)
        }).catch(console.warn)
      }

      const srvs = useServersStore.getState().servers
      // serverThemes is derived from `servers` via useMemo below — no seed needed.

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
    if (dmActive && activeDmId && !activeDmId.startsWith('draft:')) {
      // Drafts are session-only; we never expose their synthetic id in the
      // URL. Navigating to `/dm` keeps the sidebar visible while the draft
      // chat renders so the user can still see and switch DMs.
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

  // ── Sync URL → state on history POP only ──
  // PUSH/REPLACE come from our own state→URL effect or programmatic navigate
  // calls inside handlers — feeding those back into setState would close the
  // feedback loop. Only POP (browser/Android back-button, history.back) needs
  // to re-derive state from the URL because the URL has already changed
  // without anyone telling our state.
  useEffect(() => {
    if (!ready || navType !== 'POP') return
    const path = location.pathname
    const dmMatch = path.match(/^\/dm(?:\/([^/]+))?/)
    const serverMatch = path.match(/^\/servers\/([^/]+)(?:\/channels\/([^/]+))?/)
    if (dmMatch) {
      const dmId = dmMatch[1] ?? ''
      if (!dmActive) setDmActive(true)
      // A draft id reaching us via the URL means the page was reloaded
      // mid-draft; the local entry no longer exists, so fall back to the
      // empty DM list rather than trying to render a phantom conversation.
      if (dmId.startsWith('draft:')) {
        if (activeDmId) setActiveDmId('')
      } else if (dmId !== activeDmId) {
        setActiveDmId(dmId)
      }
    } else if (serverMatch) {
      const sid = serverMatch[1]
      const cid = serverMatch[2] ?? ''
      if (dmActive) setDmActive(false)
      if (sid !== activeServerId) setActiveServerId(sid)
      if (cid !== activeChannelId) setActiveChannelId(cid)
    }
  }, [ready, navType, location.pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch channel data when switching servers (after init) ──
  useEffect(() => {
    if (!ready || !activeServerId || dmActive) return
    // Fast-switching servers used to let an older Promise.all resolve after a
    // newer one and stomp the active channel selection back onto the previous
    // server's first channel. The cancelled flag gates every late setState.
    let cancelled = false
    Promise.all([
      fetchChannels(activeServerId),
      fetchMembers(activeServerId),
      fetchCategories(activeServerId),
      fetchPermissions(activeServerId),
    ]).then(() => {
      if (cancelled) return
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
          if (cancelled) return
          usePresenceStore.getState().setBulk(p)
        }).catch(console.warn)
      }
    })
    return () => { cancelled = true }
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
    const channelId = effectiveChannelId
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
    // and the role-aware member roster so the side panel only lists people
    // who can actually see this channel.
    if (!dmActive) {
      fetchChannelPermissions(channelId)
      fetchChannelMembers(channelId).catch(console.warn)
    }

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

    // Fetch pinned count and threads count for conditional icon display.
    // Cancellation gates every setState so a slow response from the previous
    // channel can't write counts into the newly-active channel's badges.
    let cancelled = false
    const fetchCounts = async () => {
      try {
        const pinned = dmActive
          ? await api.getDmPinnedMessages(channelId)
          : await api.getPinnedMessages(channelId)
        if (cancelled) return
        setPinnedCount(pinned.length)
      } catch {
        if (cancelled) return
        setPinnedCount(0)
      }
      // Threads only exist in server text channels — DMs have none.
      if (dmActive) {
        if (!cancelled) setThreadsCount(0)
        return
      }
      // Drive the count off the shared store cache that ThreadListPanel
      // also reads — one fetch fans out into badge + panel without a
      // duplicate GET per channel-switch.
      try {
        await useThreadsStore.getState().fetchThreadList(channelId)
        if (cancelled) return
        const list = useThreadsStore.getState().threadList[channelId] ?? []
        setThreadsCount(list.length)
      } catch {
        if (cancelled) return
        setThreadsCount(0)
      }
    }
    fetchCounts()

    return () => {
      cancelled = true
      useUnreadStore.getState().setActiveChannel(null)
    }
    // threadListVersion is included so the count refreshes when ThreadCreate/Update fires.
  }, [effectiveChannelId, dmActive, threadListVersion, fetchMessages, fetchChannelPermissions, fetchChannelMembers])

  // ── Reset open thread when channel/DM changes ──
  // Otherwise the thread panel would try to render messages from a thread
  // that doesn't belong to the new channel.
  useEffect(() => {
    setOpenThreadId(null)
  }, [activeChannelId, activeDmId, dmActive])

  // ── WS channel subscribe/unsubscribe ──
  useEffect(() => {
    const channelId = effectiveChannelId
    if (!channelId) return
    // Draft DMs aren't subscribable — the server has no channel for them.
    if (dmActive && channelId.startsWith('draft:')) return
    wsClient.subscribe(channelId)
    return () => { wsClient.unsubscribe(channelId) }
  }, [effectiveChannelId, dmActive])

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
  // Mirror activeDmId into a ref so the WS subscriber (set up once with []
  // deps) can read the latest value without re-subscribing on every change.
  const activeDmIdRef = useRef(activeDmId)
  useEffect(() => { activeDmIdRef.current = activeDmId }, [activeDmId])

  useEffect(() => {
    return wsClient.on((event) => {
      // DmClose: closer's other sessions get told to hide the DM. Channel keys
      // stay in the cache — if the DM gets reopened later in this session, we
      // can keep decrypting without a re-fetch. Crucially we keep `dmActive`
      // on so the URL sync stays on `/dm` (with no selection) instead of
      // falling back to whatever server/channel was last viewed.
      if (event.op === 'DmClose') {
        const closedId = event.d.dm_id
        setDmList(prev => prev.filter(d => d.id !== closedId))
        if (activeDmIdRef.current === closedId) {
          setActiveDmId('')
        }
        return
      }

      // DmMessageHide: another session of the same user soft-hid a single DM
      // message. Drop it from the local message list so all of the user's
      // open clients agree on which messages are visible. The sidebar
      // last_message preview may briefly stay stale until the next fetch —
      // acceptable because a fresh DmCreate/DmUpdate or refetch will correct
      // it.
      if (event.op === 'DmMessageHide') {
        const { dm_id, message_id } = event.d
        useMessagesStore.getState().removeMessage(dm_id, message_id)
        return
      }

      // GifFavoriteUpdate: another session of this user added/removed a GIF
      // favorite. Mirror the change locally so the favorites tab stays in sync
      // without polling. Idempotent — see store.applyServerEvent.
      if (event.op === 'GifFavoriteUpdate') {
        useGifFavoritesStore.getState().applyServerEvent(event.d)
        return
      }

      // UserCallPresence: another session of this user joined/left a DM call.
      // Mirror into the call store so the user-chip can show an "On a call"
      // pill on this device while the call runs elsewhere.
      if (event.op === 'UserCallPresence') {
        useCallStore.getState().applyServerEvent(event.d)
        return
      }

      // UserUpdate: profile change in some other session (own user OR a mutual
      // server/DM member). Patch every cache that holds a User snapshot so
      // avatars/names refresh live without a refetch. Auth store handles the
      // self case separately (see stores/auth.ts wsClient.on subscriber).
      if (event.op === 'UserUpdate') {
        const { user_id } = event.d
        if (!user_id) return

        // Build the patch once, then write to both caches independently —
        // keeping the side-effect (upsertUser into the global users cache)
        // outside the setState updater so React-strict's double-invocation
        // doesn't double-write the global cache.
        const patch = {
          ...(event.d.display_name !== undefined && { display_name: event.d.display_name }),
          ...(event.d.avatar_url !== undefined && { avatar_url: event.d.avatar_url }),
          ...(event.d.bio !== undefined && { bio: event.d.bio }),
          ...(event.d.status !== undefined && { status: event.d.status }),
          ...(event.d.banner_color !== undefined && { banner_color: event.d.banner_color }),
        }

        // 1) Global users cache (single source of truth for non-React consumers).
        const cached = useUsersStore.getState().getUser(user_id)
        if (cached) useUsersStore.getState().upsertUser({ ...cached, ...patch })

        // 2) Local DM users map — patch the entry if we already know it.
        setDmUsers(prev => {
          const existing = prev.get(user_id)
          if (!existing) return prev
          const next = new Map(prev)
          next.set(user_id, { ...existing, ...patch })
          return next
        })

        // 3) Cross-server members.user patch — store action owns the loop.
        useServersStore.getState().patchMemberUser(user_id, patch)
        return
      }

      // RoleCreate / RoleUpdate / RoleDelete: server-wide role CRUD. The store
      // action patches roles[serverId] and invalidates the affected permission
      // + channel-member caches; this handler only owns the UI-side refetch
      // decisions (which depend on the active channel and so live here).
      if (event.op === 'RoleCreate' || event.op === 'RoleUpdate' || event.op === 'RoleDelete') {
        const serverId = event.d.server_id
        if (!serverId) return
        const change = event.op === 'RoleDelete'
          ? { op: 'RoleDelete' as const, role_id: event.d.role_id }
          : { op: event.op, role: event.d.role }
        useServersStore.getState().applyRoleChange(serverId, change)
        // Refetch immediately so gated UI updates without a user action.
        fetchPermissions(serverId).catch(console.warn)
        // If the active channel belongs to this server, refresh its visible
        // member list right away so the panel reflects the new role layout.
        const channelIds = (useServersStore.getState().channels[serverId] ?? []).map(c => c.id)
        if (activeChannelId && channelIds.includes(activeChannelId)) {
          fetchChannelMembers(activeChannelId).catch(console.warn)
        }
        return
      }

      // ChannelPermissionUpdate: an overwrite was upserted/deleted. The store
      // drops the cached permissions for this channel; we refetch the gated
      // values + the visible-member list if it's the active channel.
      if (event.op === 'ChannelPermissionUpdate') {
        const { channel_id } = event.d
        if (!channel_id) return
        useServersStore.getState().applyChannelPermissionUpdate(channel_id)
        fetchChannelPermissions(channel_id).catch(console.warn)
        if (channel_id === activeChannelId) {
          fetchChannelMembers(channel_id).catch(console.warn)
        }
        return
      }

      // MemberUpdate: when role_ids change for the SELF user, refetch server
      // permissions so gated UI updates immediately. The servers store also
      // patches the member's role_ids (see stores/servers.ts subscriber).
      // Any role_ids change can shift channel visibility, so also drop the
      // active channel's visible-member cache and refetch — applies to both
      // self and other-user updates because the right-hand panel reflects
      // everyone, not just me.
      if (event.op === 'MemberUpdate') {
        const { server_id, user_id, role_ids } = event.d
        const me = useAuthStore.getState().user
        if (server_id && me && user_id === me.id && role_ids !== undefined) {
          fetchPermissions(server_id).catch(console.warn)
        }
        if (server_id && role_ids !== undefined && activeChannelId) {
          const channels = useServersStore.getState().channels[server_id] ?? []
          if (channels.some(c => c.id === activeChannelId)) {
            fetchChannelMembers(activeChannelId).catch(console.warn)
          }
        }
        // Don't return — fall through in case future handlers need this event.
      }

      if (event.op !== 'DmUpdate' && event.op !== 'DmCreate') return
      const channel = event.d.channel
      if (!channel?.id) return

      // Pre-compute whether the active DM was a draft for this exact member
      // set — that's the only state-flip the setDmList updater would need to
      // know about. Hoisting it out keeps the updater pure.
      const draftId = makeDraftDmId(channel.members)
      const wasDraftActive = activeDmIdRef.current === draftId

      setDmList(prev => {
        // If this user already has a draft for the same member set, replace
        // the draft in place — we promote it rather than ending up with two
        // sidebar entries pointing at the same conversation.
        const draftIdx = prev.findIndex(c => c.id === draftId)
        if (draftIdx >= 0) {
          const next = prev.slice()
          next[draftIdx] = channel
          return next
        }
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

      if (wasDraftActive) setActiveDmId(channel.id)

      // Fetch user details for any unknown members so the DM can render with
      // a name + avatar instead of "Unknown". The global users cache is the
      // source of truth for "do we already know this user"; checking that
      // (instead of dmUsers) lets us hoist the work out of the setDmUsers
      // updater entirely.
      const usersCache = useUsersStore.getState()
      const missing = channel.members.filter(id => !usersCache.getUser(id))
      if (missing.length > 0) {
        Promise.all(missing.map(id => api.getUser(id).catch(() => null)))
          .then(fetched => {
            const valid = fetched.filter((u): u is User => u !== null)
            if (valid.length > 0) {
              useUsersStore.getState().upsertUsers(valid)
              setDmUsers(curr => {
                const merged = new Map(curr)
                for (const u of valid) merged.set(u.id, u)
                return merged
              })
            }
          })
          .catch(console.warn)
        // Also fetch presence so the status dot is correct.
        api.queryPresence(missing)
          .then(p => usePresenceStore.getState().setBulk(p))
          .catch(console.warn)
      }
    })
    // fetch* are module-scoped store actions (destructured from
    // `useServersStore.getState()` at module load) so they're stable
    // references — listing them is purely for the lint rule. activeChannelId
    // is read inside the WS listener via closure: the listener is registered
    // once at mount and re-reads the latest value through the `activeChannelId`
    // closure on every event, so capturing it as a dep would just thrash the
    // listener registration without changing behaviour.
  }, [fetchChannelPermissions, fetchPermissions, fetchChannelMembers, activeChannelId])

  // ── Drop optimistic overrides once the BE-confirmed theme matches ──
  // Bare ref equality on `orbs` is enough — the orb-drag debounce sends the
  // same array reference back via `api.updateServer`, and a no-op WS event
  // would still produce a same-value compare here.
  useEffect(() => {
    setThemeOverrides(prev => {
      if (Object.keys(prev).length === 0) return prev
      let changed = false
      const next: Record<string, ServerTheme> = {}
      for (const [id, override] of Object.entries(prev)) {
        const srv = servers.find(s => s.id === id)
        const beTheme = srv?.theme
        if (beTheme && beTheme.hue === override.hue && beTheme.orbs === override.orbs) {
          changed = true
          continue
        }
        next[id] = override
      }
      return changed ? next : prev
    })
  }, [servers])

  // Derived theme map: store-provided theme per server, with any pending
  // optimistic override layered on top.
  const serverThemes = useMemo<Record<string, ServerTheme>>(() => {
    const out: Record<string, ServerTheme> = {}
    for (const srv of servers) {
      if (srv.theme) out[srv.id] = srv.theme
    }
    return Object.keys(themeOverrides).length === 0 ? out : { ...out, ...themeOverrides }
  }, [servers, themeOverrides])

  return {
    navigate, location,
    user, servers, channelsByServer, membersByServer, channelMembersByChannel, categoriesByServer,
    storeMessages, presences, unreadCounts, serverPermissions, channelPermissions,
    fetchServers, fetchChannels, fetchMembers, fetchChannelMembers, fetchCategories, fetchPermissions, fetchChannelPermissions,
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
    lastChannelPerServer, themeSaveTimer, ready, serverThemes, setServerThemes: setThemeOverrides,
  }
}
