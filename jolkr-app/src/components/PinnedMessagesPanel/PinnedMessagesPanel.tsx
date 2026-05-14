import { X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useT } from '../../hooks/useT'
import { loadPinnedMessages, peekPinnedMessages, setPinnedMessagesCache } from '../../services/pinnedCache'
import s from './PinnedMessagesPanel.module.css'
import type { User } from '../../api/types'
import type { Message } from '../../api/types'

interface Props {
  channelId: string
  isDm?: boolean
  onClose: () => void
  onUnpin?: (messageId: string) => void
  /** Click on a pinned-message row → jump the chat list to that message. */
  onJumpToMessage?: (messageId: string) => void
  users?: Map<string, User>
  pinnedVersion?: number
}

/** Single pinned message item — uses hook for E2EE decryption. */
function PinnedItem({ msg, channelId, isDm, onUnpin, onJumpToMessage, users }: {
  msg: Message
  channelId: string
  isDm: boolean
  onUnpin?: (id: string) => void
  onJumpToMessage?: (id: string) => void
  users?: Map<string, User>
}) {
  const { t } = useT()
  const { displayContent, decrypting } = useDecryptedContent(
    msg.content, msg.nonce, isDm, channelId,
  )
  const author = users?.get(msg.author_id)
  const authorName = author?.display_name ?? author?.username ?? t('pinned.unknownAuthor')
  const clickable = !!onJumpToMessage

  return (
    <div
      className={`${s.item} ${clickable ? s.itemClickable : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onJumpToMessage(msg.id) : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJumpToMessage(msg.id) }
      } : undefined}
    >
      <div className={`${s.itemAuthor} txt-tiny txt-semibold`}>{authorName}</div>
      <div className={`${s.itemContent} txt-small`} dir="auto">
        {decrypting ? t('pinned.decrypting') : (displayContent || '').slice(0, 200)}
      </div>
      {onUnpin && (
        <button
          className={s.unpinBtn}
          title={t('pinned.unpin')}
          aria-label={t('pinned.unpin')}
          onClick={(e) => { e.stopPropagation(); onUnpin(msg.id) }}
        >
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

export function PinnedMessagesPanel({ channelId, isDm = false, onClose: _onClose, onUnpin, onJumpToMessage, users, pinnedVersion }: Props) {
  const { t } = useT()
  const version = pinnedVersion ?? 0
  const cached = peekPinnedMessages(channelId, isDm, version)
  const [messages, setMessages] = useState<Message[]>(cached ?? [])
  // No "Loading..." if we already have data for this key — show stale data
  // immediately and revalidate in the background.
  const [loading, setLoading] = useState(cached === undefined)

  // Sync messages/loading from the cache when the panel's identity changes —
  // state-during-render avoids set-state-in-effect on the synchronous reset path.
  // Stale-while-revalidate: a `pinnedVersion` bump invalidates the cache key,
  // but we keep showing the previous list rather than flashing "Loading..." —
  // the effect below silently fetches the new state and swaps it in.
  const identityKey = `${isDm ? 'dm' : 'ch'}:${channelId}:${version}`
  const [prevKey, setPrevKey] = useState(identityKey)
  if (identityKey !== prevKey) {
    setPrevKey(identityKey)
    const cachedNow = peekPinnedMessages(channelId, isDm, version)
    if (cachedNow !== undefined) {
      setMessages(cachedNow)
      setLoading(false)
    } else if (messages.length === 0) {
      // No previous data to show — only then flip the loading flag.
      setLoading(true)
    }
  }

  useEffect(() => {
    if (peekPinnedMessages(channelId, isDm, version) !== undefined) return
    let cancelled = false
    loadPinnedMessages(channelId, isDm, version)
      .then(msgs => {
        if (cancelled) return
        setMessages(msgs)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [channelId, isDm, version])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setMessages(prev => {
      const next = prev.filter(m => m.id !== msgId)
      setPinnedMessagesCache(channelId, isDm, version, next)
      return next
    })
  }

  return (
    <div className={s.panel}>
      <div className={`${s.list} scrollbar-thin scroll-view-y`}>
        {loading && <div className={`${s.empty} txt-small`}>{t('pinned.loading')}</div>}
        {!loading && messages.length === 0 && (
          <div className={`${s.empty} txt-small`}>{t('pinned.empty')}</div>
        )}
        {messages.map(msg => (
          <PinnedItem
            key={msg.id}
            msg={msg}
            channelId={channelId}
            isDm={isDm}
            onUnpin={onUnpin ? handleUnpin : undefined}
            onJumpToMessage={onJumpToMessage}
            users={users}
          />
        ))}
      </div>
    </div>
  )
}
