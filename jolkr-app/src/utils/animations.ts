/** Duration of a single item's reveal animation (ms) */
export const REVEAL_DURATION_MS = 300

/** Delay before the first item begins animating (ms) */
export const REVEAL_BASE_MS = 20

/** Additional delay added per stagger index (ms) */
export const REVEAL_STAGGER_MS = 35

/**
 * Compute the CSS animation-delay for a given flat stagger index.
 * Index 0 → 20ms, index 1 → 55ms, index 2 → 90ms, …
 */
export function revealDelay(index: number): number {
  return REVEAL_BASE_MS + index * REVEAL_STAGGER_MS
}

/**
 * How long to keep the `isRevealing` flag true so the last item
 * finishes its animation before the flag is cleared.
 */
export function revealWindowMs(totalItems: number): number {
  return REVEAL_BASE_MS + Math.max(totalItems - 1, 0) * REVEAL_STAGGER_MS + REVEAL_DURATION_MS + 50
}

/**
 * Maximum number of messages animated on chat navigation.
 * Messages beyond this threshold (older, scrolled out of view) skip the animation entirely.
 */
export const CHAT_REVEAL_LIMIT = 20
