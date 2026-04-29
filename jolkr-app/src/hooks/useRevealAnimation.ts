import { useLayoutEffect, useState } from 'react'
import type { DependencyList } from 'react'
import { revealWindowMs } from '../utils/animations'

/**
 * Manages the reveal-animation flag for staggered entrance animations.
 * Sets isRevealing to true when deps change, then clears it after
 * the calculated animation window.
 *
 * @param totalItems  Number of items to stagger (feeds revealWindowMs)
 * @param deps        Dependency list — re-triggers animation when any dep changes
 * @param active      When false, skips the animation (e.g. panel not visible). Defaults to true.
 * @param durationMs  Override the auto-calculated duration
 */
export function useRevealAnimation(
  totalItems: number,
  deps: DependencyList,
  active = true,
  durationMs?: number,
): boolean {
  const [isRevealing, setIsRevealing] = useState(active)

  useLayoutEffect(() => {
    if (!active) return
    setIsRevealing(true)
    const timer = setTimeout(
      () => setIsRevealing(false),
      durationMs ?? revealWindowMs(totalItems),
    )
    return () => clearTimeout(timer)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  return isRevealing
}
