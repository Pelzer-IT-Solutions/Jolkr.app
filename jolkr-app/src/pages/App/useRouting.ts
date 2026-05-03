/**
 * Routing hook for the App shell.
 *
 * Extracted from useAppInit. Owns the three routing effects that together
 * keep `activeServerId` / `activeChannelId` / `activeDmId` / `dmActive` in
 * sync with the URL (and vice versa), plus the mount-only init that decides
 * where to navigate on cold start.
 *
 * The three load-bearing `react-hooks/exhaustive-deps` disables come along
 * with their rationales — adding the omitted deps in any of them creates a
 * feedback loop with the other two effects (init refetches everything on
 * every navigation; state→URL and URL→state both re-fire on each other's
 * writes).
 *
 * Inputs are passed in (rather than read directly from useAppInit's scope)
 * so the contract is visible at the call site and the hook is testable in
 * isolation. Same pattern as `useWsSubscriptions`.
 */
import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as api from '../../api/client'
import { useServersStore } from '../../stores/servers'
import { useGifFavoritesStore } from '../../stores/gif-favorites'
import { ServerThemeSchema } from '../../api/schemas'
import { syncPresence } from '../../services/presenceSync'
import type { DmChannel, User } from '../../api/types'
import type { ServerTheme } from '../../types/ui'

interface UseRoutingArgs {
  // state values driving the state→URL effect
  ready: boolean
  dmActive: boolean
  activeDmId: string
  activeServerId: string
  activeChannelId: string
  // setters used by init + URL→state
  setDmList: React.Dispatch<React.SetStateAction<DmChannel[]>>
  setDmUsers: React.Dispatch<React.SetStateAction<Map<string, User>>>
  setServerThemes: React.Dispatch<React.SetStateAction<Record<string, ServerTheme>>>
  setTabbedIds: React.Dispatch<React.SetStateAction<string[]>>
  setActiveServerId: React.Dispatch<React.SetStateAction<string>>
  setActiveDmId: React.Dispatch<React.SetStateAction<string>>
  setActiveChannelId: React.Dispatch<React.SetStateAction<string>>
  setDmActive: React.Dispatch<React.SetStateAction<boolean>>
  setReady: React.Dispatch<React.SetStateAction<boolean>>
  // zustand actions (stable refs)
  fetchServers: () => Promise<unknown>
  fetchChannels: (serverId: string) => Promise<unknown>
  fetchMembers: (serverId: string) => Promise<unknown>
  fetchCategories: (serverId: string) => Promise<unknown>
  fetchPermissions: (serverId: string) => Promise<unknown>
}

export function useRouting(args: UseRoutingArgs) {
  const {
    ready, dmActive, activeDmId, activeServerId, activeChannelId,
    setDmList, setDmUsers, setServerThemes, setTabbedIds,
    setActiveServerId, setActiveDmId, setActiveChannelId,
    setDmActive, setReady,
    fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions,
  } = args
  const navigate = useNavigate()
  const location = useLocation()

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
        // Fetch presence for DM participants (batched / deduped via service).
        syncPresence(idArr)
      }

      const srvs = useServersStore.getState().servers
      const themes: Record<string, ServerTheme> = {}
      srvs.forEach(srv => {
        const parsed = ServerThemeSchema.safeParse(srv.theme)
        themes[srv.id] = parsed.success ? parsed.data : { hue: null, orbs: [] }
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
      // Fetch presence for all server members (batched / deduped via service).
      const mems = useServersStore.getState().members[serverId]
      if (mems?.length) {
        syncPresence(mems.map(m => m.user_id))
      }
    }

    init().catch(console.error)
    return () => { cancelled = true }
    // MOUNT-ONLY by design. `location.pathname` in deps would re-run the
    // entire init (refetch servers + DMs + reset active*Id) on every nav —
    // creating a redirect loop with the state↔URL sync effects below. Same
    // for `navigate`. The fetch* refs are stable zustand actions so they
    // would technically be safe to list, but we keep [] for clarity that
    // this effect deliberately runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    // Drives URL FROM state — listing `location.pathname` in deps would
    // make this effect re-fire on URL changes too and feedback-loop with
    // the URL→state effect below. `navigate` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dmActive, activeDmId, activeServerId, activeChannelId])

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
    // Drives state FROM url — listing the state vars would make this
    // effect re-fire on every state change and feedback-loop with the
    // state→URL effect above. The conditionals are no-op guards, not
    // reactive triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, location.pathname])
}
