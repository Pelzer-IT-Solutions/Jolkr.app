import { useState, useLayoutEffect, useEffect } from 'react'
import { X } from 'lucide-react'
import type { MemberGroup, MemberStatus, Member } from '../../types'
import type { Message } from '../../api/types'
import * as api from '../../api/client'
import { revealDelay, revealWindowMs } from '../../utils/animations'
import s from './MemberPanel.module.css'

interface Props {
  members: MemberGroup
  mode: 'members' | 'pinned' | 'threads' | null
  serverId: string
  channelId: string
  isDm?: boolean
  onMemberClick?: (member: Member, e: React.MouseEvent) => void
  onUnpin?: (messageId: string) => void
}

export function MemberPanel({ members, mode, serverId, channelId, isDm = false, onMemberClick, onUnpin }: Props) {
  const visible = mode !== null
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([])
  const [loadingPinned, setLoadingPinned] = useState(false)

  // Fetch pinned messages when mode changes to 'pinned'
  useEffect(() => {
    if (mode !== 'pinned') return
    setLoadingPinned(true)
    const fetch = isDm ? api.getDmPinnedMessages(channelId) : api.getPinnedMessages(channelId)
    fetch.then(msgs => {
      setPinnedMessages(msgs)
      setLoadingPinned(false)
    }).catch(() => setLoadingPinned(false))
  }, [mode, channelId, isDm])

  // Handle unpin
  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setPinnedMessages(prev => prev.filter(m => m.id !== msgId))
  }

  const total = members.online.length + members.offline.length

  // 2 group headers + all member rows
  const totalRevealItems = 2 + total

  const [isRevealing, setIsRevealing] = useState(() => visible)

  // Trigger on panel open (visible) AND on server/mode switch
  useLayoutEffect(() => {
    if (!visible) return
    setIsRevealing(true)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(totalRevealItems))
    return () => clearTimeout(timer)
  }, [visible, serverId, mode])

  // Pre-compute stagger offsets
  const offlineHeaderIdx = 1 + members.online.length
  const offlineStart = offlineHeaderIdx + 1

  const revealStyle = (idx: number): React.CSSProperties | undefined =>
    isRevealing ? { '--reveal-delay': `${revealDelay(idx)}ms` } as React.CSSProperties : undefined

  // Render different content based on mode
  const renderContent = () => {
    switch (mode) {
      case 'pinned':
        return (
          <div className={`${s.scroll} scrollbar-thin scroll-view-y`}>
            {loadingPinned && <div className={`${s.empty} txt-small`}>Loading...</div>}
            {!loadingPinned && pinnedMessages.length === 0 && (
              <div className={`${s.empty} txt-small`}>No pinned messages</div>
            )}
            {pinnedMessages.map(msg => (
              <div key={msg.id} className={s.pinnedItem}>
                <div className={`${s.pinnedItemAuthor} txt-tiny txt-semibold`}>
                  {(msg.author as { display_name?: string; username?: string })?.display_name
                    ?? (msg.author as { username?: string })?.username ?? 'Unknown'}
                </div>
                <div className={`${s.pinnedItemContent} txt-small`}>
                  {(msg.content || '').slice(0, 200)}
                </div>
                {onUnpin && (
                  <button className={s.unpinBtn} title="Unpin" onClick={() => handleUnpin(msg.id)}>
                    <X size={12} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )

      case 'threads':
        return (
          <div className={`${s.scroll} scrollbar-thin scroll-view-y`}>
            <div className={`${s.empty} txt-small`}>Threads coming soon...</div>
          </div>
        )

      case 'members':
      default:
        return (
          <div className={`${s.scroll} scrollbar-thin scroll-view-y`}>
            <div
              className={`${s.category} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
              style={revealStyle(0)}
            >
              Online — {members.online.length}
            </div>
            {members.online.map((m, i) => (
              <button
                key={i}
                className={`${s.member} ${isRevealing ? 'revealing' : ''}`}
                style={revealStyle(1 + i)}
                onContextMenu={e => { e.preventDefault(); onMemberClick?.(m, e) }}
              >
                <MemberAvatar m={m} />
                <span className={`${s.name} txt-small txt-medium txt-truncate`}>{m.name}</span>
              </button>
            ))}

            <div
              className={`${s.category} ${s.categoryOffline} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}
              style={revealStyle(offlineHeaderIdx)}
            >
              Offline — {members.offline.length}
            </div>
            {members.offline.map((m, i) => (
              <button
                key={i}
                className={`${s.member} ${s.memberOffline} ${isRevealing ? 'revealing' : ''}`}
                style={revealStyle(offlineStart + i)}
                onContextMenu={e => { e.preventDefault(); onMemberClick?.(m, e) }}
              >
                <MemberAvatar m={m} offline />
                <span className={`${s.name} txt-small txt-medium txt-truncate`}>{m.name}</span>
              </button>
            ))}
          </div>
        )
    }
  }

  // Get header title based on mode
  const getHeaderTitle = () => {
    switch (mode) {
      case 'pinned': return 'Pinned Messages'
      case 'threads': return 'Threads'
      case 'members': return `Members — ${total}`
      default: return ''
    }
  }

  return (
    <aside className={`${s.panel} ${!visible ? s.hidden : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-tiny txt-semibold`}>
          {getHeaderTitle()}
        </span>
      </div>
      {renderContent()}
    </aside>
  )
}

function MemberAvatar({ m, offline }: { m: MemberGroup['online'][0]; offline?: boolean }) {
  const bgStyle = offline
    ? { background: 'var(--jolkr-neutral-dark-10)', color: 'var(--text-faint)' }
    : { background: m.color }

  return (
    <div className={s.avatarWrap}>
      <div className={`${s.avatar} hasActivityAvatarFace`} style={m.avatarUrl ? undefined : bgStyle}>
        {m.avatarUrl
          ? <img src={m.avatarUrl} alt="" loading="lazy" className={s.avatarImg} />
          : m.letter}
      </div>
      <StatusDot status={m.status} />
    </div>
  )
}

function StatusDot({ status }: { status: MemberStatus }) {
  return <span className={`${s.statusDot} ${s[status]}`} />
}
