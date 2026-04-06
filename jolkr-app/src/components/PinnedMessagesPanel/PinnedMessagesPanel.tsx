import { useState, useEffect } from 'react'
import { Pin, X } from 'lucide-react'
import * as api from '../../api/client'
import type { Message } from '../../api/types'
import s from './PinnedMessagesPanel.module.css'

interface Props {
  channelId: string
  isDm?: boolean
  onClose: () => void
  onUnpin?: (messageId: string) => void
}

export function PinnedMessagesPanel({ channelId, isDm = false, onClose, onUnpin }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const fetch = isDm ? api.getDmPinnedMessages(channelId) : api.getPinnedMessages(channelId)
    fetch.then(msgs => {
      // Map encrypted_content → content (backend sends them as separate fields)
      setMessages(msgs.map(m => {
        const raw = m as unknown as Record<string, unknown>;
        const enc = raw.encrypted_content as string | undefined;
        return enc ? { ...m, content: enc } : m;
      }))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [channelId, isDm])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setMessages(prev => prev.filter(m => m.id !== msgId))
  }

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <Pin size={14} strokeWidth={1.5} />
        <span className="txt-body txt-semibold">Pinned Messages</span>
        <button className={s.closeBtn} onClick={onClose}><X size={14} strokeWidth={1.5} /></button>
      </div>
      <div className={`${s.list} scrollbar-thin scroll-view-y`}>
        {loading && <div className={`${s.empty} txt-small`}>Loading...</div>}
        {!loading && messages.length === 0 && (
          <div className={`${s.empty} txt-small`}>No pinned messages</div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={s.item}>
            <div className={`${s.itemAuthor} txt-tiny txt-semibold`}>
              {(msg.author as { display_name?: string; username?: string })?.display_name
                ?? (msg.author as { username?: string })?.username ?? 'Unknown'}
            </div>
            <div className={`${s.itemContent} txt-small`}>
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
    </div>
  )
}
