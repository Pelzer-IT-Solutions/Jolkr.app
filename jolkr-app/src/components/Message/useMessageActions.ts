import { useShiftKey } from '../../hooks/useShiftKey'

/**
 * Pure-computation hook that derives which actions are available for a single
 * message in the current context. Centralises the fiddly rules:
 *
 * - **Hard-delete** (visible to everyone): always allowed when you authored
 *   the message; in server channels also allowed when you have
 *   `MANAGE_MESSAGES`. The DM context never grants delete-for-everyone to
 *   non-authors no matter the role.
 * - **Soft-hide** (only for me): exclusively a DM concept. Anyone in the DM
 *   can hide a message from their own view without touching what the other
 *   side sees.
 * - **Shift-armed remove**: held Shift turns the more-options button into an
 *   instant-remove. For own / mod actions that's a hard-delete; for non-own
 *   DM messages it falls back to soft-hide so the user can clean up their
 *   feed at a glance.
 *
 * Keep this hook free of UI state (modals, menus) — those still live in the
 * Message component itself; this hook only computes what's *possible*.
 */
export interface MessageActions {
  /** True when the viewer is the author. */
  isOwn: boolean
  /** Hard-delete on the server, visible to everyone. */
  canHardDelete: boolean
  /** Soft-hide for the viewer only — DM-only. */
  canHideForMe: boolean
  /** Either path is available — used to gate the shift-armed UI. */
  canShiftRemove: boolean
  /** Currently shift-armed (Shift is held AND a remove path exists). */
  shiftDeleteArmed: boolean
}

export interface MessageActionInputs {
  /** The message author id; falls back to a "You" sentinel for legacy data. */
  authorId?: string
  /** Legacy display field — older messages used "author === 'You'". */
  authorLabel?: string
  currentUserId?: string
  /** Whether this message lives in a DM context. */
  isDm: boolean
  /** Caller has MANAGE_MESSAGES on the surrounding channel. Server-only. */
  canManageMessages: boolean
  /** Hard-delete handler is wired (caller will invoke it). */
  onDelete?: () => void
  /** Soft-hide handler is wired (DM-only). */
  onHideForMe?: () => void
}

export function useMessageActions(input: MessageActionInputs): MessageActions {
  const shiftHeld = useShiftKey()
  const isOwn = input.authorId === input.currentUserId || input.authorLabel === 'You'

  const canHardDelete = !!input.onDelete && (input.isDm ? isOwn : (isOwn || input.canManageMessages))
  const canHideForMe = input.isDm && !!input.onHideForMe
  const canShiftRemove = canHardDelete || canHideForMe
  const shiftDeleteArmed = shiftHeld && canShiftRemove

  return { isOwn, canHardDelete, canHideForMe, canShiftRemove, shiftDeleteArmed }
}
