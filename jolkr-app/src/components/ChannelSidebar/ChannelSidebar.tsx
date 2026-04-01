import { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
import { Plus, PanelLeftClose, ChevronDown, FolderPlus, Hash, Settings as SettingsIcon } from 'lucide-react'
import type { Server, Channel, Category, ServerTheme } from '../../types'
import type { ColorPreference } from '../../utils/colorMode'
import { revealDelay, revealWindowMs } from '../../utils/animations'
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
}

export function ChannelSidebar({ server, activeChannelId, onSwitch, onCollapse, collapsed, theme, onThemeChange, isDark, colorPref, onSetColorPref, onOpenSettings }: Props) {
  const [collapsedCats,      setCollapsedCats]      = useState<Set<string>>(new Set())
  const [localCats,          setLocalCats]           = useState<Category[]>(server.categories)
  const [localExtraChannels, setLocalExtraChannels]  = useState<Channel[]>([])
  const [activeDragId,       setActiveDragId]        = useState<string | null>(null)
  const [isRevealing,        setIsRevealing]         = useState(false)

  // ── Context menu ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [creating,    setCreating]    = useState<'folder' | 'channel' | null>(null)
  const [newName,     setNewName]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset all server-specific state synchronously before paint so there is
  // no flash of the previous server's content, and simultaneously kick off
  // the staggered reveal animation for the incoming server's channels.
  useLayoutEffect(() => {
    setLocalCats(server.categories)
    setCollapsedCats(new Set())
    setLocalExtraChannels([])
    setIsRevealing(true)
    const totalItems =
      server.categories.length +
      server.categories.reduce((sum, c) => sum + c.channels.length, 0)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(totalItems))
    return () => clearTimeout(timer)
  }, [server.id])

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 0)
  }, [creating])

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
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleAddClick() {
    const rect = addBtnRef.current?.getBoundingClientRect()
    if (rect) setContextMenu({ x: rect.left, y: rect.bottom + 4 })
  }

  function startCreating(type: 'folder' | 'channel') {
    setContextMenu(null)
    setCreating(type)
    setNewName('')
  }

  function confirmCreate(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setCreating(null); return }
    if (e.key !== 'Enter') return
    const name = newName.trim()
    if (!name) { setCreating(null); return }

    if (creating === 'folder') {
      setLocalCats(prev => [...prev, { name, channels: [] }])
    } else {
      const id = `ch-${Date.now()}`
      setLocalExtraChannels(prev => [...prev, { id, name, icon: '#', desc: '', unread: 0 }])
    }
    setCreating(null)
    setNewName('')
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

  // Pre-compute flat stagger indices so each category header and each channel
  // within that category receives a unique, monotonically-increasing index.
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
          {onOpenSettings && (
            <button className={s.iconBtn} title="Server settings" onClick={onOpenSettings}>
              <SettingsIcon size={14} strokeWidth={1.5} />
            </button>
          )}
          <button ref={addBtnRef} className={s.iconBtn} title="New channel" onClick={handleAddClick}><PlusIcon /></button>
          <ThemePicker
            theme={theme}
            onChange={onThemeChange}
            isDark={isDark}
            colorPref={colorPref}
            onSetColorPref={onSetColorPref}
          />
          <button className={s.iconBtn} title="Collapse sidebar" onClick={onCollapse}>
            <CollapseIcon />
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
          className={`${s.scroll} scrollbar-thin`}
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
                    isRevealing={isRevealing}
                    staggerIdx={uncatStaggerStart + i}
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

      {/* ── Context menu portal ── */}
      {contextMenu && createPortal(
        <>
          <div className={s.ctxBackdrop} onClick={() => setContextMenu(null)} />
          <div className={s.ctxMenu} style={{ top: contextMenu.y, left: contextMenu.x }}>
            <button className={s.ctxItem} onClick={() => startCreating('folder')}>
              <FolderPlus size={13} strokeWidth={1.5} />
              <span>New Folder</span>
            </button>
            <button className={s.ctxItem} onClick={() => startCreating('channel')}>
              <Hash size={13} strokeWidth={1.5} />
              <span>New Channel</span>
            </button>
          </div>
        </>,
        document.body
      )}
    </aside>
  )
}

/* ── Sortable category wrapper ── */
function SortableCategory({ cat, channelMap, activeChannelId, onSwitch, collapsed, onToggle, activeDragId: _activeDragId, isRevealing, catStaggerIdx, chanStaggerStart }: {
  cat:             Category
  channelMap:      Record<string, Channel>
  activeChannelId: string
  onSwitch:        (id: string) => void
  collapsed:       boolean
  onToggle:        () => void
  activeDragId:    string | null
  isRevealing:     boolean
  catStaggerIdx:   number
  chanStaggerStart: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `cat:${cat.name}`,
  })

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
function SortableChannelRow({ id, channel, active, onClick, isRevealing, staggerIdx }: {
  id:          string
  channel:     Channel
  active:      boolean
  onClick:     () => void
  isRevealing: boolean
  staggerIdx:  number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
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
function ChannelRow({ channel, active, onClick, isRevealing, staggerIdx }: {
  channel:      Channel
  active:       boolean
  onClick:      () => void
  isRevealing?: boolean
  staggerIdx?:  number
}) {
  const isText = channel.icon === '#'
  return (
    <button
      className={`${s.channel} ${active ? s.active : ''} ${isRevealing ? 'revealing' : ''}`}
      style={isRevealing && staggerIdx != null
        ? { '--reveal-delay': `${revealDelay(staggerIdx)}ms` } as React.CSSProperties
        : undefined
      }
      onClick={onClick}
    >
      <span className={s.channelIcon}>{isText ? '#' : channel.icon}</span>
      <span className={`${s.channelName} txt-small txt-medium txt-truncate`}>{channel.name}</span>
      {channel.unread > 0 && <span className={s.badge}>{channel.unread}</span>}
    </button>
  )
}

/* ── Icons ── */
function PlusIcon()     { return <Plus size={14} strokeWidth={1.5} /> }
function CollapseIcon() { return <PanelLeftClose size={14} strokeWidth={1.5} /> }
