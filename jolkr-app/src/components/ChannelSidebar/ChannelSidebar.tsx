import { useState, useEffect, useRef, useMemo } from 'react'
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, PanelLeftClose, ArrowLeft, ChevronDown, MoreHorizontal } from 'lucide-react'
import type { ServerDisplay, ChannelDisplay, CategoryDisplay, ServerTheme } from '../../types'
import type { ColorPreference } from '../../utils/colorMode'
import { revealDelay, revealWindowMs } from '../../utils/animations'
import { ThemePicker } from '../ThemePicker/ThemePicker'
import { ChannelContextMenu, type CreatingState } from './ChannelContextMenu'
import { CreateChannelForm } from './CreateChannelForm'
import { useDragDropChannels } from './useDragDropChannels'
import s from './ChannelSidebar.module.css'

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
  onReorderChannels?: (
    positions: Array<{ id: string; position: number }>,
    moves: Array<{ id: string; categoryId: string | null }>,
  ) => Promise<void>
}

export function ChannelSidebar({ server, activeChannelId, onSwitch, onCollapse, collapsed, isMobile = false, theme, onThemeChange, isDark, colorPref, onSetColorPref, onOpenSettings: _onOpenSettings, canManageChannels, canEditTheme, onCreateChannel, onCreateCategory, onDeleteChannel, onDeleteCategory, onRenameChannel, onRenameCategory, onArchiveChannel, onOpenChannelSettings, onReorderChannels }: Props) {
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  const [isRevealing,   setIsRevealing]   = useState(false)

  const {
    localCats, setLocalCats,
    localExtraChannels, setLocalExtraChannels,
    activeDragId,
    sensors,
    collisionDetection,
    uncategorizedIds,
    handleDragStart, handleDragOver, handleDragEnd, handleDragCancel,
  } = useDragDropChannels({
    initialCats: server.categories,
    serverChannels: server.channels,
    canManageChannels,
    onReorderChannels,
  })

  // ── Context menus ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [channelContextMenu, setChannelContextMenu] = useState<{ x: number; y: number; channelId: string } | null>(null)
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ x: number; y: number; categoryId: string } | null>(null)
  // CreatingState: `categoryId` (when set on a channel-create) routes the new
  // channel into a specific folder; without it the channel is uncategorized.
  // `kind` selects text vs voice — chosen at menu-open time, then carried
  // through to the optimistic icon and the backend `kind` field.
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

  // Reset all server-specific state synchronously before paint so there is
  // no flash of the previous server's content, and simultaneously kick off
  // the staggered reveal animation for the incoming server's channels.
  // Use JSON key to avoid resetting on presence-only changes (categories
  // reference changes when presence ticks).
  const categoriesKey = useMemo(
    () => server.categories.map(c => `${c.name}:${c.channels.join(',')}`).join('|'),
    [server.categories],
  )
  const [prevServerId, setPrevServerId] = useState(server.id)
  const [prevCategoriesKey, setPrevCategoriesKey] = useState(categoriesKey)

  if (prevServerId !== server.id) {
    setPrevServerId(server.id)
    setPrevCategoriesKey(categoriesKey)
    setLocalCats(server.categories)
    setLocalExtraChannels([])
    setCollapsedCats(new Set())
    setIsRevealing(true)
  } else if (prevCategoriesKey !== categoriesKey) {
    setPrevCategoriesKey(categoriesKey)
    setLocalCats(server.categories)
    setLocalExtraChannels([])
  }

  // Schedule the end of the reveal animation. Cleanup cancels the timer if
  // a second server-switch lands before the first one finishes.
  useEffect(() => {
    if (!isRevealing) return
    const totalItems =
      server.categories.length +
      server.categories.reduce((sum, c) => sum + c.channels.length, 0)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(totalItems))
    return () => clearTimeout(timer)
  }, [isRevealing, server.categories])

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 0)
  }, [creating])

  useEffect(() => {
    if (editingChannelId) setTimeout(() => renameInputRef.current?.focus(), 0)
  }, [editingChannelId])

  useEffect(() => {
    if (editingCategoryId) setTimeout(() => catRenameInputRef.current?.focus(), 0)
  }, [editingCategoryId])

  const channelMap: Record<string, ChannelDisplay> = {
    ...Object.fromEntries(server.channels.map(c => [c.id, c])),
    ...Object.fromEntries(localExtraChannels.map(c => [c.id, c])),
  }

  function toggleCat(name: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
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
      setLocalExtraChannels(prev => prev.map(ch =>
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
    // Find the actual category ID from server data
    const serverCat = server.categories.find(c => c.name === category.name)
    if (!serverCat) return
    setEditingCategoryId(serverCat.name) // Using name as ID for now since UI Category doesn't have ID
    setEditingCatName(category.name)
  }

  function saveCategoryRename(categoryId: string) {
    const name = editingCatName.trim()
    if (name && name !== categoryId) {
      setLocalCats(prev => prev.map(cat =>
        cat.name === categoryId ? { ...cat, name } : cat
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

  function handleFolderContextMenu(e: React.MouseEvent, folderName: string) {
    if (!canManageChannels) return          // nothing to show without permissions
    e.preventDefault()
    e.stopPropagation()
    closeAllMenus()
    setCategoryContextMenu({ x: e.clientX, y: e.clientY, categoryId: folderName })
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

    // Optimistic local update — show the new item immediately. If the API
    // fails or returns different data, the next fetchChannels reconciles.
    if (intent.type === 'folder') {
      const tempId = `cat-${Date.now()}`
      setLocalCats(prev => [...prev, { id: tempId, name, channels: [] }])
    } else {
      const tempId = `ch-${Date.now()}`
      const tempIcon = intent.kind === 'voice' ? '🔊' : '#'
      setLocalExtraChannels(prev => [...prev, { id: tempId, name, icon: tempIcon, desc: '', unread: 0, kind: intent.kind }])
      // For channels created inside a folder, also slot them into that folder
      // locally so they don't briefly flash in the uncategorized list.
      if (intent.categoryId) {
        setLocalCats(prev => prev.map(c =>
          c.id === intent.categoryId ? { ...c, channels: [...c.channels, tempId] } : c
        ))
      }
    }

    // Fire API call — on error, the next fetchChannels will correct state
    try {
      if (intent.type === 'folder') {
        await onCreateCategory?.(name)
      } else {
        await onCreateChannel?.(name, intent.kind, intent.categoryId)
      }
    } catch (err) {
      console.error('Failed to create:', err)
    }
  }

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
          {canManageChannels && (
            <button ref={addBtnRef} className={s.iconBtn} title="New channel" onClick={handleAddClick}><PlusIcon /></button>
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
            title={isMobile ? 'Back to chat' : 'Collapse sidebar'}
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
          aria-label="Server channels"
          className={`${s.scroll} scrollbar-thin scroll-view-y`}
          onContextMenu={handleContextMenu}
        >
          <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
            {localCats.map((cat, i) => {
              const isCreatingHere = creating?.type === 'channel' && creating.categoryId === cat.id
              // Force the folder open so the inline input is visible
              const isCollapsed = isCreatingHere ? false : collapsedCats.has(cat.name)
              return (
                <SortableCategory
                  key={cat.name}
                  cat={cat}
                  channelMap={channelMap}
                  activeChannelId={activeChannelId}
                  onSwitch={onSwitch}
                  collapsed={isCollapsed}
                  onToggle={() => toggleCat(cat.name)}
                  activeDragId={activeDragId}
                  isRevealing={isRevealing}
                  catStaggerIdx={catMeta[i].catStaggerIdx}
                  chanStaggerStart={catMeta[i].chanStaggerStart}
                  onChannelContextMenu={canManageChannels ? handleChannelContextMenu : undefined}
                  onFolderContextMenu={canManageChannels ? handleFolderContextMenu : undefined}
                  isCatEditing={editingCategoryId === cat.name}
                  editingCatName={editingCatName}
                  onStartCatRename={() => startCategoryRename(cat)}
                  onSaveCatRename={() => saveCategoryRename(cat.name)}
                  onCatRenameKeyDown={(e) => handleCatRenameKeyDown(e, cat.name)}
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
                    <CreateChannelForm
                      creating={creating}
                      value={newName}
                      onChange={setNewName}
                      onConfirm={confirmCreate}
                      onCancel={() => setCreating(null)}
                      inputRef={inputRef}
                    />
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
            <CreateChannelForm
              creating={creating}
              value={newName}
              onChange={setNewName}
              onConfirm={confirmCreate}
              onCancel={() => setCreating(null)}
              inputRef={inputRef}
            />
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

      <ChannelContextMenu
        addMenu={contextMenu}
        onAddMenuClose={() => setContextMenu(null)}
        channelMenu={channelContextMenu}
        onChannelMenuClose={() => setChannelContextMenu(null)}
        channelMap={channelMap}
        folderMenu={categoryContextMenu}
        onFolderMenuClose={() => setCategoryContextMenu(null)}
        localCats={localCats}
        serverCategories={server.categories}
        onStartCreating={startCreating}
        onStartChannelRename={startChannelRename}
        onStartCategoryRename={startCategoryRename}
        setCollapsedCats={setCollapsedCats}
        canManageChannels={canManageChannels}
        onArchiveChannel={onArchiveChannel}
        onDeleteChannel={onDeleteChannel}
        onOpenChannelSettings={onOpenChannelSettings}
        onCreateChannel={onCreateChannel}
        onDeleteCategory={onDeleteCategory}
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
  onFolderContextMenu?: (e: React.MouseEvent, folderName: string) => void
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
    id: `cat:${cat.name}`,
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
          onFolderContextMenu(e, cat.name)
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
          title="Channel options"
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
