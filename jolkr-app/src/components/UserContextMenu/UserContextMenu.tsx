import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { VolumeX, Flag, UserPlus, Link2, CircleSlash, UserMinus, Gavel, Shield, User as UserIcon, X } from 'lucide-react'
import type { MemberDisplay } from '../../types'
import type { Server as ApiServer, Role } from '../../api/types'
import Avatar from '../Avatar/Avatar'
import ServerIconComp from '../ServerIcon/ServerIcon'
import { useClampedMenuPosition } from '../../hooks/useClampedMenuPosition'
import s from './UserContextMenu.module.css'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null }

export interface UserContextMenuState {
  x: number
  y: number
  user: MemberDisplay
  /** Set when the menu is opened from a DM row — enables the "Close DM" item. */
  dmId?: string
}

interface Props {
  menu: UserContextMenuState | null
  onClose: () => void
  /** "View Profile" — opens the ProfileCard popover anchored at the click. */
  onViewProfile?: (userId: string, anchor: { x: number; y: number }) => void
  onBlock?: (userId: string) => void
  onMute?: (userId: string) => void
  onReport?: (userId: string) => void
  onAddFriend?: (userId: string) => void
  /** Shown when `isFriend` is true (replaces Add Friend). */
  onRemoveFriend?: (userId: string) => void
  /** Shown only when provided — i.e. the menu is opened from a DM context. */
  onCloseDm?: () => void
  onKick?: (userId: string) => void
  onBan?: (userId: string) => void
  onInviteToServer?: (userId: string, serverId: string) => void
  onToggleRole?: (userId: string, roleId: string, hasRole: boolean) => void
  servers?: Server[]
  roles?: Role[]
  userRoleIds?: string[]
  canManageRoles?: boolean
  canKick?: boolean
  canBan?: boolean
  isBlocked?: boolean
  isMuted?: boolean
  isFriend?: boolean
}

export function UserContextMenu({
  menu,
  onClose,
  onViewProfile,
  onBlock,
  onMute,
  onReport,
  onAddFriend,
  onRemoveFriend,
  onCloseDm,
  onKick,
  onBan,
  onInviteToServer,
  onToggleRole,
  servers = [],
  roles = [],
  userRoleIds = [],
  canManageRoles = false,
  canKick = false,
  canBan = false,
  isBlocked = false,
  isMuted = false,
  isFriend = false,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  // Clamp the menu inside the viewport — without this it overflows when the
  // user right-clicks near a screen edge (e.g. inside the left sidebar).
  const clamped = useClampedMenuPosition(menu ? { x: menu.x, y: menu.y } : null, menuRef)

  useEffect(() => {
    if (!menu) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
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

  const handleRemoveFriend = () => {
    onRemoveFriend?.(menu.user.user_id)
    onClose()
  }

  const handleViewProfile = () => {
    onViewProfile?.(menu.user.user_id, { x: menu.x, y: menu.y })
    onClose()
  }

  const handleCloseDm = () => {
    onCloseDm?.()
    onClose()
  }

  const handleInvite = (serverId: string) => {
    onInviteToServer?.(menu.user.user_id, serverId)
    onClose()
  }

  const hasServerOptions = servers.length > 0 && onInviteToServer

  // First render: position absolute at the click point but invisible so the
  // measurement happens. The clamped pass then makes it visible at the clamped
  // coordinates — avoids a one-frame flash at the wrong edge.
  const style: React.CSSProperties = clamped
    ? { left: clamped.left, top: clamped.top, visibility: 'visible' }
    : { left: menu.x, top: menu.y, visibility: 'hidden' }

  return createPortal(
      <div
        ref={menuRef}
        className={s.menu}
        style={style}
      >
        {/* User Header */}
        <div className={s.header}>
          <Avatar
            url={menu.user.avatar_url}
            name={menu.user.display_name ?? menu.user.username}
            size="md"
            status={menu.user.status}
            userId={menu.user.user_id}
            color={menu.user.color}
          />
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
        {onViewProfile && (
          <button className={s.item} onClick={handleViewProfile}>
            <UserIcon size={14} strokeWidth={1.5} />
            <span className="txt-small">View Profile</span>
          </button>
        )}

        {!isFriend && onAddFriend && (
          <button className={s.item} onClick={handleAddFriend}>
            <UserPlus size={14} strokeWidth={1.5} />
            <span className="txt-small">Add Friend</span>
          </button>
        )}
        {isFriend && onRemoveFriend && (
          <button className={`${s.item} ${s.danger}`} onClick={handleRemoveFriend}>
            <UserMinus size={14} strokeWidth={1.5} />
            <span className="txt-small">Remove Friend</span>
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

        {onCloseDm && (
          <button className={`${s.item} ${s.danger}`} onClick={handleCloseDm}>
            <X size={14} strokeWidth={1.5} />
            <span className="txt-small">Close DM</span>
          </button>
        )}

        {(canKick || canBan) && (
          <>
            <div className={s.divider} />
            <div className={s.sectionLabel}>
              <span className="txt-tiny">Moderation</span>
            </div>
            {canKick && onKick && (
              <button className={`${s.item} ${s.danger}`} onClick={() => { onKick(menu.user.user_id); onClose() }}>
                <UserMinus size={14} strokeWidth={1.5} />
                <span className="txt-small">Kick</span>
              </button>
            )}
            {canBan && onBan && (
              <button className={`${s.item} ${s.danger}`} onClick={() => { onBan(menu.user.user_id); onClose() }}>
                <Gavel size={14} strokeWidth={1.5} />
                <span className="txt-small">Ban</span>
              </button>
            )}
          </>
        )}

        {canManageRoles && roles.length > 0 && onToggleRole && (
          <>
            <div className={s.divider} />
            <div className={s.sectionLabel}>
              <Shield size={12} strokeWidth={1.5} />
              <span className="txt-tiny">Assign Role</span>
            </div>
            <div className={s.serverList}>
              {roles.filter(r => !r.is_default).map(role => {
                const hasRole = userRoleIds.includes(role.id)
                return (
                  <button
                    key={role.id}
                    className={`${s.roleItem} ${hasRole ? s.roleActive : ''}`}
                    onClick={() => { onToggleRole(menu.user.user_id, role.id, hasRole); onClose() }}
                  >
                    <span
                      className={s.roleDot}
                      style={role.color ? { '--role-color': `#${role.color.toString(16).padStart(6, '0')}` } as React.CSSProperties : undefined}
                    />
                    <span className={`${s.serverName} txt-small txt-truncate`}>{role.name}</span>
                    {hasRole && <span className={`${s.roleCheck} txt-tiny`}>✓</span>}
                  </button>
                )
              })}
            </div>
          </>
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
                  <ServerIconComp name={server.name} iconUrl={server.icon_url} serverId={server.id} size="xs" />
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
      </div>,
    document.body
  )
}
