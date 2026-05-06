/**
 * URL ↔ state sync hook for the App shell.
 *
 * Owns the two effects that keep `activeServerId` / `activeChannelId` /
 * `activeDmId` / `dmActive` in sync with the browser URL after first paint:
 *
 *   1. state → URL — push history when the active container changes.
 *   2. URL → state — re-derive container state on popstate / programmatic
 *      history navigation (Android hardware back button etc.).
 *
 * Both effects gate on `ready` (set by `useAuthInit`) so they don't fight
 * the bootstrap fetch flow.
 *
 * The two load-bearing `react-hooks/exhaustive-deps` disables come along
 * with their rationales — adding the omitted deps creates a feedback loop
 * between the two effects (each writes what the other lists in deps).
 *
 * Inputs are passed in (rather than read from useAppInit's closure) so the
 * contract is visible at the call site and the hook is testable in
 * isolation. Same pattern as `useWsSubscriptions` / `useDmSync`.
 */
import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

interface UseRoutingArgs {
  ready: boolean
  dmActive: boolean
  activeDmId: string
  activeServerId: string
  activeChannelId: string
  setActiveServerId: React.Dispatch<React.SetStateAction<string>>
  setActiveDmId: React.Dispatch<React.SetStateAction<string>>
  setActiveChannelId: React.Dispatch<React.SetStateAction<string>>
  setDmActive: React.Dispatch<React.SetStateAction<boolean>>
}

export function useRouting(args: UseRoutingArgs) {
  const {
    ready, dmActive, activeDmId, activeServerId, activeChannelId,
    setActiveServerId, setActiveDmId, setActiveChannelId, setDmActive,
  } = args
  const navigate = useNavigate()
  const location = useLocation()

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
