import { Loader2, AlertCircle } from 'lucide-react'
import { useUploadProgressStore } from '../../stores/uploadProgress'
import { formatBytes } from '../../utils/format'
import s from './MessageUploadProgress.module.css'

interface Props {
  messageId: string
}

/** Renders a row per file currently uploading on this message. The store is
 *  populated by `useAppHandlers` while `xhr.upload.onprogress` ticks. Once
 *  the upload completes the row clears and the real attachment arrives via
 *  the WS `MessageUpdate` event into `message.attachments`. */
export function MessageUploadProgress({ messageId }: Props) {
  const pending = useUploadProgressStore((s) => s.byMessageId[messageId])
  if (!pending || pending.length === 0) return null

  return (
    <div className={s.list}>
      {pending.map((u) => {
        const pct = u.size > 0 ? Math.min(100, Math.round((u.loaded / u.size) * 100)) : 0
        const failed = !!u.error
        return (
          <div key={u.fileName} className={`${s.row} ${failed ? s.rowError : ''}`}>
            <div className={s.iconWrap}>
              {failed
                ? <AlertCircle size={16} className={s.iconError} />
                : <Loader2 size={16} className={s.iconSpin} />}
            </div>
            <div className={s.body}>
              <div className={s.headLine}>
                <span className={s.name} title={u.fileName}>{u.fileName}</span>
                <span className={s.meta}>
                  {failed
                    ? u.error
                    : `${formatBytes(u.loaded)} / ${formatBytes(u.size)} · ${pct}%`}
                </span>
              </div>
              {!failed && (
                <div className={s.barTrack}>
                  <div className={s.barFill} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
