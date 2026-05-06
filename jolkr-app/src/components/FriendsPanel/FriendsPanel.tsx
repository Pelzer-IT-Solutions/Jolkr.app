import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, UserPlus, Check, XCircle, MessageCircle, UserX, QrCode, ScanLine, Search } from 'lucide-react'
import type { MemberDisplay, MemberStatus } from '../../types'
import type { Friendship, User } from '../../api/types'
import * as api from '../../api/client'
import { wsClient } from '../../api/ws'
import { useAuthStore } from '../../stores/auth'
import { usePresenceStore } from '../../stores/presence'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { invalidateFriendsCache } from '../../services/friendshipCache'
import { hashColor } from '../../adapters/transforms'
import { useToast } from '../../stores/toast'
import Avatar from '../Avatar/Avatar'
import { QrCodeDisplay } from '../QrCodeDisplay'
import { QrCodeScanner } from '../QrCodeScanner'
import s from './FriendsPanel.module.css'

type FriendTab = 'all' | 'online' | 'pending' | 'add'


interface FriendRequest {
  id: string
  user: MemberDisplay
  type: 'incoming' | 'outgoing'
  created_at: string
}

interface Friend {
  user: MemberDisplay
  status: MemberStatus
  last_seen?: string
}

interface Props {
  open: boolean
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

function liveStatus(raw: string | undefined): MemberStatus {
  if (raw === 'online' || raw === 'idle' || raw === 'dnd') return raw
  return 'offline'
}

export function FriendsPanel({
  open,
  onClose,
  onStartDM,
  onAcceptRequest,
  onRejectRequest,
  onCancelRequest,
  onRemoveFriend,
}: Props) {
  const myId = useAuthStore(st => st.user?.id)
  const [activeTab, setActiveTab] = useState<FriendTab>('all')
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  // 'add' tab state — search + QR modals
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedQuery = useDebouncedValue(searchQuery, 300)
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [pendingAddIds, setPendingAddIds] = useState<Set<string>>(new Set())
  const [qrDisplayOpen, setQrDisplayOpen] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!myId) return
    const [accepted, pending] = await Promise.all([
      api.getFriends().catch(() => [] as Friendship[]),
      api.getPendingFriends().catch(() => [] as Friendship[]),
    ])
    const livePresence = usePresenceStore.getState().statuses
    setFriends(accepted.map(f => {
        const other = f.requester_id === myId ? f.addressee : f.requester
        const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id
        return {
          user: toDisplay(other, otherId),
          status: liveStatus(livePresence[otherId]),
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
  }, [myId])

  // Refresh whenever the panel opens
  useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  // Live-sync: backend publishes FriendshipUpdate to both parties on
  // send/accept/decline/remove/block, so the open panel re-fetches without
  // polling. Subscribe is gated on `open` to keep the blast radius small.
  useEffect(() => {
    if (!open) return
    const off = wsClient.on(ev => {
      if (ev.op === 'FriendshipUpdate') {
        refresh()
      }
    })
    return off
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Live debounced user search for the 'add' tab. Mirrors the pattern used in
  // NewDMModal: short queries clear the result list without hitting the API.
  useEffect(() => {
    if (activeTab !== 'add') return
    const q = debouncedQuery.trim()
    if (q.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    api.searchUsers(q)
      .then(users => {
        if (cancelled) return
        setSearchResults(users.filter(u => u.id !== myId))
      })
      .catch(() => { if (!cancelled) setSearchResults([]) })
      .finally(() => { if (!cancelled) setSearching(false) })
    return () => { cancelled = true }
  }, [debouncedQuery, activeTab, myId])

  // Reset search state whenever the panel closes so reopening starts clean.
  useEffect(() => {
    if (open) return
    setSearchQuery('')
    setSearchResults([])
    setActiveTab('all')
  }, [open])

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

  const handleSendRequest = async (userId: string) => {
    setPendingAddIds(prev => new Set(prev).add(userId))
    try {
      await api.sendFriendRequest(userId)
      invalidateFriendsCache()
      useToast.getState().show('Friend request sent', 'success')
      refresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send friend request'
      useToast.getState().show(msg, 'error')
    } finally {
      setPendingAddIds(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  if (!open) return null

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.panel}>
        <button className={s.closeBtnOverlay} onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={1.5} />
        </button>
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
            <button
              className={`${s.tab} ${activeTab === 'add' ? s.active : ''} txt-small`}
              onClick={() => setActiveTab('add')}
            >
              Add Friend
            </button>
          </div>
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
                        <Avatar url={req.user.avatar_url} name={req.user.display_name ?? req.user.username} size="sm" userId={req.user.user_id} color={req.user.color} />
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
                        <Avatar url={req.user.avatar_url} name={req.user.display_name ?? req.user.username} size="sm" userId={req.user.user_id} color={req.user.color} />
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
          ) : activeTab === 'add' ? (
            <div className={s.addPane}>
              <p className={`${s.addIntro} txt-small`}>
                Add friends with their username, email, or QR code.
              </p>

              <div className={s.qrButtons}>
                <button
                  className={`${s.qrBtn} txt-small txt-medium`}
                  onClick={() => setQrDisplayOpen(true)}
                >
                  <QrCode size={14} strokeWidth={1.5} />
                  My QR Code
                </button>
                <button
                  className={`${s.qrBtn} txt-small txt-medium`}
                  onClick={() => setScannerOpen(true)}
                >
                  <ScanLine size={14} strokeWidth={1.5} />
                  Scan QR
                </button>
              </div>

              <div className={s.divider}>
                <span className={`${s.dividerLabel} txt-tiny`}>or search</span>
              </div>

              <div className={s.searchWrap}>
                <Search size={14} strokeWidth={1.75} className={s.searchIcon} />
                <input
                  className={`${s.searchInput} txt-small`}
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Username or email…"
                  autoFocus
                />
              </div>

              {searching && searchQuery.trim().length >= 2 && (
                <div className={`${s.empty} txt-small`}>Searching…</div>
              )}

              {!searching && searchResults.map(u => (
                <div key={u.id} className={s.friendRow}>
                  <div className={s.userInfo}>
                    <Avatar
                      url={u.avatar_url}
                      name={u.display_name ?? u.username}
                      size="sm"
                      userId={u.id}
                      color={hashColor(u.id)}
                    />
                    <div className={s.names}>
                      <span className={`${s.displayName} txt-small txt-medium`}>
                        {u.display_name ?? u.username}
                      </span>
                      <span className={`${s.username} txt-tiny`}>@{u.username}</span>
                    </div>
                  </div>
                  <button
                    className={`${s.addBtn} txt-tiny txt-medium`}
                    onClick={() => handleSendRequest(u.id)}
                    disabled={pendingAddIds.has(u.id)}
                  >
                    {pendingAddIds.has(u.id) ? 'Sending…' : 'Add'}
                  </button>
                </div>
              ))}

              {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                <div className={s.empty}>
                  <p className="txt-small">No users found</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {filteredFriends.map(friend => (
                <div
                  key={friend.user.user_id}
                  className={s.friendRow}
                  onClick={() => setSelectedUserId(selectedUserId === friend.user.user_id ? null : friend.user.user_id)}
                >
                  <div className={s.userInfo}>
                    <Avatar url={friend.user.avatar_url} name={friend.user.display_name ?? friend.user.username} size="sm" status={friend.status} userId={friend.user.user_id} color={friend.user.color} />
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

      <QrCodeDisplay open={qrDisplayOpen} onClose={() => setQrDisplayOpen(false)} />
      <QrCodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onFriendRequestSent={refresh}
      />
    </div>,
    document.body
  )
}
