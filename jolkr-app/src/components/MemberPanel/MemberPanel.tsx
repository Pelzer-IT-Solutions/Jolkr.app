import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import { useT } from '../../hooks/useT'
import { revealDelay } from '../../utils/animations'
import { Avatar } from '../Avatar/Avatar'
import { PinnedMessagesPanel } from '../PinnedMessagesPanel/PinnedMessagesPanel'
import { ThreadListPanel } from '../Thread/ThreadListPanel'
import { ThreadPanel } from '../Thread/ThreadPanel'
import s from './MemberPanel.module.css'
import type { User, Thread } from '../../api/types'
import type { MemberGroup, MemberSummary } from '../../types'

/** How long the panel's collapse animation takes (matches `--transition`). */
const HIDE_TRANSITION_MS = 200

interface Props {
  members: MemberGroup
  mode: 'members' | 'pinned' | 'threads' | null
  serverId: string
  channelId: string
  isDm?: boolean
  /** Right-click on a member row → context menu. */
  onMemberClick?: (member: MemberSummary, e: React.MouseEvent) => void
  /** Plain (left) click on a member row → open the profile card. */
  onMemberOpenProfile?: (member: MemberSummary, e: React.MouseEvent) => void
  onUnpin?: (messageId: string) => void
  users?: Map<string, User>
  pinnedVersion?: number
  onMobileClose?: () => void
  /** When set, the threads view renders ThreadPanel for this thread instead of the list. */
  openThreadId?: string | null
  /** Open a specific thread from the list. */
  onOpenThread?: (thread: Thread) => void
  /** Go back from a single-thread view to the thread list. */
  onCloseThread?: () => void
}

export function MemberPanel({ members, mode, serverId, channelId, isDm = false, onMemberClick, onMemberOpenProfile, onUnpin, users, pinnedVersion, onMobileClose, openThreadId, onOpenThread, onCloseThread }: Props) {
  const { t } = useT()
  const visible = mode !== null

  // Hold the previous non-null mode while the panel is collapsing so we keep
  // rendering THAT mode's content during the close transition. Without this,
  // closing 'pinned' would immediately swap to the 'members' default branch
  // and you'd see a brief Members flash slide out instead of Pinned.
  const [displayMode, setDisplayMode] = useState<typeof mode>(mode)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Update displayMode synchronously when mode opens; defer the unset to the
  // close-transition timer so the panel renders the previous mode's content
  // while collapsing. State-during-render avoids set-state-in-effect.
  // Ref + timer cleanup lives in the effect — refs may not be touched in render.
  const [prevMode, setPrevMode] = useState(mode)
  if (mode !== prevMode) {
    setPrevMode(mode)
    if (mode !== null) setDisplayMode(mode)
  }
  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (mode !== null) return
    hideTimerRef.current = setTimeout(() => setDisplayMode(null), HIDE_TRANSITION_MS)
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [mode])

  const total = members.online.length + members.offline.length

  // 2 group headers + all member rows
  const totalRevealItems = 2 + total

  const isRevealing = useRevealAnimation(totalRevealItems, [visible, serverId, mode], visible)

  // Pre-compute stagger offsets
  const offlineHeaderIdx = 1 + members.online.length
  const offlineStart = offlineHeaderIdx + 1

  const revealStyle = (idx: number): React.CSSProperties | undefined =>
    isRevealing ? { '--reveal-delay': `${revealDelay(idx)}ms` } as React.CSSProperties : undefined

  // Render different content based on mode
  const renderContent = () => {
    switch (displayMode) {
      case 'pinned':
        return (
          <PinnedMessagesPanel
            channelId={channelId}
            isDm={isDm}
            onClose={() => {/* handled by parent */}}
            onUnpin={onUnpin}
            users={users}
            pinnedVersion={pinnedVersion}
          />
        )

      case 'threads':
        if (openThreadId) {
          return (
            <ThreadPanel
              threadId={openThreadId}
              channelId={channelId}
              serverId={serverId}
              users={users}
              onBack={() => onCloseThread?.()}
            />
          )
        }
        return (
          <div className={`${s.scroll} scrollbar-thin scroll-view-y`}>
            <ThreadListPanel
              channelId={channelId}
              onOpenThread={t => onOpenThread?.(t)}
            />
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
              {t('memberPanel.online', { count: members.online.length })}
            </div>
            {members.online.map((m, i) => (
              <button
                key={m.userId}
                className={`${s.member} ${isRevealing ? 'revealing' : ''}`}
                style={revealStyle(1 + i)}
                onClick={e => onMemberOpenProfile?.(m, e)}
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
              {t('memberPanel.offline', { count: members.offline.length })}
            </div>
            {members.offline.map((m, i) => (
              <button
                key={m.userId}
                className={`${s.member} ${s.memberOffline} ${isRevealing ? 'revealing' : ''}`}
                style={revealStyle(offlineStart + i)}
                onClick={e => onMemberOpenProfile?.(m, e)}
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
    switch (displayMode) {
      case 'pinned': return t('memberPanel.pinnedMessages')
      case 'threads': return t('memberPanel.threads')
      case 'members': return t('memberPanel.members', { count: total })
      default: return ''
    }
  }

  // Hide the outer header in single-thread view — ThreadPanel renders its own
  // header (with back button + thread name) so we'd otherwise stack two bars.
  const hideOuterHeader = displayMode === 'threads' && !!openThreadId

  return (
    <aside className={`${s.panel} ${!visible ? s.hidden : ''}`}>
      {!hideOuterHeader && (
        <div className={s.header}>
          {onMobileClose && (
            <button className={s.backBtn} title={t('memberPanel.backToChat')} aria-label={t('memberPanel.backToChat')} onClick={onMobileClose}>
              <ArrowLeft size={14} strokeWidth={1.5} />
            </button>
          )}
          <span className={`${s.title} txt-tiny txt-semibold`}>
            {getHeaderTitle()}
          </span>
        </div>
      )}
      {renderContent()}
    </aside>
  )
}

