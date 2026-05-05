/**
 * DM state hook for the App shell.
 *
 * Owns the DM list and the DM users map — the two pieces of DM-related
 * state that are read by sidebar, chat area, member panel, and modals.
 * Split out of useAppInit so the bootstrap (`useAuthInit`), the routing
 * sync (`useRouting`), and the WS event subscriber (`useWsSubscriptions`)
 * can take the setters as inputs instead of reading them through useAppInit's
 * closure.
 *
 * Pure state-owner — no effects. The initial fetch lives in `useAuthInit`
 * and the WS-driven updates live in `useWsSubscriptions`. Both write through
 * the setters returned here.
 */
import { useState } from 'react'
import type { DmChannel, User } from '../../api/types'

export function useDmSync() {
  const [dmList, setDmList] = useState<DmChannel[]>([])
  const [dmUsers, setDmUsers] = useState<Map<string, User>>(new Map())
  return { dmList, setDmList, dmUsers, setDmUsers }
}
