import type { CategoryDisplay } from '../types'

/**
 * Diff a category layout before vs. after a drag and produce the API payloads:
 *
 *  - `positions`: new global ordering across categorized + uncategorized channels
 *  - `moves`: channels whose `category_id` changed (cross-category drag)
 *
 * Skips the `persist` call entirely when the diff is a no-op (drag started and
 * ended on the same spot, or category-only reorder).
 */
export async function persistLayout(
  prevCats: CategoryDisplay[],
  nextCats: CategoryDisplay[],
  allChannelIds: string[],
  persist: (
    positions: Array<{ id: string; position: number }>,
    moves: Array<{ id: string; categoryId: string | null }>,
  ) => Promise<void>,
) {
  const prevCatById = new Map<string, string | null>()
  for (const c of prevCats) for (const id of c.channels) prevCatById.set(id, c.id)

  const positions: Array<{ id: string; position: number }> = []
  const moves: Array<{ id: string; categoryId: string | null }> = []
  let pos = 0
  const seen = new Set<string>()

  for (const c of nextCats) {
    for (const chId of c.channels) {
      positions.push({ id: chId, position: pos++ })
      seen.add(chId)
      const prevCatId = prevCatById.get(chId) ?? null
      if (prevCatId !== c.id) moves.push({ id: chId, categoryId: c.id })
    }
  }
  // Anything not in any category is uncategorized (category_id = null)
  for (const chId of allChannelIds) {
    if (seen.has(chId)) continue
    positions.push({ id: chId, position: pos++ })
    const prevCatId = prevCatById.has(chId) ? prevCatById.get(chId) ?? null : null
    if (prevCatId !== null) moves.push({ id: chId, categoryId: null })
  }

  // Skip the call if nothing actually changed — when the user starts a drag and
  // drops back in place, both flat orderings are identical and no category moves.
  const prevFlat = [
    ...prevCats.flatMap(c => c.channels),
    ...allChannelIds.filter(id => !prevCats.some(c => c.channels.includes(id))),
  ]
  const nextFlat = positions.map(p => p.id)
  const samePositions =
    prevFlat.length === nextFlat.length &&
    prevFlat.every((id, i) => id === nextFlat[i])
  if (samePositions && moves.length === 0) return

  await persist(positions, moves)
}
