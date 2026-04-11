import { useState, useLayoutEffect } from 'react'
import type { MemberGroup, Member } from '../../types'
import type { User } from '../../api/types'
import Avatar from '../Avatar'
import { PinnedMessagesPanel } from '../PinnedMessagesPanel/PinnedMessagesPanel'
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
  users?: Map<string, User>
}

export function MemberPanel({ members, mode, serverId, channelId, isDm = false, onMemberClick, onUnpin, users }: Props) {
  const visible = mode !== null

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
          <PinnedMessagesPanel
            channelId={channelId}
            isDm={isDm}
            onClose={() => {/* handled by parent */}}
            onUnpin={onUnpin}
            users={users}
          />
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
                <Avatar
                  url={m.avatarUrl}
                  name={m.name}
                  size="sm"
                  status={m.status}
                  userId={m.userId}
                  color={m.color}
                />
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
                <Avatar
                  url={m.avatarUrl}
                  name={m.name}
                  size="sm"
                  status={m.status}
                  userId={m.userId}
                  color={m.color}
                />
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

