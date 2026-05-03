import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, MessagesSquare, Search, Bell, Settings, LogOut, LogIn, Server as ServerIcon, MoreHorizontal, VolumeX, CheckCheck, X } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ServerDisplay, MemberStatus } from '../../types'
import { Menu, MenuItem, MenuSection, MenuDivider } from '../Menu'
import { isTauri, isMobile } from '../../platform/detect'
import { useCallStore } from '../../stores/call'
import s from './TabBar.module.css'

// Tauri Android/iOS: disable drag-to-reorder so finger scrolling along the
// tab strip never accidentally moves a server. Reordering on those platforms
// can be added later via a long-press menu if needed.
const dragDisabled = isTauri && isMobile()

/** Max width of each edge fade (matches ~2.5rem) */
const TAB_MASK_FADE_PX = 40
/** Scroll distance (px) over which fade strength ramps 0 → 1 */
const TAB_MASK_SCROLL_RAMP_PX = 48
/** Interpolation toward scroll target each frame */
const TAB_MASK_LERP = 0.14

function buildTabsMaskImage(clientWidth: number, leftStrength: number, rightStrength: number): string | null {
  if (clientWidth <= 0) return null
  let pL = (TAB_MASK_FADE_PX / clientWidth) * 100 * leftStrength
  let pR = (TAB_MASK_FADE_PX / clientWidth) * 100 * rightStrength
  if (pL + pR > 100) {
    const scale = 100 / (pL + pR)
    pL *= scale
    pR *= scale
  }
  if (pL < 0.04 && pR < 0.04) return null

  const midEnd = 100 - pR
  const parts: string[] = []

  if (pL < 0.04) {
    parts.push('black 0')
  } else {
    parts.push(
      'transparent 0%',
      `rgba(0,0,0,0.14) ${(pL * 0.2).toFixed(3)}%`,
      `rgba(0,0,0,0.42) ${(pL * 0.48).toFixed(3)}%`,
      `rgba(0,0,0,0.76) ${(pL * 0.78).toFixed(3)}%`,
      `black ${pL.toFixed(3)}%`,
    )
  }

  if (midEnd > pL + 0.02) {
    parts.push(`black ${midEnd.toFixed(3)}%`)
  }

  if (pR < 0.04) {
    parts.push('black 100%')
  } else {
    parts.push(
      `rgba(0,0,0,0.76) ${(midEnd + pR * 0.22).toFixed(3)}%`,
      `rgba(0,0,0,0.42) ${(midEnd + pR * 0.52).toFixed(3)}%`,
      `rgba(0,0,0,0.14) ${(midEnd + pR * 0.8).toFixed(3)}%`,
      'transparent 100%',
    )
  }

  return `linear-gradient(to right, ${parts.join(', ')})`
}

function applyTabsMask(el: HTMLDivElement | null, left: number, right: number) {
  if (!el) return
  const img = buildTabsMaskImage(el.clientWidth, left, right)
  if (img == null) {
    el.style.maskImage = ''
    el.style.webkitMaskImage = ''
    return
  }
  el.style.maskImage = img
  el.style.webkitMaskImage = img
}



const STATUS_META: Record<MemberStatus, { label: string; color: string }> = {
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
  allServers:           ServerDisplay[]
  tabbedServers:        ServerDisplay[]
  activeServerId:       string
  dmActive:             boolean
  searchActive:         boolean
  notificationsActive:  boolean
  user?:                UserInfo
  // New optional props — all backward-compatible
  mutedServerIds?:      string[]
  currentStatus?:       MemberStatus
  ownerServerIds?:      string[]
  settingsServerIds?:   string[]
  userProfile?: {
    display_name: string
    username: string
    banner_color: string
    avatar_url: string | null
  }
  onSwitch:             (id: string) => void
  onClose:              (id: string) => void
  onOpenServer:         (id: string) => void
  onReorder:            (newIds: string[]) => void
  onDmClick:            () => void
  onSearchClick:        () => void
  onNotificationsClick: () => void
  onOpenSettings:       () => void
  onJoinServer:         () => void
  onCreateServer:       () => void
  onLogout?:            () => void
  onStatusChange?:      (status: MemberStatus) => void
  onOpenServerSettings?:(serverId: string) => void
  onToggleMuteServer?:  (serverId: string) => void
  onMarkAllRead?:       (serverId: string) => void
  onLeaveServer?:       (serverId: string) => void
}

export function TabBar({
  allServers, tabbedServers, activeServerId, dmActive, searchActive, notificationsActive,
  user, mutedServerIds, currentStatus: statusProp, ownerServerIds, settingsServerIds, userProfile,
  onSwitch, onClose, onOpenServer, onReorder, onDmClick, onSearchClick,
  onNotificationsClick, onOpenSettings, onJoinServer, onCreateServer,
  onLogout, onStatusChange, onOpenServerSettings, onToggleMuteServer, onMarkAllRead, onLeaveServer,
}: Props) {
  const [browserOpen,  setBrowserOpen]  = useState(false)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [menuOpen,     setMenuOpen]     = useState(false)
  const status: MemberStatus = statusProp ?? 'online'
  const [menuPos,      setMenuPos]      = useState({ top: 0, right: 0 })

  // Cross-session call presence: set when ANOTHER session of this user is on a
  // DM call OR in a server voice channel. The local session uses its own
  // activeCallDmId / VoiceConnectionBar for in-call UI, so we deliberately
  // only show the pill for SIBLING sessions.
  //
  // DM-call suppression: if the remote presence event is for the SAME DM the
  // local session is currently in, hide the pill (we're already showing the
  // in-call bar).
  //
  // TODO: voice-channel suppression follow-up — the call store doesn't yet
  // track the local voice channel id, so when a sibling joins the SAME voice
  // channel we're already in we'll briefly show the pill. Wire local
  // channelId through the call store to suppress that case.
  const remoteSessionCall = useCallStore(st => st.remoteSessionCall)
  const localActiveCallDmId = useCallStore(st => st.activeCallDmId)
  const showRemoteCallPill = !!remoteSessionCall
    && (remoteSessionCall.dmId == null || remoteSessionCall.dmId !== localActiveCallDmId)

  // Server tab context menu
  const [serverTabMenuOpen, setServerTabMenuOpen] = useState<string | null>(null)
  const [serverTabMenuPos,  setServerTabMenuPos]  = useState({ x: 0, y: 0 })
  const serverTabBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const tabsRef     = useRef<HTMLDivElement>(null)
  const browserRef  = useRef<HTMLDivElement>(null)
  const addBtnRef   = useRef<HTMLButtonElement>(null)
  const chipRef     = useRef<HTMLButtonElement>(null)
  const menuRef     = useRef<HTMLDivElement>(null)

  // RAF-based smooth scroll-fade for tabs
  const targetFadeRef  = useRef({ left: 0, right: 0 })
  const displayFadeRef = useRef({ left: 0, right: 0 })
  const fadeRafRef     = useRef(0)

  function updateTabsScrollTargets() {
    const el = tabsRef.current
    if (!el) return
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    if (maxScroll <= 0) {
      targetFadeRef.current = { left: 0, right: 0 }
    } else {
      const ramp = TAB_MASK_SCROLL_RAMP_PX
      targetFadeRef.current = {
        left:  Math.min(1, el.scrollLeft / ramp),
        right: Math.min(1, (maxScroll - el.scrollLeft) / ramp),
      }
    }
  }

  function scheduleTabsMaskAnimation() {
    if (fadeRafRef.current !== 0) return
    fadeRafRef.current = requestAnimationFrame(function tick() {
      const el = tabsRef.current
      if (!el) { fadeRafRef.current = 0; return }
      const t = targetFadeRef.current
      const d = displayFadeRef.current
      const k = TAB_MASK_LERP
      let nl = d.left  + (t.left  - d.left)  * k
      let nr = d.right + (t.right - d.right) * k
      if (Math.abs(t.left  - nl) < 0.002) nl = t.left
      if (Math.abs(t.right - nr) < 0.002) nr = t.right
      displayFadeRef.current = { left: nl, right: nr }
      applyTabsMask(el, nl, nr)
      const done = nl === t.left && nr === t.right
      if (done) {
        fadeRafRef.current = 0
      } else {
        fadeRafRef.current = requestAnimationFrame(tick)
      }
    })
  }

  function syncTabsScrollTargets() {
    updateTabsScrollTargets()
    scheduleTabsMaskAnimation()
  }

  useLayoutEffect(() => {
    updateTabsScrollTargets()
    displayFadeRef.current = { ...targetFadeRef.current }
    const el = tabsRef.current
    if (el) applyTabsMask(el, displayFadeRef.current.left, displayFadeRef.current.right)
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current)
    fadeRafRef.current = 0
    return () => {
      if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current)
      fadeRafRef.current = 0
    }
  }, [tabbedServers])

  useEffect(() => {
    const el = tabsRef.current
    if (!el) return
    syncTabsScrollTargets()
    const onScroll = () => syncTabsScrollTargets()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => syncTabsScrollTargets())
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
    // syncTabsScrollTargets is a render-scoped helper that touches only refs;
    // adding it to deps would re-mount the ResizeObserver every render. Re-run
    // on tabbedServers so a new tab-list triggers an initial sync.
  }, [tabbedServers]) // eslint-disable-line react-hooks/exhaustive-deps

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

  function openServerTabMenu(serverId: string) {
    const btn = serverTabBtnRefs.current[serverId]
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    setServerTabMenuPos({ x: rect.left, y: rect.bottom + 4 })
    setServerTabMenuOpen(serverId)
  }

  const tabbedIds = new Set(tabbedServers.map(srv => srv.id))
  const tabIds    = tabbedServers.map(srv => srv.id)

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

  // Resolve avatar info — prefer userProfile (new format) over legacy user prop
  const avatarBg  = userProfile?.banner_color ?? user?.avatarColor ?? 'var(--accent)'
  const avatarUrl = userProfile?.avatar_url   ?? user?.avatarUrl   ?? null
  const avatarInitial = (userProfile?.display_name?.charAt(0) || user?.avatarLetter || '?').toUpperCase()
  const displayName   = userProfile?.display_name ?? user?.displayName ?? 'User'

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
            <div className={`${s.browserList} scrollbar-thin scroll-view-y`}>
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
                    <div
                      className={s.browserIcon}
                      style={server.iconUrl ? undefined : { background: server.color }}
                    >
                      {server.iconUrl
                        ? <img src={server.iconUrl} alt="" className={s.browserIconImg} />
                        : server.icon}
                    </div>
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
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveDragId(null)}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div ref={tabsRef} className={`${s.tabs} scrollbar-none`}>
            {tabbedServers.map(server => (
              <SortableTab
                key={server.id}
                server={server}
                isActive={server.id === activeServerId}
                isDragging={activeDragId === server.id}
                isMuted={(mutedServerIds ?? []).includes(server.id)}
                isMenuOpen={serverTabMenuOpen === server.id}
                onSwitch={onSwitch}
                onClose={onClose}
                onOpenMenu={openServerTabMenu}
                menuBtnRefSetter={el => { serverTabBtnRefs.current[server.id] = el }}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeDragId ? (() => {
            const srv = tabbedServers.find(srv => srv.id === activeDragId)
            if (!srv) return null
            const serverColor = srv.hue != null ? `oklch(60% 0.15 ${srv.hue})` : srv.color
            return (
              <div className={`${s.tab} ${srv.id === activeServerId ? s.active : ''} ${s.dragOverlay}`}>
                <div className={s.tabClip}>
                  <div className={s.tabIconWrapper}>
                    <div
                      className={s.tabIcon}
                      style={srv.iconUrl ? undefined : { background: serverColor }}
                    >
                      {srv.iconUrl
                        ? <img src={srv.iconUrl} alt="" className={s.tabIconImg} />
                        : srv.icon}
                    </div>
                  </div>
                  <span className={`${s.tabName} txt-small txt-medium txt-truncate`}>{srv.name}</span>
                </div>
              </div>
            )
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* ── Server tab context menu ── */}
      <Menu
        open={!!serverTabMenuOpen}
        position={serverTabMenuPos}
        onClose={() => setServerTabMenuOpen(null)}
        minWidth="10rem"
      >
        {serverTabMenuOpen && (
          <>
            <MenuSection>
              <MenuItem
                icon={<VolumeX size={13} strokeWidth={1.5} />}
                label={(mutedServerIds ?? []).includes(serverTabMenuOpen) ? 'Unmute Server' : 'Mute Server'}
                onClick={() => { onToggleMuteServer?.(serverTabMenuOpen); setServerTabMenuOpen(null) }}
              />
              <MenuItem
                icon={<CheckCheck size={13} strokeWidth={1.5} />}
                label="Mark as Read"
                onClick={() => { onMarkAllRead?.(serverTabMenuOpen); setServerTabMenuOpen(null) }}
              />
              {onOpenServerSettings && (settingsServerIds ?? []).includes(serverTabMenuOpen) && (
                <MenuItem
                  icon={<Settings size={13} strokeWidth={1.5} />}
                  label="Server Settings"
                  onClick={() => { onOpenServerSettings(serverTabMenuOpen); setServerTabMenuOpen(null) }}
                />
              )}
            </MenuSection>
            <MenuDivider />
            <MenuSection>
              <MenuItem
                icon={<X size={13} strokeWidth={1.5} />}
                label="Close Tab"
                onClick={() => { onClose(serverTabMenuOpen); setServerTabMenuOpen(null) }}
              />
            </MenuSection>
            {!(ownerServerIds ?? []).includes(serverTabMenuOpen) && (
              <>
                <MenuDivider />
                <MenuSection>
                  <MenuItem
                    icon={<LogOut size={13} strokeWidth={1.5} />}
                    label="Leave Server"
                    danger
                    onClick={() => { onLeaveServer?.(serverTabMenuOpen); setServerTabMenuOpen(null) }}
                  />
                </MenuSection>
              </>
            )}
          </>
        )}
      </Menu>

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
          title={showRemoteCallPill
            ? (remoteSessionCall!.isVideo ? 'On a video call (other device)' : 'On a call (other device)')
            : 'Profile'}
        >
          <div className={s.avatarWrap}>
            <div className={`${s.avatarFace} hasActivityAvatarFace`} style={{ background: avatarBg }}>
              {avatarUrl
                ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                : avatarInitial}
            </div>
            <span className={s.statusDot} style={{ background: currentStatus.color }} />
          </div>
          <span className={`${s.userName} txt-small txt-medium`}>{displayName}</span>
          {showRemoteCallPill && (
            // TODO: server-side call-kind tracking required for "On video call" to render — currently always shows "On a call"
            <span className={s.callPill} aria-label={remoteSessionCall!.isVideo ? 'On a video call' : 'On a call'}>
              {remoteSessionCall!.isVideo ? 'On video call' : 'On a call'}
            </span>
          )}
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
            <div className={s.profileAvatarWrap}>
              <div className={s.profileAvatarFace} style={{ background: avatarBg }}>
                {avatarUrl
                  ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                  : avatarInitial}
              </div>
              <span className={s.profileStatusDot} style={{ background: currentStatus.color }} />
            </div>
            <div className={s.profileInfo}>
              <span className={`${s.profileName} txt-small txt-semibold`}>{displayName}</span>
              <span className={`${s.profileStatus} txt-tiny`} style={{ color: currentStatus.color }}>
                {currentStatus.label}
              </span>
            </div>
          </div>

          <div className={s.menuDivider} />

          {/* Status selector */}
          <div className={s.menuSection}>
            <span className={`${s.menuSectionLabel} txt-tiny txt-semibold`}>Set status</span>
            {(Object.entries(STATUS_META) as [MemberStatus, typeof STATUS_META[MemberStatus]][]).map(([key, meta]) => (
              <button
                key={key}
                className={`${s.statusItem} ${status === key ? s.statusItemActive : ''}`}
                onClick={() => { setMenuOpen(false); onStatusChange?.(key) }}
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
function SortableTab({ server, isActive, isDragging, isMuted, isMenuOpen, onSwitch, onClose, onOpenMenu, menuBtnRefSetter }: {
  server:           ServerDisplay
  isActive:         boolean
  isDragging:       boolean
  isMuted:          boolean
  isMenuOpen:       boolean
  onSwitch:         (id: string) => void
  onClose:          (id: string) => void
  onOpenMenu:       (id: string) => void
  menuBtnRefSetter: (el: HTMLButtonElement | null) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: server.id })

  const style: React.CSSProperties = {
    transform:  CSS.Transform.toString(transform),
    transition,
  }

  const serverColor = server.hue != null ? `oklch(60% 0.15 ${server.hue})` : server.color

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[s.tab, isActive ? s.active : '', isDragging ? s.draggingPlaceholder : '', isMenuOpen ? s.menuOpen : '', dragDisabled ? s.tabNoDrag : ''].filter(Boolean).join(' ')}
      {...(dragDisabled ? {} : attributes)}
      {...(dragDisabled ? {} : listeners)}
      onClick={() => onSwitch(server.id)}
      onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose(server.id) } }}
    >
      <div className={s.tabClip}>
        <div className={s.tabIconWrapper}>
          <div
            className={`${s.tabIcon}${!isMuted && server.unread ? ' hasActivityAvatarFace' : ''}`}
            style={server.iconUrl ? undefined : { background: serverColor }}
          >
            {server.iconUrl
              ? <img src={server.iconUrl} alt="" className={s.tabIconImg} />
              : server.icon}
          </div>
          {server.unread && (
            <span className={s.unreadDot} style={{ '--server-color': serverColor } as React.CSSProperties} />
          )}
          {isMuted && (
            <span className={`${s.mutedOverlay}${server.unread ? ' hasActivityAvatarFace' : ''}`}>
              <VolumeX size={14} strokeWidth={2} />
            </span>
          )}
        </div>
        <span className={`${s.tabName} txt-small txt-medium txt-truncate`}>{server.name}</span>
      </div>
      <button
        ref={menuBtnRefSetter}
        className={s.menuBtn}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onOpenMenu(server.id) }}
        title="Server options"
      >
        {isMenuOpen ? <X size={12} strokeWidth={2} /> : <MoreHorizontal size={12} strokeWidth={2} />}
      </button>
    </div>
  )
}

/* ── Icons ── */
function PlusIcon({ open }: { open: boolean }) {
  return <Plus size={18} strokeWidth={1.5} style={{ transition: 'transform 200ms ease', transform: open ? 'rotate(45deg)' : 'none' }} />
}
function SmallPlusIcon() { return <Plus          size={10} strokeWidth={1.75} /> }
function DmIcon()        { return <MessagesSquare size={18} strokeWidth={1.5} /> }
function SearchIcon()    { return <Search        size={18} strokeWidth={1.5} /> }
function BellIcon()      { return <Bell          size={18} strokeWidth={1.5} /> }
