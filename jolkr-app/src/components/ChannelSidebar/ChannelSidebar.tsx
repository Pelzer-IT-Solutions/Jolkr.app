import {
  DndContext, DragOverlay, closestCenter,
  PointerSensor, useSensor, useSensors,
  useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, PanelLeftClose, ArrowLeft, ChevronDown, FolderPlus, Hash, Volume2, Trash2, Archive, Edit3, MoreHorizontal, Settings } from 'lucide-react'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useT } from '../../hooks/useT'
import { revealDelay, revealWindowMs } from '../../utils/animations'
import { Menu, MenuItem, MenuDivider } from '../Menu'
import { ThemePicker } from '../ThemePicker/ThemePicker'
import { ConfirmDialog } from '../ui/ConfirmDialog/ConfirmDialog'
import s from './ChannelSidebar.module.css'
import type { ChannelMoveItem } from '../../api/client'
import type { ServerDisplay, ChannelDisplay, CategoryDisplay, ServerTheme } from '../../types'
import type { ColorPreference } from '../../utils/colorMode'

// Diff the layout before vs. after a drag and produce the API payloads:
function buildChannelMoveItems(
  prevCats: CategoryDisplay[],
  prevUncat: string[],
  nextCats: CategoryDisplay[],
  nextUncat: string[],
): ChannelMoveItem[] {
  const prevCatById = new Map<string, string | null>()
  for (const c of prevCats) for (const id of c.channels) prevCatById.set(id, c.id)
  for (const id of prevUncat) prevCatById.set(id, null)

  const items: ChannelMoveItem[] = []
  let pos = 0

  for (const id of nextUncat) {
    const prev = prevCatById.get(id) ?? null
    const item: ChannelMoveItem = { id, position: pos++ }
    if (prev !== null) item.category_id = null
    items.push(item)
  }
  for (const c of nextCats) {
    for (const id of c.channels) {
      const prev = prevCatById.get(id) ?? null
      const item: ChannelMoveItem = { id, position: pos++ }
      if (prev !== c.id) item.category_id = c.id
      items.push(item)
    }
  }

  const prevFlat = [...prevUncat, ...prevCats.flatMap(c => c.channels)]
  const nextFlat = items.map(i => i.id)
  const samePositions =
    prevFlat.length === nextFlat.length &&
    prevFlat.every((id, i) => id === nextFlat[i])
  const anyCategoryChange = items.some(i => 'category_id' in i)
  if (samePositions && !anyCategoryChange) return []

  return items
}

// When dragging a category, only collide with other categories — never with channels inside them
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

interface Props {
  server:          ServerDisplay
  activeChannelId: string
  onSwitch:        (id: string) => void
  onCollapse:      () => void
  collapsed:       boolean
  isMobile?:       boolean
  theme:           ServerTheme
  onThemeChange:   (theme: ServerTheme) => void
  isDark:          boolean
  colorPref:       ColorPreference
  onSetColorPref:  (pref: ColorPreference) => void
  onOpenSettings?: () => void
  canManageChannels?: boolean
  canEditTheme?:      boolean
  onCreateChannel?:   (name: string, kind: 'text' | 'voice', categoryId?: string) => Promise<void>
  onCreateCategory?:  (name: string) => Promise<void>
  onDeleteChannel?:   (channelId: string) => Promise<void>
  onDeleteCategory?:  (categoryId: string) => Promise<void>
  onRenameChannel?:   (channelId: string, newName: string) => Promise<void>
  onRenameCategory?:  (categoryId: string, newName: string) => Promise<void>
  onArchiveChannel?:  (channelId: string) => Promise<void>
  onOpenChannelSettings?: (channelId: string) => void
  onReorderCategories?: (positions: Array<{ id: string; position: number }>) => Promise<void>
  onReorderChannels?: (items: ChannelMoveItem[]) => Promise<void>
}

export function ChannelSidebar({ server, activeChannelId, onSwitch, onCollapse, collapsed, isMobile = false, theme, onThemeChange, isDark, colorPref, onSetColorPref, onOpenSettings: _onOpenSettings, canManageChannels, canEditTheme, onCreateChannel, onCreateCategory, onDeleteChannel, onDeleteCategory, onRenameChannel, onRenameCategory, onArchiveChannel, onOpenChannelSettings, onReorderChannels, onReorderCategories }: Props) {
  const { t } = useT()

  // Channel ids that have no category in the props snapshot. Used as the base
  // for the uncategorized lane; tempChannels in `tempChannelCat` with a null
  // parent are appended at render time.
  const initialUncategorized = useMemo(() => {
    const inCat = new Set(server.categories.flatMap(c => c.channels))
    return server.channels.map(c => c.id).filter(id => !inCat.has(id))
  }, [server.categories, server.channels])

  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())

  // Transient drag layout — exists only while a drag is in progress. dnd-kit's
  // onDragOver mutates it; onDragEnd snapshots the final shape, fires the store
  // action, and resets it to null so the next render reads straight from props
  // (= store-state, single source-of-truth).
  const [dragLayout, setDragLayout] = useState<{ cats: CategoryDisplay[]; uncat: string[] } | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)

  // Optimistic-create temp items, distinct from the drag-layout. They appear in
  // the UI between the user pressing Enter on the inline input and the BE
  // round-trip (createCategory/createChannel + refetch) populating the store.
  // Each entry is removed once its create-promise resolves (success or fail).
  const [tempCats, setTempCats] = useState<CategoryDisplay[]>([])
  const [tempChannels, setTempChannels] = useState<ChannelDisplay[]>([])
  // tempChannelId → parent categoryId (null = uncategorized). Decoupled from
  // tempChannels so a tempChannel that lives in a real category still merges
  // cleanly into the rendered layout.
  const [tempChannelCat, setTempChannelCat] = useState<Record<string, string | null>>({})

  // ── Context menus ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [channelContextMenu, setChannelContextMenu] = useState<{ x: number; y: number; channelId: string } | null>(null)
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ x: number; y: number; categoryId: string } | null>(null)
  // Pending delete-confirmations. Holds the target id while the modal is open.
  const [pendingDeleteChannelId, setPendingDeleteChannelId] = useState<string | null>(null)
  const [pendingDeleteCategoryId, setPendingDeleteCategoryId] = useState<string | null>(null)
  // `categoryId` (when set on a channel-create) routes the new channel into a
  // specific folder. Without it, the channel is created uncategorized.
  // `kind` selects text vs voice — chosen at menu-open time, then carried
  // through to the optimistic icon and the backend `kind` field.
  type CreatingState =
    | { type: 'folder' }
    | { type: 'channel'; kind: 'text' | 'voice'; categoryId?: string }
  const [creating,    setCreating]    = useState<CreatingState | null>(null)
  const [newName,     setNewName]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Inline rename ──
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // ── Category rename ──
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCatName, setEditingCatName] = useState('')
  const catRenameInputRef = useRef<HTMLInputElement>(null)

  // Reset collapsed-state + replay reveal animation on server switch only.
  // Other prop changes (rename, reorder, etc.) flow directly through render
  // — no mirror to sync.
  const prevServerRef = useRef(server.id)
  useEffect(() => {
    if (prevServerRef.current === server.id) return
    prevServerRef.current = server.id
    setCollapsedCats(new Set())
    setIsRevealing(true)
    const totalItems =
      server.categories.length +
      server.categories.reduce((sum, c) => sum + c.channels.length, 0) +
      initialUncategorized.length
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(totalItems))
    return () => clearTimeout(timer)
  }, [server.id, server.categories, initialUncategorized])

  useEffect(() => {
    if (!creating) return
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [creating])

  useEffect(() => {
    if (!editingChannelId) return
    const timer = setTimeout(() => renameInputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [editingChannelId])

  useEffect(() => {
    if (!editingCategoryId) return
    const timer = setTimeout(() => catRenameInputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [editingCategoryId])

  // ── Base layout (no drag active): props + temp items merged ──
  const baseCats: CategoryDisplay[] = useMemo(() => {
    const merged: CategoryDisplay[] = [...server.categories, ...tempCats]
    if (Object.keys(tempChannelCat).length === 0) return merged
    return merged.map(cat => {
      const inserts: string[] = []
      for (const [tempId, parentId] of Object.entries(tempChannelCat)) {
        if (parentId === cat.id) inserts.push(tempId)
      }
      return inserts.length > 0 ? { ...cat, channels: [...cat.channels, ...inserts] } : cat
    })
  }, [server.categories, tempCats, tempChannelCat])

  const baseUncat: string[] = useMemo(() => {
    const uncatTemps: string[] = []
    for (const [tempId, parentId] of Object.entries(tempChannelCat)) {
      if (parentId === null) uncatTemps.push(tempId)
    }
    return uncatTemps.length > 0 ? [...initialUncategorized, ...uncatTemps] : initialUncategorized
  }, [initialUncategorized, tempChannelCat])

  // Active layout — drag wins, else base (= store-derived).
  const renderedCats = dragLayout?.cats ?? baseCats
  const renderedUncat = dragLayout?.uncat ?? baseUncat

  // SortableCategory isn't React.memo, so memoizing this map produced no
  // re-render savings — keep the build inline. (A memo-wrap on the child
  // would help but requires stabilising ~25 prop identities first; out of
  // scope for this perf pass.)
  const channelMap: Record<string, ChannelDisplay> = {
    ...Object.fromEntries(server.channels.map(c => [c.id, c])),
    ...Object.fromEntries(tempChannels.map(c => [c.id, c])),
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // Stable identities — feeds SortableContext items={...}, which re-binds
  // droppables when the array reference changes. Recompute only on layout
  // changes (drag, optimistic create, store updates).
  const categorizedSet = useMemo(() => new Set(renderedCats.flatMap(c => c.channels)), [renderedCats])
  const uncategorizedIds = useMemo(() => renderedUncat.filter(id => !categorizedSet.has(id)), [renderedUncat, categorizedSet])

  function findCatIdFor(channelId: string, cats: CategoryDisplay[]): string | null {
    return cats.find(c => c.channels.includes(channelId))?.id ?? null
  }

  function toggleCat(id: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ── Inline rename handlers ──
  function startChannelRename(channel: ChannelDisplay) {
    if (!canManageChannels) return
    setEditingChannelId(channel.id)
    setEditingName(channel.name)
  }

  function saveChannelRename(channelId: string) {
    const name = editingName.trim()
    if (name && name !== channelMap[channelId]?.name) {
      // Mirror the rename into temp items so an in-flight tempChannel still
      // shows the new name until the BE round-trip lands. Real channels flow
      // through the store-action's optimistic+rollback path.
      setTempChannels(prev => prev.map(ch =>
        ch.id === channelId ? { ...ch, name } : ch
      ))
      onRenameChannel?.(channelId, name)
    }
    setEditingChannelId(null)
    setEditingName('')
  }

  function cancelChannelRename() {
    setEditingChannelId(null)
    setEditingName('')
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, channelId: string) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveChannelRename(channelId)
    } else if (e.key === 'Escape') {
      cancelChannelRename()
    }
  }

  // ── Category rename handlers ──
  function startCategoryRename(category: CategoryDisplay) {
    if (!canManageChannels) return
    setEditingCategoryId(category.id)
    setEditingCatName(category.name)
  }

  function saveCategoryRename(categoryId: string) {
    const name = editingCatName.trim()
    const current = renderedCats.find(c => c.id === categoryId)
    if (current && name && name !== current.name) {
      // Mirror into tempCats so a still-pending optimistic temp folder shows
      // the new name. Real categories rename via the parent handler → store.
      setTempCats(prev => prev.map(cat =>
        cat.id === categoryId ? { ...cat, name } : cat
      ))
      onRenameCategory?.(categoryId, name)
    }
    setEditingCategoryId(null)
    setEditingCatName('')
  }

  function cancelCategoryRename() {
    setEditingCategoryId(null)
    setEditingCatName('')
  }

  function handleCatRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, categoryId: string) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveCategoryRename(categoryId)
    } else if (e.key === 'Escape') {
      cancelCategoryRename()
    }
  }

  const addBtnRef = useRef<HTMLButtonElement>(null)

  // ── Context menu helpers ──
  function closeAllMenus() {
    setContextMenu(null)
    setChannelContextMenu(null)
    setCategoryContextMenu(null)
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!canManageChannels) return          // nothing to show without permissions
    e.preventDefault()
    closeAllMenus()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleChannelContextMenu(e: React.MouseEvent, channelId: string) {
    if (!canManageChannels) return          // nothing to show without permissions
    e.preventDefault()
    e.stopPropagation()
    closeAllMenus()
    setChannelContextMenu({ x: e.clientX, y: e.clientY, channelId })
  }

  function handleFolderContextMenu(e: React.MouseEvent, folderId: string) {
    if (!canManageChannels) return          // nothing to show without permissions
    e.preventDefault()
    e.stopPropagation()
    closeAllMenus()
    setCategoryContextMenu({ x: e.clientX, y: e.clientY, categoryId: folderId })
  }

  function handleAddClick() {
    const rect = addBtnRef.current?.getBoundingClientRect()
    if (rect) {
      closeAllMenus()
      setContextMenu({ x: rect.left, y: rect.bottom + 4 })
    }
  }

  function startCreating(state: CreatingState) {
    setContextMenu(null)
    setCategoryContextMenu(null)
    setCreating(state)
    setNewName('')
  }

  async function confirmCreate(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setCreating(null); return }
    if (e.key !== 'Enter') return
    const name = newName.trim()
    if (!name) { setCreating(null); return }

    // Capture the active intent before clearing state
    const intent = creating
    setCreating(null)
    setNewName('')
    if (!intent) return

    if (intent.type === 'folder') {
      const tempId = `cat-${Date.now()}`
      setTempCats(prev => [...prev, { id: tempId, name, channels: [] }])
      try {
        await onCreateCategory?.(name)
      } catch (err) {
        console.error('Failed to create:', err)
      } finally {
        // Real entry has either landed in the store (success) or never will
        // (failure) — drop the temp either way.
        setTempCats(prev => prev.filter(c => c.id !== tempId))
      }
    } else {
      const tempId = `ch-${Date.now()}`
      const tempIcon = intent.kind === 'voice' ? '🔊' : '#'
      setTempChannels(prev => [...prev, { id: tempId, name, icon: tempIcon, desc: '', unread: 0, kind: intent.kind }])
      setTempChannelCat(prev => ({ ...prev, [tempId]: intent.categoryId ?? null }))
      try {
        await onCreateChannel?.(name, intent.kind, intent.categoryId)
      } catch (err) {
        console.error('Failed to create:', err)
      } finally {
        setTempChannels(prev => prev.filter(c => c.id !== tempId))
        setTempChannelCat(prev => {
          const { [tempId]: _, ...rest } = prev
          return rest
        })
      }
    }
  }

  const dragStartLayoutRef = useRef<{ cats: CategoryDisplay[]; uncat: string[] } | null>(null)
  function handleDragStart({ active }: DragStartEvent) {
    if (!canManageChannels) return
    const snapshot = { cats: baseCats, uncat: baseUncat }
    dragStartLayoutRef.current = snapshot
    setDragLayout(snapshot)
    setActiveDragId(active.id as string)
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!canManageChannels || !over) return
    const activeId = active.id as string
    const overId   = over.id   as string
    if (activeId.startsWith('cat:')) return

    setDragLayout(prev => {
      if (!prev) return prev
      const activeCat = findCatIdFor(activeId, prev.cats)
      let overCat: string | null
      if      (overId.startsWith('cat:'))  overCat = overId.slice(4)
      else if (overId === 'uncategorized') overCat = null
      else                                 overCat = findCatIdFor(overId, prev.cats)
      if (activeCat === overCat) return prev

      if (overCat === null) {
        const catsNext = prev.cats.map(c => ({ ...c, channels: c.channels.filter(id => id !== activeId) }))
        if (prev.uncat.includes(activeId)) return { cats: catsNext, uncat: prev.uncat }
        const overIdx = overId === 'uncategorized' ? prev.uncat.length : prev.uncat.indexOf(overId)
        const insertAt = overIdx >= 0 ? overIdx : prev.uncat.length
        const uncatNext = [...prev.uncat]
        uncatNext.splice(insertAt, 0, activeId)
        return { cats: catsNext, uncat: uncatNext }
      }

      const uncatNext = prev.uncat.filter(id => id !== activeId)
      const without = prev.cats.map(c => ({ ...c, channels: c.channels.filter(id => id !== activeId) }))
      const toCat = without.find(c => c.id === overCat)
      if (!toCat) return { cats: without, uncat: uncatNext }
      const overIdx = overId.startsWith('cat:') ? toCat.channels.length : toCat.channels.indexOf(overId)
      const insertAt = overIdx >= 0 ? overIdx : toCat.channels.length
      const catsNext = without.map(c => {
        if (c.id !== overCat) return c
        const chs = [...c.channels]
        chs.splice(insertAt, 0, activeId)
        return { ...c, channels: chs }
      })
      return { cats: catsNext, uncat: uncatNext }
    })
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const startLayout = dragStartLayoutRef.current
    const endLayout = dragLayout
    dragStartLayoutRef.current = null
    setActiveDragId(null)
    setDragLayout(null)

    if (!canManageChannels || !over || active.id === over.id) return
    if (!endLayout) return

    const activeId = active.id as string
    const overId   = over.id   as string

    if (activeId.startsWith('cat:') && overId.startsWith('cat:')) {
      const from = endLayout.cats.findIndex(c => `cat:${c.id}` === activeId)
      const to   = endLayout.cats.findIndex(c => `cat:${c.id}` === overId)
      if (from < 0 || to < 0) return
      const next = arrayMove(endLayout.cats, from, to)
      const positions = next.map((c, i) => ({ id: c.id, position: i }))
      if (onReorderCategories) void onReorderCategories(positions)
      return
    }

    let nextCats = endLayout.cats
    let nextUncat = endLayout.uncat

    const activeInUncat = nextUncat.includes(activeId)
    const overInUncat = overId === 'uncategorized' || nextUncat.includes(overId)
    if (activeInUncat && overInUncat && overId !== 'uncategorized' && activeId !== overId) {
      const from = nextUncat.indexOf(activeId)
      const to   = nextUncat.indexOf(overId)
      if (from >= 0 && to >= 0) {
        nextUncat = arrayMove(nextUncat, from, to)
      }
    } else {
      const activeCat = nextCats.find(c => c.channels.includes(activeId))
      const overCat   = nextCats.find(c => c.channels.includes(overId))
      if (activeCat && overCat && activeCat.id === overCat.id) {
        const from = activeCat.channels.indexOf(activeId)
        const to   = activeCat.channels.indexOf(overId)
        nextCats = nextCats.map(c =>
          c.id === activeCat.id ? { ...c, channels: arrayMove(c.channels, from, to) } : c
        )
      }
    }

    if (startLayout && onReorderChannels) {
      const items = buildChannelMoveItems(startLayout.cats, startLayout.uncat, nextCats, nextUncat)
      if (items.length > 0) void onReorderChannels(items)
    }
  }

  function handleDragCancel() {
    dragStartLayoutRef.current = null
    setActiveDragId(null)
    setDragLayout(null)
  }

  const activeChannel = activeDragId && !activeDragId.startsWith('cat:') ? channelMap[activeDragId] : null
  const activeCatId   = activeDragId?.startsWith('cat:') ? activeDragId.slice(4) : null
  const activeCatName = activeCatId ? renderedCats.find(c => c.id === activeCatId)?.name ?? null : null
  const catIds = useMemo(() => renderedCats.map(c => `cat:${c.id}`), [renderedCats])

  // Pre-compute flat stagger indices so each category header and each channel
  // within that category receives a unique, monotonically-increasing index.
  // Memoized so reveal-animation deps stay stable when no layout change happens.
  const { catMeta, uncatStaggerStart } = useMemo(() => {
    let idx = 0
    const meta = renderedCats.map(cat => {
      const catStaggerIdx    = idx++
      const chanStaggerStart = idx
      idx += cat.channels.length
      return { catStaggerIdx, chanStaggerStart }
    })
    return { catMeta: meta, uncatStaggerStart: idx }
  }, [renderedCats])

  return (
    <aside className={`${s.sidebar} ${collapsed ? s.collapsed : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-small txt-semibold`}>{t('channelSidebar.title')}</span>
        <div className={s.actions}>
          {canManageChannels && (
            <button ref={addBtnRef} className={s.iconBtn} title={t('channelSidebar.newChannel')} aria-label={t('channelSidebar.newChannel')} onClick={handleAddClick}><PlusIcon /></button>
          )}
          {canEditTheme && (
            <ThemePicker
              theme={theme}
              onChange={onThemeChange}
              isDark={isDark}
              colorPref={colorPref}
              onSetColorPref={onSetColorPref}
            />
          )}
          <button
            className={s.iconBtn}
            title={isMobile ? t('channelSidebar.backToChat') : t('channelSidebar.collapseSidebar')}
            aria-label={isMobile ? t('channelSidebar.backToChat') : t('channelSidebar.collapseSidebar')}
            onClick={onCollapse}
          >
            {isMobile ? <ArrowLeft size={14} strokeWidth={1.5} /> : <CollapseIcon />}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <nav
          aria-label={t('channelSidebar.ariaServerChannels')}
          className={`${s.scroll} scrollbar-thin scroll-view-y`}
          onContextMenu={handleContextMenu}
        >
          <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
            {renderedCats.map((cat, i) => {
              const isCreatingHere = creating?.type === 'channel' && creating.categoryId === cat.id
              // Force the folder open so the inline input is visible
              const isCollapsed = isCreatingHere ? false : collapsedCats.has(cat.id)
              return (
                <SortableCategory
                  key={cat.id}
                  cat={cat}
                  channelMap={channelMap}
                  activeChannelId={activeChannelId}
                  onSwitch={onSwitch}
                  collapsed={isCollapsed}
                  onToggle={() => toggleCat(cat.id)}
                  activeDragId={activeDragId}
                  isRevealing={isRevealing}
                  catStaggerIdx={catMeta[i].catStaggerIdx}
                  chanStaggerStart={catMeta[i].chanStaggerStart}
                  onChannelContextMenu={canManageChannels ? handleChannelContextMenu : undefined}
                  onFolderContextMenu={canManageChannels ? handleFolderContextMenu : undefined}
                  isCatEditing={editingCategoryId === cat.id}
                  editingCatName={editingCatName}
                  onStartCatRename={() => startCategoryRename(cat)}
                  onSaveCatRename={() => saveCategoryRename(cat.id)}
                  onCatRenameKeyDown={(e) => handleCatRenameKeyDown(e, cat.id)}
                  onCatRenameChange={setEditingCatName}
                  catRenameInputRef={catRenameInputRef}
                  editingChannelId={editingChannelId}
                  editingName={editingName}
                  onStartChannelRename={startChannelRename}
                  onSaveChannelRename={saveChannelRename}
                  onRenameKeyDown={handleRenameKeyDown}
                  onRenameChange={setEditingName}
                  renameInputRef={renameInputRef}
                  onOpenChannelSettings={onOpenChannelSettings}
                  canManageChannels={canManageChannels}
                  inlineCreateChannel={isCreatingHere && creating?.type === 'channel' ? (
                    <div className={s.newItemRow}>
                      <span className={s.newItemIcon}>
                        {creating.kind === 'voice'
                          ? <Volume2 size={13} strokeWidth={1.5} />
                          : <Hash size={13} strokeWidth={1.5} />}
                      </span>
                      <input
                        ref={inputRef}
                        className={`${s.newItemInput} txt-small`}
                        placeholder={creating.kind === 'voice' ? t('channelSidebar.placeholderVoice') : t('channelSidebar.placeholderText')}
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={confirmCreate}
                        onBlur={() => setCreating(null)}
                      />
                    </div>
                  ) : undefined}
                />
              )
            })}
          </SortableContext>

          {/* ── Loose channels (no folder) ── */}
          <UncategorizedZone>
            <SortableContext items={uncategorizedIds} strategy={verticalListSortingStrategy}>
              {uncategorizedIds.map((id, i) => {
                const ch = channelMap[id]
                if (!ch) return null
                return (
                  <SortableChannelRow
                    key={ch.id}
                    id={ch.id}
                    channel={ch}
                    active={ch.id === activeChannelId}
                    onClick={() => onSwitch(ch.id)}
                    isRevealing={isRevealing}
                    staggerIdx={uncatStaggerStart + i}
                    onContextMenu={canManageChannels ? handleChannelContextMenu : undefined}
                    isEditing={editingChannelId === ch.id}
                    editingName={editingName}
                    onStartRename={() => startChannelRename(ch)}
                    onSaveRename={() => saveChannelRename(ch.id)}
                    onRenameKeyDown={(e) => handleRenameKeyDown(e, ch.id)}
                    onRenameChange={setEditingName}
                    renameInputRef={renameInputRef}
                    onOpenChannelSettings={onOpenChannelSettings}
                    canManageChannels={canManageChannels}
                  />
                )
              })}
            </SortableContext>
          </UncategorizedZone>

          {/* ── Inline creation input — only rendered here for folder creation
              and uncategorized channel creation. Per-folder channel creation
              renders the input inside the category itself (SortableCategory). */}
          {creating && (creating.type === 'folder' || !creating.categoryId) && (
            <div className={s.newItemRow}>
              <span className={s.newItemIcon}>
                {creating.type === 'folder'
                  ? <FolderPlus size={13} strokeWidth={1.5} />
                  : creating.kind === 'voice'
                    ? <Volume2 size={13} strokeWidth={1.5} />
                    : <Hash size={13} strokeWidth={1.5} />}
              </span>
              <input
                ref={inputRef}
                className={`${s.newItemInput} txt-small`}
                placeholder={
                  creating.type === 'folder' ? t('channelSidebar.placeholderFolder') :
                  creating.kind === 'voice' ? t('channelSidebar.placeholderVoice') :
                  t('channelSidebar.placeholderText')
                }
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={confirmCreate}
                onBlur={() => setCreating(null)}
              />
            </div>
          )}
        </nav>

        <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
          {activeChannel && (
            <div className={s.dragOverlay}>
              <ChannelRow channel={activeChannel} active={false} onClick={() => {}} />
            </div>
          )}
          {activeCatName && (
            <div className={`${s.dragOverlay} ${s.dragOverlayCat}`}>
              <span className={`${s.categoryName} txt-tiny txt-semibold`}>{activeCatName}</span>
              <ChevronDown size={11} strokeWidth={2} className={s.chevron} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* ── Add / empty-space menu ── */}
      <Menu open={contextMenu !== null} position={contextMenu ?? { x: 0, y: 0 }} onClose={() => setContextMenu(null)}>
        <MenuItem icon={<FolderPlus size={13} strokeWidth={1.5} />} label={t('channelSidebar.menuNewFolder')} onClick={() => startCreating({ type: 'folder' })} />
        <MenuItem icon={<Hash size={13} strokeWidth={1.5} />} label={t('channelSidebar.menuNewText')} onClick={() => startCreating({ type: 'channel', kind: 'text' })} />
        <MenuItem icon={<Volume2 size={13} strokeWidth={1.5} />} label={t('channelSidebar.menuNewVoice')} onClick={() => startCreating({ type: 'channel', kind: 'voice' })} />
      </Menu>

      {/* ── Channel context menu ── */}
      <Menu open={channelContextMenu !== null} position={channelContextMenu ?? { x: 0, y: 0 }} onClose={() => setChannelContextMenu(null)}>
        {onOpenChannelSettings && channelContextMenu && (
          <MenuItem
            icon={<Settings size={13} strokeWidth={1.5} />}
            label={t('channelSidebar.menuChannelSettings')}
            onClick={() => {
              onOpenChannelSettings(channelContextMenu.channelId)
              setChannelContextMenu(null)
            }}
          />
        )}
        {canManageChannels && channelContextMenu && (
          <MenuItem
            icon={<Edit3 size={13} strokeWidth={1.5} />}
            label={t('channelSidebar.menuRenameChannel')}
            onClick={() => {
              const channel = channelMap[channelContextMenu.channelId]
              if (channel) startChannelRename(channel)
              setChannelContextMenu(null)
            }}
          />
        )}
        {onArchiveChannel && channelContextMenu && (
          <MenuItem
            icon={<Archive size={13} strokeWidth={1.5} />}
            label={t('channelSidebar.menuArchiveChannel')}
            onClick={() => {
              onArchiveChannel(channelContextMenu.channelId)
              setChannelContextMenu(null)
            }}
          />
        )}
        {onDeleteChannel && channelContextMenu && (
          <>
            <MenuDivider />
            <MenuItem
              icon={<Trash2 size={13} strokeWidth={1.5} />}
              label={t('channelSidebar.menuDeleteChannel')}
              danger
              onClick={() => {
                setPendingDeleteChannelId(channelContextMenu.channelId)
                setChannelContextMenu(null)
              }}
            />
          </>
        )}
      </Menu>

      {/* ── Category/folder context menu ── */}
      <Menu open={categoryContextMenu !== null} position={categoryContextMenu ?? { x: 0, y: 0 }} onClose={() => setCategoryContextMenu(null)}>
        {canManageChannels && categoryContextMenu && onCreateChannel && (() => {
          const category = renderedCats.find(c => c.id === categoryContextMenu.categoryId)
          if (!category) return null
          const startInFolder = (kind: 'text' | 'voice') => {
            // Make sure the folder is expanded so the inline input is visible
            setCollapsedCats(prev => {
              if (!prev.has(category.id)) return prev
              const next = new Set(prev)
              next.delete(category.id)
              return next
            })
            startCreating({ type: 'channel', kind, categoryId: category.id })
          }
          return (
            <>
              <MenuItem
                icon={<Hash size={13} strokeWidth={1.5} />}
                label={t('channelSidebar.menuCreateText')}
                onClick={() => startInFolder('text')}
              />
              <MenuItem
                icon={<Volume2 size={13} strokeWidth={1.5} />}
                label={t('channelSidebar.menuCreateVoice')}
                onClick={() => startInFolder('voice')}
              />
            </>
          )
        })()}
        {canManageChannels && categoryContextMenu && (
          <MenuItem
            icon={<Edit3 size={13} strokeWidth={1.5} />}
            label={t('channelSidebar.menuRenameFolder')}
            onClick={() => {
              const category = renderedCats.find(c => c.id === categoryContextMenu.categoryId)
              if (category) startCategoryRename(category)
              setCategoryContextMenu(null)
            }}
          />
        )}
        {onDeleteCategory && categoryContextMenu && (
          <>
            <MenuDivider />
            <MenuItem
              icon={<Trash2 size={13} strokeWidth={1.5} />}
              label={t('channelSidebar.menuDeleteFolder')}
              danger
              onClick={() => {
                setPendingDeleteCategoryId(categoryContextMenu.categoryId)
                setCategoryContextMenu(null)
              }}
            />
          </>
        )}
      </Menu>

      <ConfirmDialog
        open={pendingDeleteChannelId !== null}
        title={t('channelSidebar.menuDeleteChannel')}
        body={t('channelSidebar.confirmDeleteChannel')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          if (pendingDeleteChannelId && onDeleteChannel) onDeleteChannel(pendingDeleteChannelId)
          setPendingDeleteChannelId(null)
        }}
        onCancel={() => setPendingDeleteChannelId(null)}
      />

      <ConfirmDialog
        open={pendingDeleteCategoryId !== null}
        title={t('channelSidebar.menuDeleteFolder')}
        body={t('channelSidebar.confirmDeleteFolder')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          if (pendingDeleteCategoryId && onDeleteCategory) onDeleteCategory(pendingDeleteCategoryId)
          setPendingDeleteCategoryId(null)
        }}
        onCancel={() => setPendingDeleteCategoryId(null)}
      />
    </aside>
  )
}

/* ── Sortable category wrapper ── */
function SortableCategory({ cat, channelMap, activeChannelId, onSwitch, collapsed, onToggle, activeDragId: _activeDragId, isRevealing, catStaggerIdx, chanStaggerStart, onChannelContextMenu, onFolderContextMenu, isCatEditing, editingCatName, onStartCatRename, onSaveCatRename, onCatRenameKeyDown, onCatRenameChange, catRenameInputRef, editingChannelId, editingName, onStartChannelRename, onSaveChannelRename, onRenameKeyDown, onRenameChange, renameInputRef, onOpenChannelSettings, canManageChannels, inlineCreateChannel }: {
  cat:             CategoryDisplay
  channelMap:      Record<string, ChannelDisplay>
  activeChannelId: string
  onSwitch:        (id: string) => void
  collapsed:       boolean
  onToggle:        () => void
  activeDragId:    string | null
  isRevealing:     boolean
  catStaggerIdx:   number
  chanStaggerStart: number
  onChannelContextMenu?: (e: React.MouseEvent, channelId: string) => void
  onFolderContextMenu?: (e: React.MouseEvent, folderId: string) => void
  isCatEditing?:   boolean
  editingCatName?: string
  onStartCatRename?: () => void
  onSaveCatRename?: () => void
  onCatRenameKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCatRenameChange?: (value: string) => void
  catRenameInputRef?: React.RefObject<HTMLInputElement | null>
  editingChannelId?: string | null
  editingName?: string
  onStartChannelRename?: (channel: ChannelDisplay) => void
  onSaveChannelRename?: (channelId: string) => void
  onRenameKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>, channelId: string) => void
  onRenameChange?: (value: string) => void
  renameInputRef?: React.RefObject<HTMLInputElement | null>
  onOpenChannelSettings?: (channelId: string) => void
  canManageChannels?: boolean
  /** Inline "new channel" input rendered after this category's channels. */
  inlineCreateChannel?: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `cat:${cat.id}`,
    disabled: !canManageChannels,
  })

  // Don't allow dragging while editing
  if (isCatEditing) {
    return (
      <div
        ref={setNodeRef}
        className={`${s.category} ${isDragging ? s.draggingPlaceholder : ''}`}
      >
        {/* Category header — editing mode */}
        <div className={`${s.categoryHeader} ${s.editing} ${isRevealing ? 'revealing' : ''}`}
          style={isRevealing ? { '--reveal-delay': `${revealDelay(catStaggerIdx)}ms` } as React.CSSProperties : undefined}
        >
          <input
            ref={catRenameInputRef}
            className={`${s.categoryRenameInput} txt-tiny txt-semibold`}
            value={editingCatName}
            onChange={e => onCatRenameChange?.(e.target.value)}
            onKeyDown={onCatRenameKeyDown}
            onBlur={onSaveCatRename}
            maxLength={100}
          />
          <ChevronDown
            size={11} strokeWidth={2}
            className={`${s.chevron} ${collapsed ? s.chevronCollapsed : ''}`}
          />
        </div>

        <div className={`${s.channelList} ${collapsed ? s.channelListCollapsed : ''}`}>
          <div className={s.channelListInner}>
            <SortableContext items={cat.channels} strategy={verticalListSortingStrategy}>
              {cat.channels.map((id, i) => {
                const ch = channelMap[id]
                if (!ch) return null
                return (
                  <SortableChannelRow
                    key={ch.id}
                    id={ch.id}
                    channel={ch}
                    active={ch.id === activeChannelId}
                    onClick={() => onSwitch(ch.id)}
                    isRevealing={isRevealing}
                    staggerIdx={chanStaggerStart + i}
                    onContextMenu={onChannelContextMenu}
                    isEditing={editingChannelId === ch.id}
                    editingName={editingName || ''}
                    onStartRename={() => onStartChannelRename?.(ch)}
                    onSaveRename={() => onSaveChannelRename?.(ch.id)}
                    onRenameKeyDown={(e) => onRenameKeyDown?.(e, ch.id)}
                    onRenameChange={onRenameChange}
                    renameInputRef={renameInputRef}
                    onOpenChannelSettings={onOpenChannelSettings}
                    canManageChannels={canManageChannels}
                  />
                )
              })}
            </SortableContext>
            {inlineCreateChannel}
          </div>
        </div>
      </div>
    )
  }

  return (
    // DnD wrapper — transform/transition from dnd-kit live here, never animated by us
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${s.category} ${isDragging ? s.draggingPlaceholder : ''}`}
    >
      {/* Category header — receives the reveal animation */}
      <div
        className={`${s.categoryHeader} ${isRevealing ? 'revealing' : ''}`}
        style={isRevealing ? { '--reveal-delay': `${revealDelay(catStaggerIdx)}ms` } as React.CSSProperties : undefined}
        onClick={onToggle}
        onDoubleClick={(e) => {
          if (!onStartCatRename) return
          e.preventDefault()
          e.stopPropagation()
          onStartCatRename()
        }}
        onContextMenu={(e) => {
          if (!onFolderContextMenu) return
          onFolderContextMenu(e, cat.id)
        }}
        {...attributes}
        {...listeners}
      >
        <span className={`${s.categoryName} txt-tiny txt-semibold`}>{cat.name}</span>
        <ChevronDown
          size={11} strokeWidth={2}
          className={`${s.chevron} ${collapsed ? s.chevronCollapsed : ''}`}
        />
      </div>

      <div className={`${s.channelList} ${collapsed ? s.channelListCollapsed : ''}`}>
        <div className={s.channelListInner}>
          <SortableContext items={cat.channels} strategy={verticalListSortingStrategy}>
            {cat.channels.map((id, i) => {
              const ch = channelMap[id]
              if (!ch) return null
              return (
                <SortableChannelRow
                  key={ch.id}
                  id={ch.id}
                  channel={ch}
                  active={ch.id === activeChannelId}
                  onClick={() => onSwitch(ch.id)}
                  isRevealing={isRevealing}
                  staggerIdx={chanStaggerStart + i}
                  onContextMenu={onChannelContextMenu}
                  isEditing={editingChannelId === ch.id}
                  editingName={editingName || ''}
                  onStartRename={() => onStartChannelRename?.(ch)}
                  onSaveRename={() => onSaveChannelRename?.(ch.id)}
                  onRenameKeyDown={(e) => onRenameKeyDown?.(e, ch.id)}
                  onRenameChange={onRenameChange}
                  renameInputRef={renameInputRef}
                  onOpenChannelSettings={onOpenChannelSettings}
                  canManageChannels={canManageChannels}
                />
              )
            })}
          </SortableContext>
          {inlineCreateChannel}
        </div>
      </div>
    </div>
  )
}

/* ── Sortable channel row wrapper ── */
function SortableChannelRow({ id, channel, active, onClick, isRevealing, staggerIdx, onContextMenu, isEditing, editingName, onStartRename, onSaveRename, onRenameKeyDown, onRenameChange, renameInputRef, onOpenChannelSettings, canManageChannels }: {
  id:               string
  channel:          ChannelDisplay
  active:           boolean
  onClick:          () => void
  isRevealing:      boolean
  staggerIdx:       number
  onContextMenu?:   (e: React.MouseEvent, channelId: string) => void
  isEditing?:       boolean
  editingName?:     string
  onStartRename?:   () => void
  onSaveRename?:    () => void
  onRenameKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRenameChange?:  (value: string) => void
  renameInputRef?:  React.RefObject<HTMLInputElement | null>
  onOpenChannelSettings?: (channelId: string) => void
  canManageChannels?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !canManageChannels })

  // Don't allow dragging while editing
  if (isEditing) {
    return (
      <div ref={setNodeRef}>
        <ChannelRow
          channel={channel}
          active={active}
          onClick={onClick}
          isRevealing={isRevealing}
          staggerIdx={staggerIdx}
          isEditing={isEditing}
          editingName={editingName}
          onSaveRename={onSaveRename}
          onRenameKeyDown={onRenameKeyDown}
          onRenameChange={onRenameChange}
          renameInputRef={renameInputRef}
          onOpenChannelSettings={onOpenChannelSettings}
          canManageChannels={canManageChannels}
        />
      </div>
    )
  }

  return (
    // DnD wrapper — transform/transition from dnd-kit live here, never animated by us
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? s.draggingPlaceholder : ''}
      {...attributes}
      {...listeners}
    >
      <ChannelRow
        channel={channel}
        active={active}
        onClick={onClick}
        isRevealing={isRevealing}
        staggerIdx={staggerIdx}
        onContextMenu={onContextMenu}
        onStartRename={onStartRename}
        onOpenChannelSettings={onOpenChannelSettings}
        canManageChannels={canManageChannels}
      />
    </div>
  )
}

/* ── Uncategorized droppable zone ── */
function UncategorizedZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: 'uncategorized' })
  return <div ref={setNodeRef} className={s.uncategorized}>{children}</div>
}

/* ── Presentational channel row ── */
function ChannelRow({ channel, active, onClick, isRevealing, staggerIdx, onContextMenu, isEditing, editingName, onStartRename, onSaveRename, onRenameKeyDown, onRenameChange, renameInputRef }: {
  channel:          ChannelDisplay
  active:           boolean
  onClick:          () => void
  isRevealing?:     boolean
  staggerIdx?:      number
  onContextMenu?:   (e: React.MouseEvent, channelId: string) => void
  isEditing?:       boolean
  editingName?:     string
  onStartRename?:   () => void
  onSaveRename?:    () => void
  onRenameKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRenameChange?:  (value: string) => void
  renameInputRef?:  React.RefObject<HTMLInputElement | null>
  onOpenChannelSettings?: (channelId: string) => void
  canManageChannels?: boolean
}) {
  const { t } = useT()
  const isText = channel.icon === '#'

  if (isEditing) {
    return (
      <div
        className={`${s.channel} ${s.editing} ${active ? s.active : ''}`}
        style={isRevealing && staggerIdx != null
          ? { '--reveal-delay': `${revealDelay(staggerIdx)}ms` } as React.CSSProperties
          : undefined
        }
      >
        <span className={s.channelIcon}>{isText ? '#' : channel.icon}</span>
        <input
          ref={renameInputRef}
          className={`${s.renameInput} txt-small txt-medium`}
          value={editingName}
          onChange={e => onRenameChange?.(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onSaveRename}
          maxLength={100}
        />
      </div>
    )
  }

  return (
    <div
      className={`${s.channel} ${active ? s.active : ''} ${isRevealing ? 'revealing' : ''}`}
      style={isRevealing && staggerIdx != null
        ? { '--reveal-delay': `${revealDelay(staggerIdx)}ms` } as React.CSSProperties
        : undefined
      }
      onClick={onClick}
      onDoubleClick={(e) => {
        if (!onStartRename) return
        e.preventDefault()
        e.stopPropagation()
        onStartRename()
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        onContextMenu(e, channel.id)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <span className={s.channelIcon}>{isText ? '#' : channel.icon}</span>
      <span className={`${s.channelName} txt-small txt-medium txt-truncate`}>{channel.name}</span>
      {channel.unread > 0 && <span className={s.badge}>{channel.unread}</span>}
      {onContextMenu && (
        <button
          className={s.channelMenuBtn}
          title={t('channelSidebar.channelOptions')}
          aria-label={t('channelSidebar.channelOptions')}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onContextMenu(e, channel.id)
          }}
        >
          <MoreHorizontal size={14} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

/* ── Icons ── */
function PlusIcon()     { return <Plus size={14} strokeWidth={1.5} /> }
function CollapseIcon() { return <PanelLeftClose size={14} strokeWidth={1.5} /> }
