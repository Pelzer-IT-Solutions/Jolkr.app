import { Info, LogOut, Pencil, VolumeX } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useClampedMenuPosition } from '../../hooks/useClampedMenuPosition'
import { useT } from '../../hooks/useT'
import { Avatar } from '../Avatar/Avatar'
import s from './GroupContextMenu.module.css'
import type { DMConversation } from '../../types'

/** Open-state for the group-DM context menu. Mirrors `UserContextMenuState`. */
export interface GroupContextMenuState {
  x: number
  y: number
  dmId: string
}

export interface GroupContextMenuProps {
  menu: GroupContextMenuState | null
  /** Resolved DM record for `menu.dmId`. Looking up the conversation
   *  in the parent keeps this component pure. */
  conv: DMConversation | null
  isMuted: boolean
  onClose: () => void
  onViewInfo: (dmId: string, anchor: { x: number; y: number }) => void
  onToggleMute: (dmId: string) => void
  onEdit: (dmId: string) => void
  onLeave: (dmId: string) => void
}

export function GroupContextMenu({
  menu,
  conv,
  isMuted,
  onClose,
  onViewInfo,
  onToggleMute,
  onEdit,
  onLeave,
}: GroupContextMenuProps) {
  const { t } = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const clamped = useClampedMenuPosition(menu ? { x: menu.x, y: menu.y } : null, menuRef)

  useEffect(() => {
    if (!menu) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menu, onClose])

  if (!menu || !conv) return null

  const displayName = conv.name ?? conv.participants.map(p => p.name).join(', ')
  const memberCount = conv.participants.length

  const handleViewInfo = () => {
    onViewInfo(menu.dmId, { x: menu.x, y: menu.y })
    onClose()
  }
  const handleToggleMute = () => {
    onToggleMute(menu.dmId)
    onClose()
  }
  const handleEdit = () => {
    onEdit(menu.dmId)
    onClose()
  }
  const handleLeave = () => {
    onLeave(menu.dmId)
    onClose()
  }

  const style: React.CSSProperties = clamped
    ? { left: clamped.left, top: clamped.top, visibility: 'visible' }
    : { left: menu.x, top: menu.y, visibility: 'hidden' }

  return createPortal(
    <div ref={menuRef} className={s.menu} style={style} role="menu">
      <div className={s.header}>
        <div className={s.groupAvatars} aria-hidden="true">
          {conv.participants.slice(0, 2).map((p, i) => (
            <div
              key={p.userId ?? `slot-${i}`}
              className={`${s.groupAvatar} ${i === 1 ? s.groupAvatarBack : ''}`}
            >
              <Avatar
                url={p.avatarUrl}
                name={p.name}
                size="xs"
                userId={p.userId}
                color={p.color}
              />
            </div>
          ))}
        </div>
        <div className={s.groupInfo}>
          <span className={`${s.displayName} txt-small txt-semibold txt-truncate`}>
            {displayName}
          </span>
          <span className={`${s.memberCount} txt-tiny`}>
            {t('groupContextMenu.members', { count: memberCount })}
          </span>
        </div>
      </div>

      <div className={s.divider} />

      <button className={s.item} onClick={handleViewInfo} role="menuitem">
        <Info size={14} strokeWidth={1.5} />
        <span className="txt-small">{t('groupContextMenu.info')}</span>
      </button>

      <button className={s.item} onClick={handleToggleMute} role="menuitem">
        <VolumeX size={14} strokeWidth={1.5} />
        <span className="txt-small">
          {isMuted ? t('groupContextMenu.unmute') : t('groupContextMenu.mute')}
        </span>
      </button>

      <button className={s.item} onClick={handleEdit} role="menuitem">
        <Pencil size={14} strokeWidth={1.5} />
        <span className="txt-small">{t('groupContextMenu.edit')}</span>
      </button>

      <div className={s.divider} />

      <button className={`${s.item} ${s.danger}`} onClick={handleLeave} role="menuitem">
        <LogOut size={14} strokeWidth={1.5} />
        <span className="txt-small">{t('groupContextMenu.leave')}</span>
      </button>
    </div>,
    document.body,
  )
}
