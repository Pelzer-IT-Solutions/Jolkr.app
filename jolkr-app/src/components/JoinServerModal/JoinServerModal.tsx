import { X, Hash, KeyRound, AlertCircle } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import s from './JoinServerModal.module.css'

interface Props {
  onClose:  () => void
  onJoin:   (serverId: string, accessCode: string) => boolean | Promise<boolean>
}

export function JoinServerModal({ onClose, onJoin }: Props) {
  const { t } = useT()
  const [serverId,    setServerId]    = useState('')
  const [accessCode,  setAccessCode]  = useState('')
  const [error,       setError]       = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const id = serverId.trim()
    if (!id) { setError(t('joinServerModal.errorEmpty')); return }
    const ok = onJoin(id, accessCode.trim())
    if (!ok) setError(t('joinServerModal.errorNotFound'))
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal}>
        <div className={s.header}>
          <span className={s.title}>{t('joinServerModal.title')}</span>
          <button className={s.closeBtn} onClick={onClose} type="button">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.desc}>
          <p className="txt-small">{t('joinServerModal.description')}</p>
        </div>

        <form className={s.body} onSubmit={handleSubmit}>
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>{t('joinServerModal.serverIdLabel')} <span className={s.required}>{t('common.required')}</span></label>
            <div className={`${s.inputWrap} ${error ? s.inputError : ''}`}>
              <Hash size={13} strokeWidth={1.5} className={s.inputIcon} />
              <input
                ref={inputRef}
                className={`${s.input} txt-small`}
                placeholder={t('joinServerModal.serverIdPlaceholder')}
                value={serverId}
                onChange={e => { setServerId(e.target.value); setError('') }}
              />
            </div>
          </div>

          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              {t('joinServerModal.accessCodeLabel')} <span className={s.optional}>Optional</span>
            </label>
            <div className={s.inputWrap}>
              <KeyRound size={13} strokeWidth={1.5} className={s.inputIcon} />
              <input
                className={`${s.input} txt-small`}
                placeholder={t('joinServerModal.accessCodePlaceholder')}
                value={accessCode}
                onChange={e => setAccessCode(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className={s.errorRow}>
              <AlertCircle size={13} strokeWidth={1.5} />
              <span className="txt-tiny">{error}</span>
            </div>
          )}

          <div className={s.footer}>
            <button type="button" className={`${s.cancelBtn} txt-small`} onClick={onClose}>{t('joinServerModal.cancel')}</button>
            <button type="submit" className={`${s.submitBtn} txt-small`} disabled={!serverId.trim()}>
              {t('joinServerModal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
