import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { useT } from '../../hooks/useT'
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
  const { t } = useT()
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

  const everyoneLabel = isGroup ? t('deleteMessageDialog.deleteForEveryone') : t('deleteMessageDialog.deleteForBoth')

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick} role="dialog" aria-modal="true">
      <div className={s.modal}>
        <span className={s.title}>{t('deleteMessageDialog.title')}</span>
        <p className={`${s.body} txt-small`}>
          {isOwn ? t('deleteMessageDialog.bodyOwner') : t('deleteMessageDialog.bodyNonOwner')}
        </p>

        <div className={s.actions}>
          {isOwn && onDeleteForEveryone && (
            <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => { onDeleteForEveryone(); onClose() }}>
              {everyoneLabel}
            </button>
          )}
          <button type="button" className={`${s.btn} ${isOwn ? '' : s.btnDanger}`} onClick={() => { onDeleteForMe(); onClose() }}>
            {t('deleteMessageDialog.deleteForMe')}
          </button>
          <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onClose}>
            {t('deleteMessageDialog.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
