/**
 * Central WebSocket event subscriber for the App shell.
 *
 * Extracted from useAppInit so that hub-level WS plumbing lives in one place
 * with explicit inputs and no other side effects. The hook subscribes once on
 * mount and dispatches inbound events to the right store action / state setter.
 *
 * Inputs are passed in (rather than read directly from useAppInit's scope) so
 * the contract is visible at the call site and the hook is testable in
 * isolation.
 */
import { useEffect, useRef } from 'react'
import { wsClient } from '../../api/ws'
import * as api from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import { useServersStore } from '../../stores/servers'
import { useMessagesStore } from '../../stores/messages'
import { useGifFavoritesStore } from '../../stores/gif-favorites'
import { useCallStore } from '../../stores/call'
import { syncPresence } from '../../services/presenceSync'
import { makeDraftDmId } from '../../utils/draftDm'
import type { DmChannel, User, Role } from '../../api/types'

interface UseWsSubscriptionsArgs {
  activeDmId: string
  setDmList: React.Dispatch<React.SetStateAction<DmChannel[]>>
  setActiveDmId: React.Dispatch<React.SetStateAction<string>>
  setDmUsers: React.Dispatch<React.SetStateAction<Map<string, User>>>
  fetchPermissions: (serverId: string) => Promise<unknown>
  fetchChannelPermissions: (channelId: string) => Promise<unknown>
}

export function useWsSubscriptions({
  activeDmId,
  setDmList,
  setActiveDmId,
  setDmUsers,
  fetchPermissions,
  fetchChannelPermissions,
}: UseWsSubscriptionsArgs) {
  // Mirror activeDmId into a ref so the mount-only WS subscriber below always
  // sees the latest value without re-subscribing on every change.
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

        // 1) DM users map — keyed by user.id.
        setDmUsers(prev => {
          const existing = prev.get(user_id)
          if (!existing) return prev
          const next = new Map(prev)
          next.set(user_id, {
            ...existing,
            ...(event.d.display_name !== undefined && { display_name: event.d.display_name }),
            ...(event.d.avatar_url !== undefined && { avatar_url: event.d.avatar_url }),
            ...(event.d.bio !== undefined && { bio: event.d.bio }),
            ...(event.d.status !== undefined && { status: event.d.status }),
            ...(event.d.banner_color !== undefined && { banner_color: event.d.banner_color }),
          })
          return next
        })

        // 2) Server members store — patch the embedded `user` blob on every
        // server where this user is a member so MemberPanel re-renders with
        // the new name/avatar.
        const serversState = useServersStore.getState()
        const newMembers: Record<string, typeof serversState.members[string]> = {}
        let changed = false
        for (const [sid, list] of Object.entries(serversState.members)) {
          const idx = list.findIndex(m => m.user_id === user_id)
          if (idx === -1) continue
          const updatedList = list.slice()
          const m = updatedList[idx]
          updatedList[idx] = {
            ...m,
            user: m.user
              ? {
                  ...m.user,
                  ...(event.d.display_name !== undefined && { display_name: event.d.display_name }),
                  ...(event.d.avatar_url !== undefined && { avatar_url: event.d.avatar_url }),
                  ...(event.d.bio !== undefined && { bio: event.d.bio }),
                  ...(event.d.status !== undefined && { status: event.d.status }),
                  ...(event.d.banner_color !== undefined && { banner_color: event.d.banner_color }),
                }
              : m.user,
          }
          newMembers[sid] = updatedList
          changed = true
        }
        if (changed) {
          useServersStore.setState({ members: { ...serversState.members, ...newMembers } })
        }
        return
      }

      // RoleCreate / RoleUpdate / RoleDelete: server-wide role CRUD. Patch
      // the roles cache for this server, then invalidate the permissions
      // caches because effective permissions may have changed for the local
      // user (if they hold the affected role). Channel-level perms also
      // need to drop because role overwrites may apply.
      if (event.op === 'RoleCreate' || event.op === 'RoleUpdate' || event.op === 'RoleDelete') {
        const serverId = event.d.server_id
        if (!serverId) return
        const s = useServersStore.getState()
        const current: Role[] = s.roles[serverId] ?? []
        let nextRoles: Role[] = current
        switch (event.op) {
          case 'RoleCreate': {
            const r = event.d.role
            if (!current.some(c => c.id === r.id)) nextRoles = [...current, r]
            break
          }
          case 'RoleUpdate': {
            const r = event.d.role
            nextRoles = current.map(c => c.id === r.id ? r : c)
            break
          }
          case 'RoleDelete': {
            const rid = event.d.role_id
            nextRoles = current.filter(c => c.id !== rid)
            break
          }
        }
        // Drop server + per-channel permission caches so the next read
        // refetches with the new role data baked in.
        const { [serverId]: _serverPerm, ...restServerPerms } = s.permissions
        const channelIds = (s.channels[serverId] ?? []).map(c => c.id)
        const restChanPerms = { ...s.channelPermissions }
        for (const cid of channelIds) delete restChanPerms[cid]
        useServersStore.setState({
          roles: { ...s.roles, [serverId]: nextRoles },
          permissions: restServerPerms,
          channelPermissions: restChanPerms,
        })
        // Refetch immediately so the gated UI updates without a user action.
        fetchPermissions(serverId).catch(console.warn)
        return
      }

      // ChannelPermissionUpdate: an overwrite was upserted/deleted. Drop the
      // cached permissions for this channel and refetch so gated UI (composer,
      // pin button, etc.) reflects the new effective perms.
      if (event.op === 'ChannelPermissionUpdate') {
        const { channel_id } = event.d
        if (!channel_id) return
        const s = useServersStore.getState()
        const { [channel_id]: _drop, ...restChanPerms } = s.channelPermissions
        useServersStore.setState({ channelPermissions: restChanPerms })
        fetchChannelPermissions(channel_id).catch(console.warn)
        return
      }

      // MemberUpdate: when role_ids change for the SELF user, refetch server
      // permissions so gated UI updates immediately. The servers store also
      // patches the member's role_ids (see stores/servers.ts subscriber).
      if (event.op === 'MemberUpdate') {
        const { server_id, user_id, role_ids } = event.d
        const me = useAuthStore.getState().user
        if (server_id && me && user_id === me.id && role_ids !== undefined) {
          fetchPermissions(server_id).catch(console.warn)
        }
        // Don't return — fall through in case future handlers need this event.
      }

      if (event.op !== 'DmUpdate' && event.op !== 'DmCreate') return
      const channel = event.d.channel
      if (!channel?.id) return

      setDmList(prev => {
        // If this user already has a draft for the same member set, replace
        // the draft in place — we promote it rather than ending up with two
        // sidebar entries pointing at the same conversation.
        const draftId = makeDraftDmId(channel.members)
        const draftIdx = prev.findIndex(c => c.id === draftId)
        if (draftIdx >= 0) {
          const next = prev.slice()
          next[draftIdx] = channel
          // If the draft was the active conversation, point at the real id.
          if (activeDmIdRef.current === draftId) {
            setActiveDmId(channel.id)
          }
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
        // Also fetch presence so the status dot is correct (batched/deduped).
        syncPresence(missing)
        return prevUsers
      })
    })
    // Mount-only WS subscription. The fetch* references are zustand actions
    // (stable), so adding them keeps the rule satisfied without changing
    // behavior — the cleanup runs once on unmount.
  }, [fetchPermissions, fetchChannelPermissions, setDmList, setActiveDmId, setDmUsers])
}
