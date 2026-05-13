import { X } from 'lucide-react'
import { useState, useEffect } from 'react'
import * as api from '../../api/client'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useT } from '../../hooks/useT'
import { createTtlCache } from '../../utils/cache'
import s from './PinnedMessagesPanel.module.css'
import type { User } from '../../api/types'
import type { Message } from '../../api/types'

// Module-level cache so toggling the panel off and back on doesn't trigger a
// "Loading..." flash. Keyed by `${isDm ? 'dm' : 'ch'}:${channelId}:${pinnedVersion}`
// so a `pinnedVersion` bump (pin/unpin event) invalidates the cached entry.
// TTL + bounded size stop the unbounded growth: every pin/unpin used to mint
// a fresh key whose stale predecessors stayed forever until tab close.
const cache = createTtlCache<string, Message[]>({ ttl: 60_000, maxEntries: 30 })
function cacheKey(channelId: string, isDm: boolean, version: number): string {
  return `${isDm ? 'dm' : 'ch'}:${channelId}:${version}`
}

interface Props {
  channelId: string
  isDm?: boolean
  onClose: () => void
  onUnpin?: (messageId: string) => void
  users?: Map<string, User>
  pinnedVersion?: number
}

/** Single pinned message item — uses hook for E2EE decryption. */
function PinnedItem({ msg, channelId, isDm, onUnpin, users }: {
  msg: Message
  channelId: string
  isDm: boolean
  onUnpin?: (id: string) => void
  users?: Map<string, User>
}) {
  const { t } = useT()
  const { displayContent, decrypting } = useDecryptedContent(
    msg.content, msg.nonce, isDm, channelId,
  )
  const author = users?.get(msg.author_id)
  const authorName = author?.display_name ?? author?.username ?? t('pinned.unknownAuthor')

  return (
    <div className={s.item}>
      <div className={`${s.itemAuthor} txt-tiny txt-semibold`}>{authorName}</div>
      <div className={`${s.itemContent} txt-small`} dir="auto">
        {decrypting ? t('pinned.decrypting') : (displayContent || '').slice(0, 200)}
      </div>
      {onUnpin && (
        <button className={s.unpinBtn} title={t('pinned.unpin')} aria-label={t('pinned.unpin')} onClick={() => onUnpin(msg.id)}>
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

export function PinnedMessagesPanel({ channelId, isDm = false, onClose: _onClose, onUnpin, users, pinnedVersion }: Props) {
  const { t } = useT()
  const key = cacheKey(channelId, isDm, pinnedVersion ?? 0)
  const cached = cache.get(key)
  const [messages, setMessages] = useState<Message[]>(cached ?? [])
  // No "Loading..." if we already have data for this key — show stale data
  // immediately and revalidate in the background.
  const [loading, setLoading] = useState(cached === undefined)

  // Sync messages/loading from the cache when the panel's identity changes —
  // state-during-render avoids set-state-in-effect on the synchronous reset path.
  // Stale-while-revalidate: a `pinnedVersion` bump invalidates the cache key,
  // but we keep showing the previous list rather than flashing "Loading..." —
  // the effect below silently fetches the new state and swaps it in.
  const [prevKey, setPrevKey] = useState(key)
  if (key !== prevKey) {
    setPrevKey(key)
    const cachedNow = cache.get(key)
    if (cachedNow !== undefined) {
      setMessages(cachedNow)
      setLoading(false)
    } else if (messages.length === 0) {
      // No previous data to show — only then flip the loading flag.
      setLoading(true)
    }
  }

  useEffect(() => {
    const k = cacheKey(channelId, isDm, pinnedVersion ?? 0)
    if (cache.get(k) !== undefined) return // already populated synchronously above
    const fetchPromise = isDm ? api.getDmPinnedMessages(channelId) : api.getPinnedMessages(channelId)
    fetchPromise.then(msgs => {
      cache.set(k, msgs)
      setMessages(msgs)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [channelId, isDm, pinnedVersion])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setMessages(prev => {
      const next = prev.filter(m => m.id !== msgId)
      cache.set(cacheKey(channelId, isDm, pinnedVersion ?? 0), next)
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
            users={users}
          />
        ))}
      </div>
    </div>
  )
}
