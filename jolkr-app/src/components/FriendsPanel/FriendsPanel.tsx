import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, UserPlus, Check, XCircle, MessageCircle, UserX } from 'lucide-react'
import type { MemberDisplay } from '../../types'
import type { Friendship, User } from '../../api/types'
import * as api from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import { usePresenceStore } from '../../stores/presence'
import Avatar from '../Avatar'
import s from './FriendsPanel.module.css'

type FriendTab = 'all' | 'online' | 'pending'
type LiveStatus = 'online' | 'idle' | 'dnd' | 'offline'

interface FriendRequest {
  id: string
  user: MemberDisplay
  type: 'incoming' | 'outgoing'
  created_at: string
}

interface Friend {
  user: MemberDisplay
  status: LiveStatus
  last_seen?: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onStartDM?: (userId: string) => void
  onAcceptRequest?: (requestId: string) => void
  onRejectRequest?: (requestId: string) => void
  onCancelRequest?: (requestId: string) => void
  onRemoveFriend?: (userId: string) => void
}

// Backend Friendship → MemberDisplay for the OTHER party (not the current user).
function toDisplay(otherUser: User | undefined, fallbackUserId: string): MemberDisplay {
  const username = otherUser?.username ?? fallbackUserId.slice(0, 8)
  const displayName = otherUser?.display_name ?? null
  return {
    user_id: otherUser?.id ?? fallbackUserId,
    username,
    display_name: displayName,
    status: 'offline',
    color: 'oklch(60% 0.08 250)',
    letter: (displayName ?? username).charAt(0).toUpperCase(),
    avatar_url: otherUser?.avatar_url ?? null,
  }
}

function liveStatus(raw: string | undefined): LiveStatus {
  if (raw === 'online' || raw === 'idle' || raw === 'dnd') return raw
  return 'offline'
}

export function FriendsPanel({
  isOpen,
  onClose,
  onStartDM,
  onAcceptRequest,
  onRejectRequest,
  onCancelRequest,
  onRemoveFriend,
}: Props) {
  const myId = useAuthStore(st => st.user?.id)
  const presence = usePresenceStore(st => st.statuses)
  const [activeTab, setActiveTab] = useState<FriendTab>('all')
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!myId) return
    const [accepted, pending] = await Promise.all([
      api.getFriends().catch(() => [] as Friendship[]),
      api.getPendingFriends().catch(() => [] as Friendship[]),
    ])
    setFriends(accepted.map(f => {
        const other = f.requester_id === myId ? f.addressee : f.requester
        const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id
        return {
          user: toDisplay(other, otherId),
          status: liveStatus(presence[otherId]),
        }
      }))
      setRequests(pending.map(f => {
        const isIncoming = f.addressee_id === myId
        const other = isIncoming ? f.requester : f.addressee
        const otherId = isIncoming ? f.requester_id : f.addressee_id
        return {
          id: f.id,
          user: toDisplay(other, otherId),
          type: isIncoming ? 'incoming' : 'outgoing',
          created_at: '',
        }
      }))
  }, [myId, presence])

  // Refresh whenever the panel opens
  useEffect(() => {
    if (!isOpen) return
    refresh()
  }, [isOpen, refresh])

  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const filteredFriends = friends.filter(f => {
    if (activeTab === 'online') return f.status !== 'offline'
    return true
  })

  const incomingRequests = requests.filter(r => r.type === 'incoming')
  const outgoingRequests = requests.filter(r => r.type === 'outgoing')

  const handleAccept = async (requestId: string) => {
    setRequests(prev => prev.filter(r => r.id !== requestId))
    await Promise.resolve(onAcceptRequest?.(requestId))
    refresh()
  }

  const handleReject = async (requestId: string) => {
    setRequests(prev => prev.filter(r => r.id !== requestId))
    await Promise.resolve(onRejectRequest?.(requestId))
    refresh()
  }

  const handleCancel = async (requestId: string) => {
    setRequests(prev => prev.filter(r => r.id !== requestId))
    // Cancel uses the same DELETE endpoint as decline; reuse onRejectRequest if onCancelRequest isn't wired.
    const cb = onCancelRequest ?? onRejectRequest
    await Promise.resolve(cb?.(requestId))
    refresh()
  }

  const handleRemove = async (userId: string) => {
    setFriends(prev => prev.filter(f => f.user.user_id !== userId))
    setSelectedUserId(null)
    await Promise.resolve(onRemoveFriend?.(userId))
    refresh()
  }

  const handleStartDM = (userId: string) => {
    onStartDM?.(userId)
    onClose()
  }

  if (!isOpen) return null

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.panel}>
        <div className={s.header}>
          <div className={s.tabs}>
            <button
              className={`${s.tab} ${activeTab === 'all' ? s.active : ''} txt-small`}
              onClick={() => setActiveTab('all')}
            >
              All
              <span className={s.badge}>{friends.length}</span>
            </button>
            <button
              className={`${s.tab} ${activeTab === 'online' ? s.active : ''} txt-small`}
              onClick={() => setActiveTab('online')}
            >
              Online
            </button>
            <button
              className={`${s.tab} ${activeTab === 'pending' ? s.active : ''} txt-small`}
              onClick={() => setActiveTab('pending')}
            >
              Pending
              {requests.length > 0 && <span className={s.badge}>{requests.length}</span>}
            </button>
          </div>
          <button className={s.closeBtn} onClick={onClose}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className={`${s.content} scrollbar-thin`}>
          {activeTab === 'pending' ? (
            <>
              {incomingRequests.length > 0 && (
                <div className={s.section}>
                  <h4 className={`${s.sectionTitle} txt-tiny txt-semibold`}>Incoming ({incomingRequests.length})</h4>
                  {incomingRequests.map(req => (
                    <div key={req.id} className={s.requestRow}>
                      <div className={s.userInfo}>
                        <Avatar url={null} name={req.user.display_name ?? req.user.username} size="sm" userId={req.user.user_id} color={req.user.color} />
                        <div className={s.names}>
                          <span className={`${s.displayName} txt-small txt-medium`}>{req.user.display_name ?? req.user.username}</span>
                          <span className={`${s.username} txt-tiny`}>@{req.user.username}</span>
                        </div>
                      </div>
                      <div className={s.actions}>
                        <button className={s.acceptBtn} onClick={() => handleAccept(req.id)}>
                          <Check size={16} strokeWidth={2} />
                        </button>
                        <button className={s.rejectBtn} onClick={() => handleReject(req.id)}>
                          <XCircle size={16} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {outgoingRequests.length > 0 && (
                <div className={s.section}>
                  <h4 className={`${s.sectionTitle} txt-tiny txt-semibold`}>Outgoing ({outgoingRequests.length})</h4>
                  {outgoingRequests.map(req => (
                    <div key={req.id} className={s.requestRow}>
                      <div className={s.userInfo}>
                        <Avatar url={null} name={req.user.display_name ?? req.user.username} size="sm" userId={req.user.user_id} color={req.user.color} />
                        <div className={s.names}>
                          <span className={`${s.displayName} txt-small txt-medium`}>{req.user.display_name ?? req.user.username}</span>
                          <span className={`${s.username} txt-tiny`}>@{req.user.username}</span>
                        </div>
                      </div>
                      <button className={s.cancelBtn} onClick={() => handleCancel(req.id)}>
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {requests.length === 0 && (
                <div className={s.empty}>
                  <UserPlus size={48} strokeWidth={1} className={s.emptyIcon} />
                  <p className="txt-small">No pending friend requests</p>
                </div>
              )}
            </>
          ) : (
            <>
              {filteredFriends.map(friend => (
                <div
                  key={friend.user.user_id}
                  className={s.friendRow}
                  onClick={() => setSelectedUserId(selectedUserId === friend.user.user_id ? null : friend.user.user_id)}
                >
                  <div className={s.userInfo}>
                    <Avatar url={null} name={friend.user.display_name ?? friend.user.username} size="sm" status={friend.status} userId={friend.user.user_id} color={friend.user.color} />
                    <div className={s.names}>
                      <span className={`${s.displayName} txt-small txt-medium`}>{friend.user.display_name ?? friend.user.username}</span>
                      <span className={`${s.statusText} txt-tiny`}>
                        {friend.status === 'offline' ? (friend.last_seen ?? 'Offline') : friend.status}
                      </span>
                    </div>
                  </div>

                  {selectedUserId === friend.user.user_id && (
                    <div className={s.rowActions}>
                      <button className={s.actionBtn} onClick={() => handleStartDM(friend.user.user_id)}>
                        <MessageCircle size={16} strokeWidth={1.5} />
                      </button>
                      <button className={s.actionBtn} onClick={() => handleRemove(friend.user.user_id)}>
                        <UserX size={16} strokeWidth={1.5} />
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {filteredFriends.length === 0 && (
                <div className={s.empty}>
                  <p className="txt-small">No friends found</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
