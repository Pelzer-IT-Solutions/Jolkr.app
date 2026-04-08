import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, UserPlus, Search } from 'lucide-react'
import type { DMConversation } from '../../types'
import type { User, Friendship } from '../../api/types'
import * as api from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import { hashColor, avatarLetter } from '../../adapters/transforms'
import { rewriteStorageUrl } from '../../platform/config'
import Avatar from '../Avatar'
import s from './NewDMModal.module.css'

interface Props {
  onClose:      () => void
  onCreate:     (names: string[]) => void
  existingDms:  DMConversation[]
}

/** Resolved user ready for display. */
interface DisplayUser {
  id:        string
  name:      string
  username:  string
  status:    'online' | 'offline'
  color:     string
  letter:    string
  avatarUrl: string | null
  source:    'friend' | 'search'
}

function friendToUser(f: Friendship, myId: string): User | null {
  if (f.status !== 'accepted') return null
  return f.requester_id === myId ? (f.addressee ?? null) : (f.requester ?? null)
}

function toDisplayUser(u: User, source: 'friend' | 'search'): DisplayUser {
  return {
    id:        u.id,
    name:      u.display_name || u.username,
    username:  u.username,
    status:    u.is_online ? 'online' : 'offline',
    color:     hashColor(u.id),
    letter:    avatarLetter(u),
    avatarUrl: u.avatar_url ? (rewriteStorageUrl(u.avatar_url) ?? null) : null,
    source,
  }
}

export function NewDMModal({ onClose, onCreate, existingDms: _existingDms }: Props) {
  const [search, setSearch]           = useState('')
  const [selected, setSelected]       = useState<DisplayUser[]>([])
  const [friends, setFriends]         = useState<DisplayUser[]>([])
  const [searchResults, setSearchResults] = useState<DisplayUser[]>([])
  const [loading, setLoading]         = useState(true)
  const [searching, setSearching]     = useState(false)
  const inputRef  = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const myId = useAuthStore(s => s.user?.id ?? '')

  // Load friends on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const friendships = await api.getFriends()
        if (cancelled) return
        const users = friendships
          .map(f => friendToUser(f, myId))
          .filter((u): u is User => u !== null)
        setFriends(users.map(u => toDisplayUser(u, 'friend')))
      } catch (e) {
        console.error('Failed to load friends:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [myId])

  // Debounced user search
  const doSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const users = await api.searchUsers(query)
        // Exclude self and already-selected users
        const filtered = users
          .filter(u => u.id !== myId)
          .map(u => toDisplayUser(u, 'search'))
        setSearchResults(filtered)
      } catch (e) {
        console.error('User search failed:', e)
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [myId])

  function handleSearchChange(value: string) {
    setSearch(value)
    doSearch(value)
  }

  // Merge friends + search results, dedup by id, exclude selected
  const selectedIds = new Set(selected.map(u => u.id))
  const allUsers: DisplayUser[] = []
  const seen = new Set<string>()

  // Search results first if searching, then friends
  const source = search.trim().length >= 2 ? [...searchResults, ...friends] : friends
  for (const u of source) {
    if (seen.has(u.id) || selectedIds.has(u.id)) continue
    seen.add(u.id)
    allUsers.push(u)
  }

  const filtered = search.trim()
    ? allUsers.filter(u =>
        u.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        u.username.toLowerCase().includes(search.trim().toLowerCase())
      )
    : allUsers

  const onlineUsers  = filtered.filter(u => u.status === 'online')
  const offlineUsers = filtered.filter(u => u.status === 'offline')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  function toggleUser(user: DisplayUser) {
    setSelected(prev =>
      prev.some(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    )
    setSearch('')
    setSearchResults([])
    inputRef.current?.focus()
  }

  function removeSelected(id: string) {
    setSelected(prev => prev.filter(u => u.id !== id))
    inputRef.current?.focus()
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && search === '' && selected.length > 0) {
      setSelected(prev => prev.slice(0, -1))
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      toggleUser(filtered[0])
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal}>
        <div className={s.header}>
          <span className={s.title}>New Message</span>
          <button className={s.closeBtn} onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.searchArea}>
          <div className={s.inputWrap}>
            {selected.map(user => (
              <span key={user.id} className={s.chip}>
                {user.name}
                <button className={s.chipRemove} onClick={() => removeSelected(user.id)}>
                  <X size={10} strokeWidth={2} />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              className={`${s.searchInput} txt-small`}
              placeholder={selected.length ? 'Add more...' : 'Search friends or type a username...'}
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
            />
          </div>
        </div>

        <div className={`${s.list} scrollbar-thin`}>
          {loading && (
            <div className={`${s.empty} txt-small`}>Loading friends...</div>
          )}

          {searching && search.trim().length >= 2 && (
            <div className={`${s.empty} txt-small`}>
              <Search size={14} style={{ opacity: 0.5 }} /> Searching...
            </div>
          )}

          {onlineUsers.length > 0 && (
            <>
              <span className={`${s.sectionLabel} txt-tiny txt-semibold`}>
                Online — {onlineUsers.length}
              </span>
              {onlineUsers.map(u => (
                <UserRow key={u.id} user={u} selected={selectedIds.has(u.id)} onClick={() => toggleUser(u)} />
              ))}
            </>
          )}

          {offlineUsers.length > 0 && (
            <>
              <span className={`${s.sectionLabel} txt-tiny txt-semibold`}>
                Offline — {offlineUsers.length}
              </span>
              {offlineUsers.map(u => (
                <UserRow key={u.id} user={u} selected={selectedIds.has(u.id)} onClick={() => toggleUser(u)} />
              ))}
            </>
          )}

          {!loading && !searching && filtered.length === 0 && (
            <div className={`${s.empty} txt-small`}>
              {search.trim() ? 'No users found' : 'No friends yet — search by username above'}
            </div>
          )}
        </div>

        <div className={s.footer}>
          <button
            className={`${s.createBtn} txt-small`}
            disabled={selected.length === 0}
            onClick={() => onCreate(selected.map(u => u.name))}
          >
            {selected.length > 1 ? 'Create Group DM' : 'Start Conversation'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function UserRow({ user, selected, onClick }: { user: DisplayUser; selected: boolean; onClick: () => void }) {
  return (
    <button className={`${s.userRow} ${selected ? s.selected : ''}`} onClick={onClick}>
      <Avatar url={user.avatarUrl} name={user.name} size="sm" status={user.status} color={user.color} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span className={`${s.userName} txt-small txt-medium txt-truncate`}>{user.name}</span>
        {user.name !== user.username && (
          <span className="txt-tiny" style={{ opacity: 0.5 }}>{user.username}</span>
        )}
      </div>
      {user.source === 'search' && (
        <span className="txt-tiny" style={{ opacity: 0.4, marginLeft: 'auto', flexShrink: 0 }}>
          <UserPlus size={12} />
        </span>
      )}
      {selected && <Check size={14} strokeWidth={2} className={s.check} />}
    </button>
  )
}
