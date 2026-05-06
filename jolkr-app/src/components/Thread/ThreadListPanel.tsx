import { useEffect, useState } from 'react'
import * as api from '../../api/client'
import type { Thread } from '../../api/types'
import { useMessagesStore } from '../../stores/messages'
import s from './ThreadListPanel.module.css'

interface Props {
  channelId: string
  onOpenThread: (thread: Thread) => void
}

/**
 * Lists active threads in the current channel.
 *
 * Re-fetches when:
 *   - the channel changes (different channelId)
 *   - any ThreadCreate / ThreadUpdate WS event lands (bumps `threadListVersion`
 *     in the messages store — see stores/messages.ts WS handler).
 */
export function ThreadListPanel({ channelId, onOpenThread }: Props) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const threadListVersion = useMessagesStore(s => s.threadListVersion)

  // Flip to loading whenever the fetch key changes — state-during-render
  // pattern avoids set-state-in-effect on the synchronous setLoading.
  const fetchKey = `${channelId}|${threadListVersion}`
  const [prevFetchKey, setPrevFetchKey] = useState(fetchKey)
  if (fetchKey !== prevFetchKey) {
    setPrevFetchKey(fetchKey)
    if (channelId) setLoading(true)
  }

  useEffect(() => {
    if (!channelId) return
    let cancelled = false
    api.getThreads(channelId, false)
      .then(list => {
        if (cancelled) return
        // Backend may include archived even when include_archived=false in some
        // older builds — filter defensively.
        setThreads(list.filter(t => !t.is_archived))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setThreads([])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [channelId, threadListVersion])

  if (loading) {
    return <div className={`${s.loading} txt-small`}>Loading threads...</div>
  }

  if (threads.length === 0) {
    return <div className={`${s.empty} txt-small`}>No threads yet</div>
  }

  return (
    <ul className={s.list}>
      {threads.map(t => (
        <li key={t.id}>
          <button
            type="button"
            className={s.item}
            onClick={() => onOpenThread(t)}
          >
            <span className={`${s.name} txt-small txt-semibold txt-truncate`}>
              {t.name ?? 'Untitled thread'}
            </span>
            <span className={`${s.meta} txt-tiny`}>
              {t.message_count} {t.message_count === 1 ? 'reply' : 'replies'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
