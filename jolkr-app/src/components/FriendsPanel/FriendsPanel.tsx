import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, UserPlus, Check, XCircle, MessageCircle, UserX } from 'lucide-react'
import type { MemberDisplay } from '../../types'
import Avatar from '../Avatar'
import s from './FriendsPanel.module.css'

type FriendTab = 'all' | 'online' | 'pending'

interface FriendRequest {
  id: string
  user: MemberDisplay
  type: 'incoming' | 'outgoing'
  created_at: string
}

interface Friend {
  user: MemberDisplay
  status: 'online' | 'idle' | 'dnd' | 'offline'
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

// TODO: Replace mock data with real API calls
const MOCK_FRIENDS: Friend[] = []
const MOCK_REQUESTS: FriendRequest[] = []

export function FriendsPanel({
  isOpen,
  onClose,
  onStartDM,
  onAcceptRequest,
  onRejectRequest,
  onCancelRequest,
  onRemoveFriend,
}: Props) {
  const [activeTab, setActiveTab] = useState<FriendTab>('all')
  const [friends, setFriends] = useState<Friend[]>(MOCK_FRIENDS)
  const [requests, setRequests] = useState<FriendRequest[]>(MOCK_REQUESTS)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

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

  const handleAccept = (requestId: string) => {
    onAcceptRequest?.(requestId)
    setRequests(prev => prev.filter(r => r.id !== requestId))
  }

  const handleReject = (requestId: string) => {
    onRejectRequest?.(requestId)
    setRequests(prev => prev.filter(r => r.id !== requestId))
  }

  const handleCancel = (requestId: string) => {
    onCancelRequest?.(requestId)
    setRequests(prev => prev.filter(r => r.id !== requestId))
  }

  const handleRemove = (userId: string) => {
    onRemoveFriend?.(userId)
    setFriends(prev => prev.filter(f => f.user.user_id !== userId))
    setSelectedUserId(null)
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
