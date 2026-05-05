/**
 * Bootstrap hook for the App shell.
 *
 * Owns the `ready` flag and the mount-only initial fetch flow that loads
 * servers + DMs + GIF favorites in parallel, populates DM users + presence,
 * parses per-server themes, and makes the initial routing decision based on
 * the URL the page loaded on. Only after that whole sequence completes does
 * `ready` flip to true — every other effect in the App shell waits for
 * ready before doing anything to avoid racing the bootstrap.
 *
 * Extracted from useRouting (which kept this from useAppInit's pre-CL-001
 * shape). useRouting now does only URL↔state sync; this hook owns all
 * data-fetching for first paint.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import * as api from '../../api/client'
import { useServersStore } from '../../stores/servers'
import { useAuthStore } from '../../stores/auth'
import { useGifFavoritesStore } from '../../stores/gif-favorites'
import { ServerThemeSchema } from '../../api/schemas'
import { syncPresence } from '../../services/presenceSync'
import type { DmChannel, User } from '../../api/types'
import type { ServerTheme } from '../../types/ui'

interface UseAuthInitArgs {
  setDmList: React.Dispatch<React.SetStateAction<DmChannel[]>>
  setDmUsers: React.Dispatch<React.SetStateAction<Map<string, User>>>
  setServerThemes: React.Dispatch<React.SetStateAction<Record<string, ServerTheme>>>
  setTabbedIds: React.Dispatch<React.SetStateAction<string[]>>
  setActiveServerId: React.Dispatch<React.SetStateAction<string>>
  setActiveDmId: React.Dispatch<React.SetStateAction<string>>
  setActiveChannelId: React.Dispatch<React.SetStateAction<string>>
  setDmActive: React.Dispatch<React.SetStateAction<boolean>>
  fetchServers: () => Promise<unknown>
  fetchChannels: (serverId: string) => Promise<unknown>
  fetchMembers: (serverId: string) => Promise<unknown>
  fetchCategories: (serverId: string) => Promise<unknown>
  fetchPermissions: (serverId: string) => Promise<unknown>
}

export function useAuthInit(args: UseAuthInitArgs) {
  const {
    setDmList, setDmUsers, setServerThemes, setTabbedIds,
    setActiveServerId, setActiveDmId, setActiveChannelId, setDmActive,
    fetchServers, fetchChannels, fetchMembers, fetchCategories, fetchPermissions,
  } = args
  const navigate = useNavigate()
  const location = useLocation()
  const [ready, setReady] = useState(false)
  const currentUserId = useAuthStore(s => s.user?.id ?? null)

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

    setReady(false)
    init().catch(console.error)
    return () => { cancelled = true }
    // MOUNT-ONLY by design. `location.pathname` in deps would re-run the
    // entire init (refetch servers + DMs + reset active*Id) on every nav —
    // creating a redirect loop with the state↔URL sync effects in useRouting.
    // Same for `navigate`. The fetch* refs are stable zustand actions so
    // they would technically be safe to list, but we keep [] for clarity
    // that this effect deliberately runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  return { ready, setReady }
}
