import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { VolumeX, Flag, UserPlus, Link2, CircleSlash } from 'lucide-react'
import type { MemberDisplay } from '../../types'
import type { Server as ApiServer } from '../../api/types'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null }
import s from './UserContextMenu.module.css'

export interface UserContextMenuState {
  x: number
  y: number
  user: MemberDisplay
}

interface Props {
  menu: UserContextMenuState | null
  onClose: () => void
  onBlock?: (userId: string) => void
  onMute?: (userId: string) => void
  onReport?: (userId: string) => void
  onAddFriend?: (userId: string) => void
  onInviteToServer?: (userId: string, serverId: string) => void
  servers?: Server[]
  isBlocked?: boolean
  isMuted?: boolean
  isFriend?: boolean
}

export function UserContextMenu({
  menu,
  onClose,
  onBlock,
  onMute,
  onReport,
  onAddFriend,
  onInviteToServer,
  servers = [],
  isBlocked = false,
  isMuted = false,
  isFriend = false,
}: Props) {
  useEffect(() => {
    if (!menu) return
    function handleClick() { onClose() }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('click', handleClick, { once: true })
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menu, onClose])

  if (!menu) return null

  const handleBlock = () => {
    onBlock?.(menu.user.user_id)
    onClose()
  }

  const handleMute = () => {
    onMute?.(menu.user.user_id)
    onClose()
  }

  const handleReport = () => {
    onReport?.(menu.user.user_id)
    onClose()
  }

  const handleAddFriend = () => {
    onAddFriend?.(menu.user.user_id)
    onClose()
  }

  const handleInvite = (serverId: string) => {
    onInviteToServer?.(menu.user.user_id, serverId)
    onClose()
  }

  const hasServerOptions = servers.length > 0 && onInviteToServer

  return createPortal(
    <div className={s.backdrop} onClick={onClose}>
      <div
        className={s.menu}
        style={{ left: menu.x, top: menu.y }}
        onClick={e => e.stopPropagation()}
      >
        {/* User Header */}
        <div className={s.header}>
          <div className={s.avatar} style={{ background: menu.user.color }}>
            {menu.user.letter}
          </div>
          <div className={s.userInfo}>
            <span className={`${s.displayName} txt-small txt-semibold`}>
              {menu.user.display_name ?? menu.user.username}
            </span>
            <span className={`${s.username} txt-tiny`}>
              @{menu.user.username}
            </span>
          </div>
        </div>

        <div className={s.divider} />

        {/* Actions */}
        {!isFriend && onAddFriend && (
          <button className={s.item} onClick={handleAddFriend}>
            <UserPlus size={14} strokeWidth={1.5} />
            <span className="txt-small">Add Friend</span>
          </button>
        )}

        {onMute && (
          <button className={s.item} onClick={handleMute}>
            <VolumeX size={14} strokeWidth={1.5} />
            <span className="txt-small">{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
        )}

        {onBlock && (
          <button className={`${s.item} ${s.danger}`} onClick={handleBlock}>
            <CircleSlash size={14} strokeWidth={1.5} />
            <span className="txt-small">{isBlocked ? 'Unblock' : 'Block'}</span>
          </button>
        )}

        {hasServerOptions && (
          <>
            <div className={s.divider} />
            <div className={s.sectionLabel}>
              <Link2 size={12} strokeWidth={1.5} />
              <span className="txt-tiny">Invite to Server</span>
            </div>
            <div className={s.serverList}>
              {servers.map(server => (
                <button
                  key={server.id}
                  className={s.serverItem}
                  onClick={() => handleInvite(server.id)}
                >
                  <div className={s.serverIcon} style={{ background: server.hue != null ? `oklch(60% 0.15 ${server.hue})` : 'oklch(60% 0 0)' }}>
                    {server.name.charAt(0).toUpperCase()}
                  </div>
                  <span className={`${s.serverName} txt-small txt-truncate`}>{server.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className={s.divider} />

        {onReport && (
          <button className={`${s.item} ${s.danger}`} onClick={handleReport}>
            <Flag size={14} strokeWidth={1.5} />
            <span className="txt-small">Report User</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
