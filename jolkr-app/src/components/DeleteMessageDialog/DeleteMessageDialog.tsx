import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import s from './DeleteMessageDialog.module.css'

interface Props {
  /** Whether the viewer authored the message — gates the "for everyone" option. */
  isOwn: boolean
  /** True when the DM channel has more than 2 members (UX wording only). */
  isGroup?: boolean
  onClose: () => void
  /** Hard-delete on the server, visible to everyone. Only meaningful when `isOwn`. */
  onDeleteForEveryone?: () => void
  /** Soft-hide for the calling user only. Always available. */
  onDeleteForMe: () => void
}

export function DeleteMessageDialog({ isOwn, isGroup = false, onClose, onDeleteForEveryone, onDeleteForMe }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  const everyoneLabel = isGroup ? 'Delete for everyone' : 'Delete for both of us'

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className={s.modal}>
        <span className={s.title}>Delete message?</span>
        <p className={`${s.body} txt-small`}>
          {isOwn
            ? 'This message will be removed. Choose whether to remove it just for you, or for everyone.'
            : 'This will only hide the message on your side. Other members will still see it.'}
        </p>

        <div className={s.actions}>
          {isOwn && onDeleteForEveryone && (
            <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => { onDeleteForEveryone(); onClose() }}>
              {everyoneLabel}
            </button>
          )}
          <button type="button" className={`${s.btn} ${isOwn ? '' : s.btnDanger}`} onClick={() => { onDeleteForMe(); onClose() }}>
            Delete for me
          </button>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
