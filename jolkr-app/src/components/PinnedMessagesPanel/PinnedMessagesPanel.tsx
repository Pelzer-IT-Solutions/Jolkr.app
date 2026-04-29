import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import * as api from '../../api/client'
import type { Message } from '../../api/types'
import type { User } from '../../api/types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import s from './PinnedMessagesPanel.module.css'

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
  const { displayContent, decrypting } = useDecryptedContent(
    msg.content, msg.nonce, isDm, channelId,
  )
  const author = users?.get(msg.author_id)
  const authorName = author?.display_name ?? author?.username ?? 'Unknown'

  return (
    <div className={s.item}>
      <div className={`${s.itemAuthor} txt-tiny txt-semibold`}>{authorName}</div>
      <div className={`${s.itemContent} txt-small`}>
        {decrypting ? 'Decrypting...' : (displayContent || '').slice(0, 200)}
      </div>
      {onUnpin && (
        <button className={s.unpinBtn} title="Unpin" onClick={() => onUnpin(msg.id)}>
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

export function PinnedMessagesPanel({ channelId, isDm = false, onClose: _onClose, onUnpin, users, pinnedVersion }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const fetch = isDm ? api.getDmPinnedMessages(channelId) : api.getPinnedMessages(channelId)
    fetch.then(msgs => {
      // Normalize DM messages: dm_channel_id → channel_id
      const normalized = msgs.map((m) => ({
        ...m,
        channel_id: m.channel_id ?? (m as unknown as { dm_channel_id?: string }).dm_channel_id ?? channelId,
      }))
      setMessages(normalized)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [channelId, isDm, pinnedVersion])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setMessages(prev => prev.filter(m => m.id !== msgId))
  }

  return (
    <div className={s.panel}>
      <div className={`${s.list} scrollbar-thin scroll-view-y`}>
        {loading && <div className={`${s.empty} txt-small`}>Loading...</div>}
        {!loading && messages.length === 0 && (
          <div className={`${s.empty} txt-small`}>No pinned messages</div>
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
