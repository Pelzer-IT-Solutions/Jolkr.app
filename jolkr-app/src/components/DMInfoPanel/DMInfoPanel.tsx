import { useState, useEffect } from 'react'
import { X, ArrowLeft } from 'lucide-react'
import * as api from '../../api/client'
import type { Message, User } from '../../api/types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useRevealAnimation } from '../../hooks/useRevealAnimation'
import s from './DMInfoPanel.module.css'

interface Props {
  open: boolean
  dmId: string
  onUnpin?: (messageId: string) => void
  users?: Map<string, User>
  pinnedVersion?: number
  onMobileClose?: () => void
}

function PinnedItem({ msg, dmId, onUnpin, users }: {
  msg: Message; dmId: string; onUnpin?: (id: string) => void; users?: Map<string, User>
}) {
  const { displayContent, decrypting } = useDecryptedContent(msg.content, msg.nonce, true, dmId)
  const author = users?.get(msg.author_id)
  const authorName = author?.display_name ?? author?.username ?? 'Unknown'

  return (
    <div className={s.pinnedItem}>
      <div className={s.pinnedAuthor}>{authorName}</div>
      <div className={s.pinnedContent}>
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

export function DMInfoPanel({ open, dmId, onUnpin, users, pinnedVersion, onMobileClose }: Props) {
  const isRevealing = useRevealAnimation(0, [open], open, 300)
  const [pinned, setPinned] = useState<Message[]>([])
  const [loadingPins, setLoadingPins] = useState(false)

  // Fetch pinned messages when panel becomes open or dmId changes
  useEffect(() => {
    if (!open || !dmId) return
    setLoadingPins(true)
    api.getDmPinnedMessages(dmId).then(msgs => {
      const normalized = msgs.map(m => ({
        ...m,
        channel_id: m.channel_id ?? (m as unknown as { dm_channel_id?: string }).dm_channel_id ?? dmId,
      }))
      setPinned(normalized)
    }).catch(() => setPinned([])).finally(() => setLoadingPins(false))
  }, [open, dmId, pinnedVersion])

  function handleUnpin(msgId: string) {
    onUnpin?.(msgId)
    setPinned(prev => prev.filter(m => m.id !== msgId))
  }

  return (
    <aside className={`${s.panel} ${!open ? s.hidden : ''}`}>
      <div className={s.header}>
        {onMobileClose && (
          <button className={s.backBtn} title="Back to chat" onClick={onMobileClose}>
            <ArrowLeft size={14} strokeWidth={1.5} />
          </button>
        )}
        <span className={`${s.title} txt-tiny txt-semibold`}>Info</span>
      </div>

      <div className={`${s.scroll} scrollbar-thin`}>
        <div className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}>
          Pinned Messages
        </div>
        {loadingPins && (
          <div className={`txt-tiny`} style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>Loading...</div>
        )}
        {!loadingPins && pinned.length === 0 && (
          <div className={`txt-tiny ${s.emptyHint}`} style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>
            No pinned messages yet
          </div>
        )}
        {pinned.map(msg => (
          <PinnedItem key={msg.id} msg={msg} dmId={dmId} onUnpin={onUnpin ? handleUnpin : undefined} users={users} />
        ))}

        <div className={`${s.sectionTitle} txt-tiny txt-semibold ${isRevealing ? 'revealing' : ''}`}>
          Shared Files
        </div>
        <div className={`txt-tiny`} style={{ padding: '0.5rem 1rem', color: 'var(--text-muted)' }}>
          No shared files yet
        </div>
      </div>
    </aside>
  )
}
