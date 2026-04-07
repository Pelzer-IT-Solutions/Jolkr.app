import { useState, useEffect, useLayoutEffect, useRef } from 'react'
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
import { Plus, PanelLeftClose, ChevronDown, FolderPlus, Hash } from 'lucide-react'
import { Menu, MenuItem, MenuSection } from '../Menu'
import type { Server, Channel, Category, ServerTheme } from '../../types'
import type { ColorPreference } from '../../utils/colorMode'
import { revealDelay, revealWindowMs } from '../../utils/animations'
import { getSafePosition } from '../../utils/position'
import { ThemePicker } from '../ThemePicker/ThemePicker'
import s from './ChannelSidebar.module.css'

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
  server:          Server
  activeChannelId: string
  onSwitch:        (id: string) => void
  onCollapse:      () => void
  collapsed:       boolean
  theme:           ServerTheme
  onThemeChange:   (theme: ServerTheme) => void
  isDark:          boolean
  colorPref:       ColorPreference
  onSetColorPref:  (pref: ColorPreference) => void
  onOpenSettings?: () => void
  canManageChannels?: boolean
  onCreateChannel?:   (name: string, kind: 'text' | 'voice') => Promise<void>
  onCreateCategory?:  (name: string) => Promise<void>
  onDeleteChannel?:   (channelId: string) => Promise<void>
  onDeleteCategory?:  (categoryId: string) => Promise<void>
  onRenameChannel?:   (channelId: string, newName: string) => Promise<void>
  onRenameCategory?:  (categoryId: string, newName: string) => Promise<void>
}

export function ChannelSidebar({ server, activeChannelId, onSwitch, onCollapse, collapsed, theme, onThemeChange, isDark, colorPref, onSetColorPref, canManageChannels, onCreateChannel, onCreateCategory, onDeleteChannel, onDeleteCategory, onRenameChannel, onRenameCategory }: Props) {
  const [collapsedCats,      setCollapsedCats]      = useState<Set<string>>(new Set())
  const [localCats,          setLocalCats]           = useState<Category[]>(server.categories)
  const [localExtraChannels, setLocalExtraChannels]  = useState<Channel[]>([])
  const [activeDragId,       setActiveDragId]        = useState<string | null>(null)
  const [isRevealing,        setIsRevealing]         = useState(false)

  // ── Context menus ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [channelContextMenu, setChannelContextMenu] = useState<{ x: number; y: number; channelId: string } | null>(null)
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ x: number; y: number; categoryId: string } | null>(null)

  // ── Inline creation ──
  const [creating, setCreating] = useState<'folder' | 'channel' | null>(null)
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Channel rename ──
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // ── Category rename ──
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCatName, setEditingCatName] = useState('')
  const catRenameInputRef = useRef<HTMLInputElement>(null)

  // Reset reveal + collapsed state only when switching servers
  useLayoutEffect(() => {
    setCollapsedCats(new Set())
    setLocalExtraChannels([])
  }, [server.id])

  // Sync local categories whenever the server's categories change (initial fetch, WS updates, etc.)
  useLayoutEffect(() => {
    setLocalCats(server.categories)
    setIsRevealing(true)
    const totalItems =
      server.categories.length +
      server.categories.reduce((sum, c) => sum + c.channels.length, 0)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(totalItems))
    return () => clearTimeout(timer)
  }, [server.id, server.categories])

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 0)
  }, [creating])

  useEffect(() => {
    if (editingChannelId) setTimeout(() => renameInputRef.current?.focus(), 0)
  }, [editingChannelId])

  useEffect(() => {
    if (editingCategoryId) setTimeout(() => catRenameInputRef.current?.focus(), 0)
  }, [editingCategoryId])

  const channelMap: Record<string, Channel> = {
    ...Object.fromEntries(server.channels.map(c => [c.id, c])),
    ...Object.fromEntries(localExtraChannels.map(c => [c.id, c])),
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  const categorizedSet   = new Set(localCats.flatMap(c => c.channels))
  const allChannelIds    = [
    ...server.channels.map(c => c.id),
    ...localExtraChannels.map(c => c.id),
  ]
  const uncategorizedIds = allChannelIds.filter(id => !categorizedSet.has(id))

  function findCatFor(channelId: string, cats: Category[]): string | null {
    return cats.find(c => c.channels.includes(channelId))?.name ?? null
  }

  function toggleCat(name: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const addBtnRef = useRef<HTMLButtonElement>(null)

  // ── Context menu helpers ──
  function handleContextMenu(e: React.MouseEvent) {
    if (!canManageChannels) return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleAddClick() {
    if (contextMenu !== null) {
      setContextMenu(null)
      return
    }
    const rect = addBtnRef.current?.getBoundingClientRect()
    if (rect) setContextMenu({ x: rect.left, y: rect.bottom + 4 })
  }

  function handleChannelContextMenu(e: React.MouseEvent, channelId: string) {
    if (!canManageChannels) return
    e.preventDefault()
    e.stopPropagation()
    const safePos = getSafePosition(
      { x: e.clientX, y: e.clientY },
      { width: 184, height: 80 },
      { width: window.innerWidth, height: window.innerHeight },
      8
    )
    setChannelContextMenu({ x: safePos.x, y: safePos.y, channelId })
  }

  function handleCategoryContextMenu(e: React.MouseEvent, categoryId: string) {
    if (!canManageChannels) return
    e.preventDefault()
    e.stopPropagation()
    const safePos = getSafePosition(
      { x: e.clientX, y: e.clientY },
      { width: 184, height: 80 },
      { width: window.innerWidth, height: window.innerHeight },
      8
    )
    setCategoryContextMenu({ x: safePos.x, y: safePos.y, categoryId })
  }

  // ── Inline rename handlers ──
  function startChannelRename(channel: Channel) {
    setEditingChannelId(channel.id)
    setEditingName(channel.name)
  }

  async function saveChannelRename(channelId: string) {
    const name = editingName.trim()
    if (name && onRenameChannel) {
      try { await onRenameChannel(channelId, name) } catch (e) { console.error('Rename failed:', e) }
    }
    setEditingChannelId(null)
    setEditingName('')
  }

  function cancelChannelRename() {
    setEditingChannelId(null)
    setEditingName('')
  }

  function handleRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, channelId: string) {
    if (e.key === 'Enter') { e.preventDefault(); saveChannelRename(channelId) }
    else if (e.key === 'Escape') cancelChannelRename()
  }

  function startCategoryRename(category: Category) {
    setEditingCategoryId(category.id)
    setEditingCatName(category.name)
  }

  async function saveCategoryRename(categoryId: string) {
    const name = editingCatName.trim()
    if (name && onRenameCategory) {
      try { await onRenameCategory(categoryId, name) } catch (e) { console.error('Category rename failed:', e) }
    }
    setEditingCategoryId(null)
    setEditingCatName('')
  }

  function cancelCategoryRename() {
    setEditingCategoryId(null)
    setEditingCatName('')
  }

  function handleCatRenameKeyDown(e: React.KeyboardEvent<HTMLInputElement>, categoryId: string) {
    if (e.key === 'Enter') { e.preventDefault(); saveCategoryRename(categoryId) }
    else if (e.key === 'Escape') cancelCategoryRename()
  }

  // ── Creation ──
  function startCreating(type: 'folder' | 'channel') {
    setContextMenu(null)
    setCreating(type)
    setNewName('')
  }

  async function confirmCreate(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setCreating(null); return }
    if (e.key !== 'Enter') return
    const name = newName.trim()
    if (!name) { setCreating(null); return }

    // Optimistic local update
    if (creating === 'folder') {
      setLocalCats(prev => [...prev, { id: `cat-${Date.now()}`, name, channels: [] }])
    } else {
      const tempId = `ch-${Date.now()}`
      setLocalExtraChannels(prev => [...prev, { id: tempId, name, icon: '#', desc: '', unread: 0 }])
    }
    const creatingType = creating
    setCreating(null)
    setNewName('')

    try {
      if (creatingType === 'folder') await onCreateCategory?.(name)
      else await onCreateChannel?.(name, 'text')
    } catch (err) {
      console.error('Failed to create:', err)
    }
  }

  // ── DnD handlers ──
  function handleDragStart({ active }: DragStartEvent) {
    setActiveDragId(active.id as string)
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return
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
    if (!over || active.id === over.id) return
    const activeId = active.id as string
    const overId   = over.id   as string

    if (activeId.startsWith('cat:') && overId.startsWith('cat:')) {
      setLocalCats(prev => {
        const from = prev.findIndex(c => `cat:${c.name}` === activeId)
        const to   = prev.findIndex(c => `cat:${c.name}` === overId)
        return from >= 0 && to >= 0 ? arrayMove(prev, from, to) : prev
      })
      return
    }

    setLocalCats(prev => {
      const activeCat = prev.find(c => c.channels.includes(activeId))
      const overCat   = prev.find(c => c.channels.includes(overId))
      if (!activeCat || !overCat || activeCat.name !== overCat.name) return prev
      const from = activeCat.channels.indexOf(activeId)
      const to   = activeCat.channels.indexOf(overId)
      return prev.map(c =>
        c.name === activeCat.name ? { ...c, channels: arrayMove(c.channels, from, to) } : c
      )
    })
  }

  function handleDragCancel() { setActiveDragId(null) }

  const activeChannel = activeDragId && !activeDragId.startsWith('cat:') ? channelMap[activeDragId] : null
  const activeCatName = activeDragId?.startsWith('cat:') ? activeDragId.slice(4) : null
  const catIds        = localCats.map(c => `cat:${c.name}`)

  // Pre-compute flat stagger indices
  let flatIdx = 0
  const catMeta = localCats.map(cat => {
    const catStaggerIdx    = flatIdx++
    const chanStaggerStart = flatIdx
    flatIdx += cat.channels.length
    return { catStaggerIdx, chanStaggerStart }
  })
  const uncatStaggerStart = flatIdx

  return (
    <aside className={`${s.sidebar} ${collapsed ? s.collapsed : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-small txt-semibold`}>Channels</span>
        <div className={s.actions}>
          {canManageChannels && (
            <button
              ref={addBtnRef}
              className={s.iconBtn}
              title={contextMenu !== null ? 'Close menu' : 'New channel'}
              onMouseDown={(e) => { e.stopPropagation(); handleAddClick() }}
            >
              <span className={contextMenu !== null ? s.rotated : ''}>
                <Plus size={16} strokeWidth={2} />
              </span>
            </button>
          )}
          <ThemePicker
            theme={theme}
            onChange={onThemeChange}
            isDark={isDark}
            colorPref={colorPref}
            onSetColorPref={onSetColorPref}
          />
          <button className={s.iconBtn} title="Collapse sidebar" onClick={onCollapse}>
            <PanelLeftClose size={14} strokeWidth={1.5} />
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
        <div
          className={`${s.scroll} scrollbar-thin scroll-view-y`}
          onContextMenu={handleContextMenu}
        >
          <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
            {localCats.map((cat, i) => (
              <SortableCategory
                key={cat.name}
                cat={cat}
                channelMap={channelMap}
                activeChannelId={activeChannelId}
                onSwitch={onSwitch}
                collapsed={collapsedCats.has(cat.name)}
                onToggle={() => toggleCat(cat.name)}
                activeDragId={activeDragId}
                isRevealing={isRevealing}
                catStaggerIdx={catMeta[i].catStaggerIdx}
                chanStaggerStart={catMeta[i].chanStaggerStart}
                editingChannelId={editingChannelId}
                editingName={editingName}
                onStartChannelRename={canManageChannels ? startChannelRename : undefined}
                onSaveChannelRename={saveChannelRename}
                onRenameKeyDown={handleRenameKeyDown}
                onRenameChange={setEditingName}
                renameInputRef={renameInputRef}
                editingCategoryId={editingCategoryId}
                editingCatName={editingCatName}
                onStartCategoryRename={canManageChannels ? startCategoryRename : undefined}
                onSaveCategoryRename={saveCategoryRename}
                onCatRenameKeyDown={handleCatRenameKeyDown}
                onCatRenameChange={setEditingCatName}
                catRenameInputRef={catRenameInputRef}
                onCategoryContextMenu={handleCategoryContextMenu}
                onChannelContextMenu={handleChannelContextMenu}
              />
            ))}
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
                    onContextMenu={(e) => handleChannelContextMenu(e, ch.id)}
                    isRevealing={isRevealing}
                    staggerIdx={uncatStaggerStart + i}
                    isEditing={editingChannelId === ch.id}
                    editingName={editingName}
                    onStartRename={canManageChannels ? () => startChannelRename(ch) : undefined}
                    onSaveRename={() => saveChannelRename(ch.id)}
                    onRenameKeyDown={(e) => handleRenameKeyDown(e, ch.id)}
                    onRenameChange={setEditingName}
                    renameInputRef={renameInputRef}
                  />
                )
              })}
            </SortableContext>
          </UncategorizedZone>

          {/* ── Inline creation input ── */}
          {creating && (
            <div className={s.newItemRow}>
              <span className={s.newItemIcon}>
                {creating === 'folder' ? <FolderPlus size={13} strokeWidth={1.5} /> : <Hash size={13} strokeWidth={1.5} />}
              </span>
              <input
                ref={inputRef}
                className={`${s.newItemInput} txt-small`}
                placeholder={creating === 'folder' ? 'Folder name…' : 'channel-name…'}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={confirmCreate}
                onBlur={() => setCreating(null)}
              />
            </div>
          )}
        </div>

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

      {/* ── "+" context menu ── */}
      <Menu
        isOpen={contextMenu !== null}
        position={contextMenu ?? { x: 0, y: 0 }}
        onClose={() => setContextMenu(null)}
        minWidth="11.5rem"
      >
        <MenuSection>
          <MenuItem
            icon={<FolderPlus size={13} strokeWidth={1.5} />}
            label="New Folder"
            onClick={() => startCreating('folder')}
          />
          <MenuItem
            icon={<Hash size={13} strokeWidth={1.5} />}
            label="New Channel"
            onClick={() => startCreating('channel')}
          />
        </MenuSection>
      </Menu>

      {/* ── Channel context menu ── */}
      <Menu
        isOpen={channelContextMenu !== null}
        position={channelContextMenu ?? { x: 0, y: 0 }}
        onClose={() => setChannelContextMenu(null)}
        minWidth="11.5rem"
      >
        <MenuSection>
          <MenuItem
            label="Rename Channel"
            onClick={() => {
              if (channelContextMenu) startChannelRename(channelMap[channelContextMenu.channelId]!)
              setChannelContextMenu(null)
            }}
          />
          {canManageChannels && (
            <MenuItem
              label="Delete Channel"
              onClick={() => {
                if (channelContextMenu) {
                  onDeleteChannel?.(channelContextMenu.channelId)
                }
                setChannelContextMenu(null)
              }}
              danger
            />
          )}
        </MenuSection>
      </Menu>

      {/* ── Category context menu ── */}
      <Menu
        isOpen={categoryContextMenu !== null}
        position={categoryContextMenu ?? { x: 0, y: 0 }}
        onClose={() => setCategoryContextMenu(null)}
        minWidth="11.5rem"
      >
        <MenuSection>
          <MenuItem
            label="Rename Category"
            onClick={() => {
              if (categoryContextMenu) {
                const cat = localCats.find(c => c.id === categoryContextMenu.categoryId)
                if (cat) startCategoryRename(cat)
              }
              setCategoryContextMenu(null)
            }}
          />
          {canManageChannels && (
            <MenuItem
              label="Delete Category"
              onClick={() => {
                if (categoryContextMenu) {
                  onDeleteCategory?.(categoryContextMenu.categoryId)
                }
                setCategoryContextMenu(null)
              }}
              danger
            />
          )}
        </MenuSection>
      </Menu>
    </aside>
  )
}

/* ── Sortable category wrapper ── */
function SortableCategory({ cat, channelMap, activeChannelId, onSwitch, collapsed, onToggle, activeDragId: _activeDragId, isRevealing, catStaggerIdx, chanStaggerStart, editingChannelId, editingName, onStartChannelRename, onSaveChannelRename, onRenameKeyDown, onRenameChange, renameInputRef, editingCategoryId, editingCatName, onStartCategoryRename, onSaveCategoryRename, onCatRenameKeyDown, onCatRenameChange, catRenameInputRef, onCategoryContextMenu, onChannelContextMenu }: {
  cat:                 Category
  channelMap:          Record<string, Channel>
  activeChannelId:     string
  onSwitch:            (id: string) => void
  collapsed:           boolean
  onToggle:            () => void
  activeDragId:        string | null
  isRevealing:         boolean
  catStaggerIdx:       number
  chanStaggerStart:    number
  editingChannelId:    string | null
  editingName:         string
  onStartChannelRename?: (ch: Channel) => void
  onSaveChannelRename:  (id: string) => void
  onRenameKeyDown:      (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void
  onRenameChange:       (value: string) => void
  renameInputRef:       React.RefObject<HTMLInputElement | null>
  editingCategoryId:   string | null
  editingCatName:      string
  onStartCategoryRename?: (cat: Category) => void
  onSaveCategoryRename:  (id: string) => void
  onCatRenameKeyDown:    (e: React.KeyboardEvent<HTMLInputElement>, id: string) => void
  onCatRenameChange:     (value: string) => void
  catRenameInputRef:     React.RefObject<HTMLInputElement | null>
  onCategoryContextMenu?: (e: React.MouseEvent, id: string) => void
  onChannelContextMenu?: (e: React.MouseEvent, id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `cat:${cat.name}`,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${s.category} ${isDragging ? s.draggingPlaceholder : ''}`}
    >
      <div
        className={`${s.categoryHeader} ${isRevealing ? 'revealing' : ''} ${editingCategoryId === cat.id ? s.editing : ''}`}
        style={isRevealing ? { '--reveal-delay': `${revealDelay(catStaggerIdx)}ms` } as React.CSSProperties : undefined}
        onClick={editingCategoryId === cat.id ? undefined : onToggle}
        onDoubleClick={onStartCategoryRename ? () => onStartCategoryRename(cat) : undefined}
        onContextMenu={(e) => onCategoryContextMenu?.(e, cat.id)}
        {...attributes}
        {...listeners}
      >
        {editingCategoryId === cat.id ? (
          <input
            ref={catRenameInputRef}
            className={`${s.categoryRenameInput} txt-tiny txt-semibold`}
            value={editingCatName}
            onChange={e => onCatRenameChange(e.target.value)}
            onKeyDown={(e) => onCatRenameKeyDown(e, cat.id)}
            onBlur={() => onSaveCategoryRename(cat.id)}
            maxLength={50}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className={`${s.categoryName} txt-tiny txt-semibold`}>{cat.name}</span>
        )}
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
                  onContextMenu={(e) => onChannelContextMenu?.(e, ch.id)}
                  isRevealing={isRevealing}
                  staggerIdx={chanStaggerStart + i}
                  isEditing={editingChannelId === ch.id}
                  editingName={editingName}
                  onStartRename={onStartChannelRename ? () => onStartChannelRename(ch) : undefined}
                  onSaveRename={() => onSaveChannelRename(ch.id)}
                  onRenameKeyDown={(e) => onRenameKeyDown(e, ch.id)}
                  onRenameChange={onRenameChange}
                  renameInputRef={renameInputRef}
                />
              )
            })}
          </SortableContext>
        </div>
      </div>
    </div>
  )
}

/* ── Sortable channel row wrapper ── */
function SortableChannelRow({ id, channel, active, onClick, onContextMenu, isRevealing, staggerIdx, isEditing, editingName, onStartRename, onSaveRename, onRenameKeyDown, onRenameChange, renameInputRef }: {
  id:              string
  channel:         Channel
  active:          boolean
  onClick:         () => void
  onContextMenu?:  (e: React.MouseEvent) => void
  isRevealing:     boolean
  staggerIdx:      number
  isEditing:       boolean
  editingName:     string
  onStartRename?:  () => void
  onSaveRename:    () => void
  onRenameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRenameChange:  (value: string) => void
  renameInputRef:  React.RefObject<HTMLInputElement | null>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
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
        onContextMenu={onContextMenu}
        isRevealing={isRevealing}
        staggerIdx={staggerIdx}
        isEditing={isEditing}
        editingName={editingName}
        onStartRename={onStartRename}
        onSaveRename={onSaveRename}
        onRenameKeyDown={onRenameKeyDown}
        onRenameChange={onRenameChange}
        renameInputRef={renameInputRef}
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
function ChannelRow({ channel, active, onClick, onContextMenu, isRevealing, staggerIdx, isEditing, editingName, onStartRename, onSaveRename, onRenameKeyDown, onRenameChange, renameInputRef }: {
  channel:         Channel
  active:          boolean
  onClick:         () => void
  onContextMenu?:  (e: React.MouseEvent) => void
  isRevealing?:    boolean
  staggerIdx?:     number
  isEditing?:      boolean
  editingName?:    string
  onStartRename?:  () => void
  onSaveRename?:   () => void
  onRenameKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onRenameChange?: (value: string) => void
  renameInputRef?: React.RefObject<HTMLInputElement | null>
}) {
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
    <button
      className={`${s.channel} ${active ? s.active : ''} ${isRevealing ? 'revealing' : ''}`}
      style={isRevealing && staggerIdx != null
        ? { '--reveal-delay': `${revealDelay(staggerIdx)}ms` } as React.CSSProperties
        : undefined
      }
      onClick={onClick}
      onDoubleClick={onStartRename}
      onContextMenu={onContextMenu}
    >
      <span className={s.channelIcon}>{isText ? '#' : channel.icon}</span>
      <span className={`${s.channelName} txt-small txt-medium txt-truncate`}>{channel.name}</span>
      {channel.unread > 0 && <span className={s.badge}>{channel.unread}</span>}
    </button>
  )
}
