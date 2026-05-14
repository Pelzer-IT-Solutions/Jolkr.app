import { useEffect } from 'react'
import { useT } from '../../hooks/useT'
import { useThreadsStore } from '../../stores/threads'
import s from './ThreadListPanel.module.css'
import type { Thread } from '../../api/types'

interface Props {
  channelId: string
  onOpenThread: (thread: Thread) => void
}

const EMPTY_THREADS: Thread[] = []

/**
 * Lists active threads in the current channel.
 *
 * The thread list lives in `useThreadsStore.threadList[channelId]`. We
 * call `fetchThreadList` whenever the channel changes or any
 * ThreadCreate/Update WS event bumps `threadListVersion` — the same fetch
 * also powers the thread-count badge in useAppInit so we hit the wire once.
 */
export function ThreadListPanel({ channelId, onOpenThread }: Props) {
  const { t, tn } = useT()
  const threads = useThreadsStore(s => s.threadList[channelId] ?? EMPTY_THREADS)
  const threadListVersion = useThreadsStore(s => s.threadListVersion)
  const fetchThreadList = useThreadsStore(s => s.fetchThreadList)
  const cached = useThreadsStore(s => s.threadList[channelId])
  const loading = cached === undefined

  useEffect(() => {
    if (!channelId) return
    fetchThreadList(channelId)
  }, [channelId, threadListVersion, fetchThreadList])

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
