/**
 * Module-scoped registry that enforces "only one player active at a time".
 * Whichever player calls `takeover()` becomes the active one and every
 * other registered player gets `pause()`d.
 *
 * Why a plain singleton instead of zustand/context: the cross-component
 * coordination here is fire-and-forget (one call when a track starts,
 * one call on unmount) and we don't need any React subscription wiring —
 * the audio/video element pause is a synchronous side-effect that the
 * player's existing `pause` event handler turns back into React state
 * for the *paused* player. Adding a store would just be ceremony.
 *
 * Used by: `useNMPlayer` (video), `useNMMusic` (audio). Embeds (YouTube
 * etc.) live in iframes we can't pause from the parent, so they're not
 * registered here — best-effort scope is our own players.
 */

interface RegisteredPlayer {
  id: string
  pause: () => void
}

let active: RegisteredPlayer | null = null

/** Mark `player` as the currently-active one and pause whatever was
 *  active before. Idempotent for the same id (no self-pause). Should be
 *  called from the player's `play`/`song` event handler, not from a user
 *  click — the engine may take a moment to actually start. */
export function takeover(player: RegisteredPlayer): void {
  if (active && active.id !== player.id) {
    try { active.pause() } catch { /* engine may already be torn down */ }
  }
  active = player
}

/** Drop the registration. Should be called on unmount AND when the
 *  engine emits `pause`/`ended`/`error` so the slot frees up for the
 *  next click. Calling with a stale id is a no-op. */
export function release(id: string): void {
  if (active?.id === id) active = null
}
