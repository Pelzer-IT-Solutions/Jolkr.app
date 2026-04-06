import { useState, useLayoutEffect } from 'react'
import type { MemberGroup, MemberStatus, Member } from '../../types'
import { revealDelay, revealWindowMs } from '../../utils/animations'
import s from './MemberPanel.module.css'

interface Props {
  members: MemberGroup
  visible: boolean
  serverId: string
  onMemberClick?: (member: Member, e: React.MouseEvent) => void
}

export function MemberPanel({ members, visible, serverId, onMemberClick }: Props) {
  const total = members.online.length + members.offline.length

  // 2 group headers + all member rows
  const totalRevealItems = 2 + total

  const [isRevealing, setIsRevealing] = useState(() => visible)

  // Trigger on panel open (visible) AND on server switch (serverId)
  useLayoutEffect(() => {
    if (!visible) return
    setIsRevealing(true)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(totalRevealItems))
    return () => clearTimeout(timer)
  }, [visible, serverId])

  // Pre-compute stagger offsets
  const offlineHeaderIdx = 1 + members.online.length
  const offlineStart = offlineHeaderIdx + 1

  const revealStyle = (idx: number): React.CSSProperties | undefined =>
    isRevealing ? { '--reveal-delay': `${revealDelay(idx)}ms` } as React.CSSProperties : undefined

  return (
    <aside className={`${s.panel} ${!visible ? s.hidden : ''}`}>
      <div className={s.header}>
        <span className={`${s.title} txt-tiny txt-semibold`}>
          Members — {total}
        </span>
      </div>
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
    </aside>
  )
}

function MemberAvatar({ m, offline }: { m: MemberGroup['online'][0]; offline?: boolean }) {
  const bgStyle = offline
    ? { background: 'var(--jolkr-neutral-dark-10)', color: 'var(--text-faint)' }
    : { background: m.color }

  return (
    <div className={s.avatarWrap}>
      <div className={`${s.avatarFace} hasActivityAvatarFace`} style={m.avatarUrl ? undefined : bgStyle}>
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
