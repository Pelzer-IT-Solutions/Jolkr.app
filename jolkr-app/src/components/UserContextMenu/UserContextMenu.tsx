import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { VolumeX, Flag, UserPlus, Link2, CircleSlash, UserMinus, Gavel, Shield } from 'lucide-react'
import type { MemberDisplay } from '../../types'
import type { Server as ApiServer, Role } from '../../api/types'
import Avatar from '../Avatar'
import ServerIconComp from '../ServerIcon'
import s from './UserContextMenu.module.css'

// Extend API Server with frontend-only display fields
type Server = ApiServer & { hue?: number | null }

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
  onBlock,
  onMute,
  onReport,
  onAddFriend,
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

  const handleInvite = (serverId: string) => {
    onInviteToServer?.(menu.user.user_id, serverId)
    onClose()
  }

  const hasServerOptions = servers.length > 0 && onInviteToServer

  return createPortal(
      <div
        ref={menuRef}
        className={s.menu}
        style={{ right: `calc(100vw - ${menu.x}px)`, top: menu.y }}
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
                      style={{ background: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : 'var(--text-faint)' }}
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
