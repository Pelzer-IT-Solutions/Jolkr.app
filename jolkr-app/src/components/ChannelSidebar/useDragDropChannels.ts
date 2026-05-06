/**
 * Drag-and-drop hook for the ChannelSidebar.
 *
 * Owns the local category snapshot (`localCats`), the locally-created
 * channels not yet round-tripped from the server (`localExtraChannels`),
 * the dnd-kit sensors, the collision detection rule, and all four drag
 * handlers (start / over / end / cancel). Encapsulates dnd-kit so the
 * sidebar component can stay focused on rendering.
 *
 * Drag operations require MANAGE_CHANNELS — handlers no-op without it,
 * which keeps the same enable/disable behaviour the inline version had.
 *
 * The parent still drives:
 *   - the during-render reset on server-id / categories-key change
 *     (calls `setLocalCats` / `setLocalExtraChannels` returned here);
 *   - optimistic updates from the create / rename flows
 *     (also via the returned setters).
 *
 * The hook returns derived `allChannelIds` / `uncategorizedIds` so the
 * sidebar render and the drag finalisation share the same source of truth.
 */
import { useRef, useState } from 'react'
import {
  closestCenter, PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { persistLayout } from '../../utils/channelLayout'
import type { CategoryDisplay, ChannelDisplay } from '../../types'

// When dragging a category, only collide with other categories — never with
// channels inside them. Module-level because it has no closure state.
const collisionDetection: CollisionDetection = (args) => {
  const activeId = args.active.id as string
  if (activeId.startsWith('cat:')) {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        c => (c.id as string).startsWith('cat:')
      ),
    })
  }
  return closestCenter(args)
}

function findCatFor(channelId: string, cats: CategoryDisplay[]): string | null {
  return cats.find(c => c.channels.includes(channelId))?.name ?? null
}

interface UseDragDropChannelsArgs {
  initialCats: CategoryDisplay[]
  serverChannels: ChannelDisplay[]
  canManageChannels?: boolean
  onReorderChannels?: (
    positions: Array<{ id: string; position: number }>,
    moves: Array<{ id: string; categoryId: string | null }>,
  ) => Promise<void>
}

export function useDragDropChannels({
  initialCats,
  serverChannels,
  canManageChannels,
  onReorderChannels,
}: UseDragDropChannelsArgs) {
  const [localCats,          setLocalCats]          = useState<CategoryDisplay[]>(initialCats)
  const [localExtraChannels, setLocalExtraChannels] = useState<ChannelDisplay[]>([])
  const [activeDragId,       setActiveDragId]       = useState<string | null>(null)

  const dragStartCatsRef = useRef<CategoryDisplay[] | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const categorizedSet = new Set(localCats.flatMap(c => c.channels))
  const allChannelIds = [
    ...serverChannels.map(c => c.id),
    ...localExtraChannels.map(c => c.id),
  ]
  const uncategorizedIds = allChannelIds.filter(id => !categorizedSet.has(id))

  // ── DnD handlers (require MANAGE_CHANNELS) ──
  // Snapshot the categories at drag start so we can diff (move-between-categories)
  // against the post-drag layout when persisting.
  function handleDragStart({ active }: DragStartEvent) {
    if (!canManageChannels) return
    dragStartCatsRef.current = localCats
    setActiveDragId(active.id as string)
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!canManageChannels || !over) return
    const activeId = active.id as string
    const overId   = over.id   as string
    if (activeId.startsWith('cat:')) return

    const activeCat = findCatFor(activeId, localCats)
    let overCat: string | null
    if      (overId.startsWith('cat:'))  overCat = overId.slice(4)
    else if (overId === 'uncategorized') overCat = null
    else                                 overCat = findCatFor(overId, localCats)
    if (activeCat === overCat) return

    setLocalCats(prev => {
      const without = prev.map(c => ({ ...c, channels: c.channels.filter(id => id !== activeId) }))
      if (overCat === null) return without
      const toCat = without.find(c => c.name === overCat)
      if (!toCat) return without
      const overIdx = overId.startsWith('cat:') ? toCat.channels.length : toCat.channels.indexOf(overId)
      const insertAt = overIdx >= 0 ? overIdx : toCat.channels.length
      return without.map(c => {
        if (c.name !== overCat) return c
        const chs = [...c.channels]
        chs.splice(insertAt, 0, activeId)
        return { ...c, channels: chs }
      })
    })
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveDragId(null)
    const startCats = dragStartCatsRef.current
    dragStartCatsRef.current = null
    if (!canManageChannels || !over || active.id === over.id) return
    const activeId = active.id as string
    const overId   = over.id   as string

    if (activeId.startsWith('cat:') && overId.startsWith('cat:')) {
      // Category reorder is local-only — backend has no category-reorder endpoint yet.
      setLocalCats(prev => {
        const from = prev.findIndex(c => `cat:${c.name}` === activeId)
        const to   = prev.findIndex(c => `cat:${c.name}` === overId)
        return from >= 0 && to >= 0 ? arrayMove(prev, from, to) : prev
      })
      return
    }

    // Channel drag — finalize same-category sort (cross-category was already
    // applied in handleDragOver), then derive the diff against the drag-start
    // snapshot and persist.
    setLocalCats(prev => {
      const activeCat = prev.find(c => c.channels.includes(activeId))
      const overCat   = prev.find(c => c.channels.includes(overId))
      let next = prev
      if (activeCat && overCat && activeCat.name === overCat.name) {
        const from = activeCat.channels.indexOf(activeId)
        const to   = activeCat.channels.indexOf(overId)
        next = prev.map(c =>
          c.name === activeCat.name ? { ...c, channels: arrayMove(c.channels, from, to) } : c
        )
      }
      if (startCats && onReorderChannels) {
        const categorizedNow = new Set(next.flatMap(c => c.channels))
        const uncategorizedNow = allChannelIds.filter(id => !categorizedNow.has(id))
        void persistLayout(startCats, next, uncategorizedNow, onReorderChannels)
      }
      return next
    })
  }

  function handleDragCancel() {
    setActiveDragId(null)
    dragStartCatsRef.current = null
  }

  return {
    localCats, setLocalCats,
    localExtraChannels, setLocalExtraChannels,
    activeDragId,
    sensors,
    collisionDetection,
    allChannelIds,
    uncategorizedIds,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  }
}
