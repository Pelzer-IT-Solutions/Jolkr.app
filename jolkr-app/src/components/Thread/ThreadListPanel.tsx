import { useEffect, useState } from 'react'
import * as api from '../../api/client'
import { useT } from '../../hooks/useT'
import { useThreadsStore } from '../../stores/threads'
import s from './ThreadListPanel.module.css'
import type { Thread } from '../../api/types'

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
 *     in the threads store — see stores/messages.ts WS handler).
 */
export function ThreadListPanel({ channelId, onOpenThread }: Props) {
  const { t, tn } = useT()
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const threadListVersion = useThreadsStore(s => s.threadListVersion)

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
    return <div className={`${s.loading} txt-small`}>{t('thread.list.loading')}</div>
  }

  if (threads.length === 0) {
    return <div className={`${s.empty} txt-small`}>{t('thread.list.empty')}</div>
  }

  return (
    <ul className={s.list}>
      {threads.map(thr => (
        <li key={thr.id}>
          <button
            type="button"
            className={s.item}
            onClick={() => onOpenThread(thr)}
          >
            <span className={`${s.name} txt-small txt-semibold txt-truncate`} dir="auto">
              {thr.name ?? t('thread.list.untitled')}
            </span>
            <span className={`${s.meta} txt-tiny`}>
              {tn('thread.list.replies', thr.message_count)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
