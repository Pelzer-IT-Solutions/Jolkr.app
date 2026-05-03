/**
 * Scrollable message list with empty state, date separators, and the
 * staggered reveal animation that runs after a channel/DM switch.
 *
 * Owns:
 *   - the scroll container ref + smooth-scroll-on-new-message tracking;
 *   - the reveal animation flag (driven by `animationKey` from the parent);
 *   - infinite-load wiring (calls `onLoadOlder` from context near scroll
 *     bottom).
 *
 * All message action handlers (toggle reaction, delete, edit, reply, pin,
 * thread open/start, hide-for-me, profile open) come from
 * ChatActionsContext and are forwarded to `<Message>` per-row.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChannelDisplay, DMConversation, MessageVM } from '../../types'
import type { User } from '../../api/types'
import { revealDelay, revealWindowMs, CHAT_REVEAL_LIMIT } from '../../utils/animations'
import { formatDayLabel, dayKey } from '../../utils/dateFormat'
import { Message } from '../Message/Message'
import { useChatActions, useChatPermissions } from './chatContexts'
import s from './ChatArea.module.css'

interface Props {
  channel:         ChannelDisplay
  messages:        MessageVM[]
  animationKey:    string
  dmConversation?: DMConversation
  serverId?:       string
  userMap?:        Map<string, User>
}

export function MessageList({
  channel, messages, animationKey, dmConversation, serverId, userMap,
}: Props) {
  const { isDm, isReadOnly, canManageMessages, canAddReactions, hasMore } = useChatPermissions()
  const {
    onToggleReaction, onDeleteMessage, onHideMessage, onEditMessage,
    onReply, onPinMessage, onOpenAuthorProfile, onOpenThread, onStartThread,
    onLoadOlder,
  } = useChatActions()

  const listRef = useRef<HTMLDivElement>(null)
  const prevMsgCountRef = useRef(0)
  const scrollBehaviorRef = useRef<ScrollBehavior>('auto')

  const [isRevealing, setIsRevealing] = useState(false)
  // Flip the reveal animation on synchronously when navigating to a new
  // channel/DM. Detecting the change in render keeps a single coherent
  // render cycle instead of an effect-driven double-render flicker.
  const [prevAnimKey, setPrevAnimKey] = useState(animationKey)
  if (prevAnimKey !== animationKey) {
    setPrevAnimKey(animationKey)
    setIsRevealing(true)
  }

  // Clear the reveal flag after the animation window expires. Re-runs only
  // when isRevealing flips to true; the cleanup cancels the timer if a
  // second navigation lands before the first finishes.
  useEffect(() => {
    if (!isRevealing) return
    const animCount = Math.min(messages.length, CHAT_REVEAL_LIMIT)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(animCount))
    return () => clearTimeout(timer)
  }, [isRevealing, messages.length])

  // Scroll to top on channel/DM navigation.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [animationKey])

  // Track message count to flag a smooth-scroll on the next paint when new
  // messages arrive (vs. initial load).
  useLayoutEffect(() => {
    const prevMsgCount = prevMsgCountRef.current
    prevMsgCountRef.current = messages.length
    if (messages.length > prevMsgCount) {
      scrollBehaviorRef.current = 'smooth'
    }
  }, [messages])

  useEffect(() => {
    if (!listRef.current || scrollBehaviorRef.current !== 'smooth') return
    listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    scrollBehaviorRef.current = 'auto'
  }, [messages])

  function handleScroll() {
    if (!listRef.current || !hasMore || !onLoadOlder) return
    const el = listRef.current
    if (el.scrollHeight + el.scrollTop - el.clientHeight < 100) onLoadOlder()
  }

  return (
    <div className={`${s.messageList} scrollbar-thin scroll-view-y-chat`} ref={listRef} onScroll={handleScroll}>
      {messages.length === 0 ? (
        <div className={s.chatEmpty}>
          <div className={s.chatEmptyIcon}>{isDm ? '💬' : '👋'}</div>
          <h2 className={`${s.chatEmptyTitle} txt-body txt-semibold`}>
            {isDm
              ? `No messages yet with ${dmConversation?.name ?? dmConversation?.participants[0]?.name ?? 'this user'}`
              : `Welcome to #${channel.name}`}
          </h2>
          <p className={`${s.chatEmptyText} txt-small`}>
            {isDm
              ? 'Send a message below to start the conversation.'
              : 'Be the first to say something — type a message below to get the channel going.'}
          </p>
        </div>
      ) : null}
      <div className={`${s.messageInner} ${isDm ? s.messageInnerDm : ''}`}>
        {messages.map((msg, i) => {
          const fromBottom   = messages.length - 1 - i
          const shouldReveal = isRevealing && fromBottom < CHAT_REVEAL_LIMIT
          const prevDay = i > 0 ? dayKey(messages[i - 1].created_at) : ''
          const thisDay = dayKey(msg.created_at)
          // Insert a separator at the very first message and whenever the
          // day changes between consecutive messages.
          const showSeparator = thisDay !== '' && thisDay !== prevDay
          return (
            <div key={msg.id}>
              {showSeparator && (
                <div className={s.dateSeparator}>
                  <div className={s.sepLine} />
                  <span className={`${s.sepLabel} txt-tiny txt-semibold`}>
                    {formatDayLabel(msg.created_at)}
                  </span>
                  <div className={s.sepLine} />
                </div>
              )}
              <div
                className={shouldReveal ? 'revealing' : undefined}
                style={shouldReveal
                  ? { '--reveal-delay': `${revealDelay(fromBottom)}ms` } as React.CSSProperties
                  : undefined
                }
              >
                <Message
                  message={msg}
                  onToggleReaction={isReadOnly || channel.is_system || !canAddReactions ? undefined : (emoji) => onToggleReaction(msg.id, emoji)}
                  onDelete={() => onDeleteMessage(msg.id)}
                  onHideForMe={isDm && onHideMessage ? () => onHideMessage(msg.id) : undefined}
                  onEdit={isReadOnly || channel.is_system ? undefined : (newText) => onEditMessage(msg.id, newText)}
                  onReply={isReadOnly ? undefined : () => onReply(msg)}
                  onPin={() => onPinMessage?.(msg.id)}
                  onOpenAuthorProfile={onOpenAuthorProfile}
                  isDm={isDm}
                  isGroupDm={isDm && (dmConversation?.participants.length ?? 0) > 2}
                  serverId={isDm ? undefined : serverId}
                  userMap={userMap}
                  dmParticipantNames={isDm && dmConversation
                    ? Object.fromEntries(dmConversation.participants.map(p => [p.userId ?? p.name, p.name]))
                    : undefined}
                  canManageMessages={canManageMessages}
                  canAddReactions={canAddReactions}
                  onOpenThread={!isDm && onOpenThread ? onOpenThread : undefined}
                  onStartThread={!isDm && onStartThread ? onStartThread : undefined}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className={s.spacer} />
    </div>
  )
}
