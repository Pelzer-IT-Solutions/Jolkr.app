import { useEffect, useState, useRef, useCallback } from 'react'
import { ArrowLeft, SendHorizontal } from 'lucide-react'
import * as api from '../../api/client'
import type { Thread, Message, User } from '../../api/types'
import { useMessagesStore } from '../../stores/messages'
import { useServersStore } from '../../stores/servers'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { encryptChannelMessage } from '../../crypto/channelKeys'
import { getLocalKeys } from '../../services/e2ee'
import { displayName } from '../../utils/format'
import s from './ThreadPanel.module.css'

interface Props {
  threadId: string
  channelId: string
  serverId?: string
  users?: Map<string, User>
  onBack: () => void
}

/** One thread message row — uses the shared decrypt hook. */
function ThreadMessage({ msg, channelId, users }: {
  msg: Message
  channelId: string
  users?: Map<string, User>
}) {
  const { displayContent, decrypting } = useDecryptedContent(
    msg.content, msg.nonce, false, channelId,
  )
  const author = users?.get(msg.author_id) ?? msg.author ?? null
  const authorName = author ? displayName(author) : 'Unknown'
  const time = new Date(msg.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  return (
    <div className={s.msg}>
      <div className={s.msgHead}>
        <span className={`${s.msgAuthor} txt-small txt-semibold`}>{authorName}</span>
        <span className={`${s.msgTime} txt-tiny`}>{time}</span>
      </div>
      <div className={`${s.msgBody} txt-small`}>
        {decrypting ? '...' : (displayContent || '')}
      </div>
    </div>
  )
}

/**
 * Single-thread chat view. Loads + renders thread messages from the messages
 * store, and provides a small composer that re-uses the channel-level E2EE
 * encryption pipeline (the thread shares its parent channel's key).
 */
export function ThreadPanel({ threadId, channelId, serverId, users, onBack }: Props) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const messages = useMessagesStore(s => s.threadMessages[threadId] ?? [])
  const loading = useMessagesStore(s => s.threadLoading[threadId] ?? false)
  const fetchThreadMessages = useMessagesStore(s => s.fetchThreadMessages)
  const membersByServer = useServersStore(s => s.members)

  // Fetch thread metadata + messages on mount / threadId change
  useEffect(() => {
    if (!threadId) return
    let cancelled = false
    api.getThread(threadId).then(t => { if (!cancelled) setThread(t) }).catch(() => {})
    fetchThreadMessages(threadId).catch(() => {})
    return () => { cancelled = true }
  }, [threadId, fetchThreadMessages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages.length])

  const handleSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || sending) return
    const localKeys = getLocalKeys()
    if (!localKeys) {
      console.error('E2EE keys not available — cannot send thread reply')
      return
    }
    setSending(true)
    try {
      const getMemberIds = async (): Promise<string[]> => {
        if (!serverId) return []
        const members = membersByServer[serverId] ?? []
        return members.map(m => m.user_id)
      }
      const encrypted = await encryptChannelMessage(channelId, localKeys, text, getMemberIds, false)
      if (!encrypted) {
        console.error('E2EE encryption failed — cannot send thread reply')
        return
      }
      await api.sendThreadMessage(threadId, encrypted.encryptedContent, encrypted.nonce)
      setDraft('')
    } catch (err) {
      console.warn('Failed to send thread reply:', err)
    } finally {
      setSending(false)
    }
  }, [draft, sending, threadId, channelId, serverId, membersByServer])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <button className={s.backBtn} title="Back to threads" aria-label="Back to threads" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.5} />
        </button>
        <span className={`${s.title} txt-small txt-semibold txt-truncate`}>
          {thread?.name ?? 'Thread'}
        </span>
      </div>

      <div ref={listRef} className={`${s.list} scrollbar-thin`}>
        {loading && messages.length === 0 && (
          <div className={`${s.loading} txt-small`}>Loading...</div>
        )}
        {!loading && messages.length === 0 && (
          <div className={`${s.empty} txt-small`}>No replies yet</div>
        )}
        {messages.map(m => (
          <ThreadMessage key={m.id} msg={m} channelId={channelId} users={users} />
        ))}
      </div>

      <div className={s.composer}>
        <textarea
          className={s.input}
          placeholder="Reply in thread"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className={s.sendBtn}
          title="Send (Enter)"
          onClick={handleSend}
          disabled={!draft.trim() || sending}
        >
          <SendHorizontal size={15} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
