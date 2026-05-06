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
  // Stringify the user-passed deps so we can detect changes during render
  // without lying to the exhaustive-deps lint rule. Deps are typically a
  // handful of primitives so the cost is negligible.
  const depsKey = JSON.stringify(deps)
  const [isRevealing, setIsRevealing] = useState(active)
  const [prevDepsKey, setPrevDepsKey] = useState(depsKey)
  const [prevActive, setPrevActive] = useState(active)

  if (active && (depsKey !== prevDepsKey || !prevActive)) {
    setPrevDepsKey(depsKey)
    setPrevActive(active)
    setIsRevealing(true)
  } else if (!active && prevActive) {
    setPrevActive(active)
    setIsRevealing(false)
  }

  useEffect(() => {
    if (!isRevealing) return
    const timer = setTimeout(
      () => setIsRevealing(false),
      durationMs ?? revealWindowMs(totalItems),
    )
    return () => clearTimeout(timer)
  }, [isRevealing, durationMs, totalItems])

  return isRevealing
}
