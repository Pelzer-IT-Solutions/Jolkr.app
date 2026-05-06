import { useEffect, useState } from 'react'
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
  // Store the previous deps as a stringified key so we can react to changes
  // during render (the canonical "reset state when X changes" pattern in
  // React 19; an effect-body setState would trigger react-hooks/set-state-in-effect).
  const depsKey = JSON.stringify(deps)
  const [prevDepsKey, setPrevDepsKey] = useState(depsKey)
  if (depsKey !== prevDepsKey) {
    setPrevDepsKey(depsKey)
    if (active) setIsRevealing(true)
  }

  useEffect(() => {
    if (!active || !isRevealing) return
    const timer = setTimeout(
      () => setIsRevealing(false),
      durationMs ?? revealWindowMs(totalItems),
    )
    return () => clearTimeout(timer)
  }, [active, isRevealing, durationMs, totalItems])

  return isRevealing
}
