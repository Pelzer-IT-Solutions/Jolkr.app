import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X, MessagesSquare, Search, Bell, Settings, LogOut, LogIn, Server as ServerIcon } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Server } from '../../types'
import s from './TabBar.module.css'

type UserStatus = 'online' | 'idle' | 'dnd' | 'offline'

const STATUS_META: Record<UserStatus, { label: string; color: string }> = {
  online:  { label: 'Online',          color: 'oklch(65% 0.18 143)' },
  idle:    { label: 'Idle',            color: 'oklch(75% 0.18 65)'  },
  dnd:     { label: 'Do Not Disturb',  color: 'oklch(55% 0.2 25)'   },
  offline: { label: 'Invisible',       color: 'oklch(50% 0 0)'      },
}

interface UserInfo {
  displayName:  string
  username:     string
  avatarLetter: string
  avatarColor:  string
  avatarUrl?:   string | null
}

interface Props {
  allServers:          Server[]
  tabbedServers:       Server[]
  activeServerId:      string
  dmActive:            boolean
  searchActive:        boolean
  notificationsActive: boolean
  user?:               UserInfo
  onSwitch:            (id: string) => void
  onClose:             (id: string) => void
  onOpenServer:        (id: string) => void
  onReorder:           (newIds: string[]) => void
  onDmClick:           () => void
  onSearchClick:       () => void
  onNotificationsClick:() => void
  onOpenSettings:      () => void
  onJoinServer:        () => void
  onCreateServer:      () => void
  onLogout?:           () => void
  onStatusChange?:     (status: UserStatus) => void
}

export function TabBar({ allServers, tabbedServers, activeServerId, dmActive, searchActive, notificationsActive, user, onSwitch, onClose, onOpenServer, onReorder, onDmClick, onSearchClick, onNotificationsClick, onOpenSettings, onJoinServer, onCreateServer, onLogout, onStatusChange }: Props) {
  const [browserOpen,  setBrowserOpen]  = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [status,       setStatus]       = useState<UserStatus>('online')
  const [menuPos,      setMenuPos]      = useState({ top: 0, right: 0 })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false })
  const tabsRef     = useRef<HTMLDivElement>(null)
  const browserRef  = useRef<HTMLDivElement>(null)
  const addBtnRef   = useRef<HTMLButtonElement>(null)
  const chipRef     = useRef<HTMLButtonElement>(null)
  const menuRef     = useRef<HTMLDivElement>(null)

  function checkTabsOverflow() {
    const el = tabsRef.current
    if (!el) return
    const left  = el.scrollLeft > 1
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    setTabsOverflow(prev =>
      prev.left === left && prev.right === right ? prev : { left, right }
    )
  }

  // Re-check whenever tabs change or on scroll / resize
  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    checkTabsOverflow()
    el.addEventListener('scroll', checkTabsOverflow, { passive: true })
    const ro = new ResizeObserver(checkTabsOverflow)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', checkTabsOverflow)
      ro.disconnect()
    }
  }, [tabbedServers])

  // Close server browser on outside click
  useEffect(() => {
    if (!browserOpen) return
    function handle(e: MouseEvent) {
      if (
        browserRef.current && !browserRef.current.contains(e.target as Node) &&
        addBtnRef.current  && !addBtnRef.current.contains(e.target as Node)
      ) setBrowserOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [browserOpen])

  // Close profile menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          chipRef.current  && !chipRef.current.contains(e.target as Node))
        setMenuOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown',   handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown',   handleKey)
    }
  }, [menuOpen])

  function openMenu() {
    if (!chipRef.current) return
    const r = chipRef.current.getBoundingClientRect()
    setMenuPos({ top: r.bottom + 8, right: window.innerWidth - r.right })
    setMenuOpen(v => !v)
  }

  const tabbedIds = new Set(tabbedServers.map(s => s.id))

  // Build a mask-image that only fades edges where content is clipped
  const tabsMask = (() => {
    const { left, right } = tabsOverflow
    if (!left && !right) return undefined
    const l = left  ? 'transparent 0, black 2.5rem'                   : 'black 0, black 2.5rem'
    const r = right ? 'black calc(100% - 2.5rem), transparent 100%'   : 'black calc(100% - 2.5rem), black 100%'
    const mask = `linear-gradient(to right, ${l}, ${r})`
    return { WebkitMaskImage: mask, maskImage: mask }
  })()
  const tabIds    = tabbedServers.map(s => s.id)

  function handleDragStart(e: DragStartEvent) {
    setActiveDragId(e.active.id as string)
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    setActiveDragId(null)
    if (!over || active.id === over.id) return
    const oldIndex = tabIds.indexOf(active.id as string)
    const newIndex = tabIds.indexOf(over.id  as string)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(tabIds, oldIndex, newIndex))
  }

  const currentStatus = STATUS_META[status]

  return (
    <div className={s.bar}>
      {/* ── Add / browse servers ── */}
      <div className={s.addWrap}>
        <button
          ref={addBtnRef}
          className={`${s.addBtn} ${browserOpen ? s.addBtnActive : ''}`}
          onClick={() => setBrowserOpen(v => !v)}
          title="Your servers"
        >
          <PlusIcon open={browserOpen} />
        </button>

        {browserOpen && (
          <div ref={browserRef} className={s.browser}>
            <div className={s.browserActions}>
              <button
                className={s.browserActionRow}
                onClick={() => { setBrowserOpen(false); onJoinServer() }}
              >
                <span className={s.browserActionIcon}><LogIn size={14} strokeWidth={1.5} /></span>
                <span className={`${s.browserActionLabel} txt-small txt-medium`}>Join a Server</span>
              </button>
              <button
                className={s.browserActionRow}
                onClick={() => { setBrowserOpen(false); onCreateServer() }}
              >
                <span className={s.browserActionIcon}><ServerIcon size={14} strokeWidth={1.5} /></span>
                <span className={`${s.browserActionLabel} txt-small txt-medium`}>Create a Server</span>
              </button>
            </div>
            <div className={s.browserDivider} />
            <div className={s.browserHeader}>
              <span className={`${s.browserTitle} txt-tiny txt-semibold`}>Your servers</span>
            </div>
            <div className={`${s.browserList} scrollbar-thin`}>
              {allServers.map(server => {
                const isTabbed = tabbedIds.has(server.id)
                const isActive = server.id === activeServerId
                return (
                  <button
                    key={server.id}
                    className={`${s.browserRow} ${isActive ? s.browserRowActive : ''}`}
                    style={{ '--row-color': server.color } as React.CSSProperties}
                    onClick={() => { onOpenServer(server.id); setBrowserOpen(false) }}
                  >
                    <div className={s.browserIcon} style={{ background: server.color }}>{server.icon}</div>
                    <div className={s.browserMeta}>
                      <span className={`${s.browserName} txt-small txt-medium txt-truncate`}>{server.name}</span>
                      <span className={`${s.browserSub} txt-tiny txt-truncate`}>{server.channels.length} channels</span>
                    </div>
                    {isTabbed
                      ? <span className={s.tabbedPill}>open</span>
                      : <span className={s.addTabbedHint}><SmallPlusIcon /></span>
                    }
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Server tabs ── */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div ref={tabsRef} className={`${s.tabs} scrollbar-none`} style={tabsMask}>
            {tabbedServers.map(server => (
              <SortableTab
                key={server.id}
                server={server}
                isActive={server.id === activeServerId}
                isDragging={activeDragId === server.id}
                onSwitch={onSwitch}
                onClose={onClose}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeDragId ? (() => {
            const srv = tabbedServers.find(s => s.id === activeDragId)
            if (!srv) return null
            return (
              <div className={`${s.tab} ${srv.id === activeServerId ? s.active : ''} ${s.dragOverlay}`}>
                <div className={s.tabIcon} style={{ background: srv.color }}>{srv.icon}</div>
                <span className={`${s.tabName} txt-small txt-medium txt-truncate`}>{srv.name}</span>
              </div>
            )
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* ── Right actions ── */}
      <div className={s.right}>
        <button
          className={`${s.iconBtn} ${searchActive ? s.iconBtnActive : ''}`}
          onClick={onSearchClick}
          title="Search (⌘K)"
        >
          <SearchIcon />
        </button>
        <button
          className={`${s.iconBtn} ${dmActive ? s.iconBtnActive : ''}`}
          onClick={onDmClick}
          title="Direct messages"
        >
          <DmIcon />
        </button>
        <button
          className={`${s.iconBtn} ${notificationsActive ? s.iconBtnActive : ''}`}
          onClick={onNotificationsClick}
          title="Notifications"
        >
          <BellIcon />
        </button>

        {/* ── User chip ── */}
        <button
          ref={chipRef}
          className={`${s.userChip} ${menuOpen ? s.userChipActive : ''}`}
          onClick={openMenu}
          title="Profile"
        >
          <div className={s.avatar} style={!user?.avatarUrl && user?.avatarColor ? { background: user.avatarColor } : undefined}>
            {user?.avatarUrl
              ? <img src={user.avatarUrl} alt="" className={s.avatarImg} />
              : (user?.avatarLetter ?? '?')}
            <span className={s.statusDot} style={{ background: currentStatus.color }} />
          </div>
          <span className={`${s.userName} txt-small txt-medium`}>{user?.displayName ?? 'User'}</span>
        </button>
      </div>

      {/* ── Profile menu portal ── */}
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className={s.profileMenu}
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {/* User info */}
          <div className={s.profileHead}>
            <div className={s.profileAvatar} style={!user?.avatarUrl && user?.avatarColor ? { background: user.avatarColor } : undefined}>
              {user?.avatarUrl
                ? <img src={user.avatarUrl} alt="" className={s.avatarImg} />
                : (user?.avatarLetter ?? '?')}
              <span className={s.profileStatusDot} style={{ background: currentStatus.color }} />
            </div>
            <div className={s.profileInfo}>
              <span className={`${s.profileName} txt-small txt-semibold`}>{user?.displayName ?? 'User'}</span>
              <span className={`${s.profileStatus} txt-tiny`} style={{ color: currentStatus.color }}>
                {currentStatus.label}
              </span>
            </div>
          </div>

          <div className={s.menuDivider} />

          {/* Status selector */}
          <div className={s.menuSection}>
            <span className={`${s.menuSectionLabel} txt-tiny txt-semibold`}>Set status</span>
            {(Object.entries(STATUS_META) as [UserStatus, typeof STATUS_META[UserStatus]][]).map(([key, meta]) => (
              <button
                key={key}
                className={`${s.statusItem} ${status === key ? s.statusItemActive : ''}`}
                onClick={() => { setStatus(key); setMenuOpen(false); onStatusChange?.(key) }}
              >
                <span className={s.statusBullet} style={{ background: meta.color }} />
                <span className={`${s.statusLabel} txt-small`}>{meta.label}</span>
                {status === key && <span className={s.statusCheck}>✓</span>}
              </button>
            ))}
          </div>

          <div className={s.menuDivider} />

          {/* Settings */}
          <div className={s.menuSection}>
            <button className={s.menuItem} onClick={() => { setMenuOpen(false); onOpenSettings() }}>
              <Settings size={13} strokeWidth={1.5} />
              <span className="txt-small">Settings</span>
            </button>
          </div>

          <div className={s.menuDivider} />

          {/* Logout */}
          <div className={s.menuSection}>
            <button className={`${s.menuItem} ${s.menuItemDanger}`} onClick={() => { setMenuOpen(false); onLogout?.() }}>
              <LogOut size={13} strokeWidth={1.5} />
              <span className="txt-small">Log Out</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

/* ── Sortable tab wrapper ── */
function SortableTab({ server, isActive, isDragging, onSwitch, onClose }: {
  server:    Server
  isActive:  boolean
  isDragging:boolean
  onSwitch:  (id: string) => void
  onClose:   (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: server.id })

  const style: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[s.tab, isActive ? s.active : '', isDragging ? s.draggingPlaceholder : ''].join(' ')}
      {...attributes}
      {...listeners}
      onClick={() => onSwitch(server.id)}
      onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(server.id) } }}
    >
      <div className={s.tabIcon} style={{ background: server.color }}>{server.icon}</div>
      <span className={`${s.tabName} txt-small txt-medium txt-truncate`}>{server.name}</span>
      {server.unread && <span className={s.unreadDot} style={{ '--server-color': server.color } as React.CSSProperties} />}
      <button
        className={s.closeBtn}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onClose(server.id) }}
        title="Remove from tabs"
      >
        <CloseIcon />
      </button>
    </div>
  )
}

/* ── Icons ── */
function PlusIcon({ open }: { open: boolean }) {
  return <Plus size={14} strokeWidth={1.5} style={{ transition: 'transform 200ms ease', transform: open ? 'rotate(45deg)' : 'none' }} />
}
function SmallPlusIcon() { return <Plus          size={10} strokeWidth={1.75} /> }
function CloseIcon()     { return <X             size={9}  strokeWidth={1.75} /> }
function DmIcon()        { return <MessagesSquare size={14} strokeWidth={1.5} /> }
function SearchIcon()    { return <Search        size={14} strokeWidth={1.5} /> }
function BellIcon()      { return <Bell          size={14} strokeWidth={1.5} /> }
