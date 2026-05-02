import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Hash, KeyRound, AlertCircle } from 'lucide-react'
import s from './JoinServerModal.module.css'

interface Props {
  onClose:  () => void
  onJoin:   (serverId: string, accessCode: string) => boolean | Promise<boolean>
}

export function JoinServerModal({ onClose, onJoin }: Props) {
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
    if (!id) { setError('Please enter a server ID.'); return }
    const ok = onJoin(id, accessCode.trim())
    if (!ok) setError('Server not found. Check the ID and try again.')
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal}>
        <div className={s.header}>
          <span className={s.title}>Join a Server</span>
          <button className={s.closeBtn} onClick={onClose} type="button">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.desc}>
          <p className="txt-small">Enter an invite ID to join an existing server. Ask the server owner for an access code if the server is private.</p>
        </div>

        <form className={s.body} onSubmit={handleSubmit}>
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>Server ID <span className={s.required}>*</span></label>
            <div className={`${s.inputWrap} ${error ? s.inputError : ''}`}>
              <Hash size={13} strokeWidth={1.5} className={s.inputIcon} />
              <input
                ref={inputRef}
                className={`${s.input} txt-small`}
                placeholder="e.g. pixel-workshop"
                value={serverId}
                onChange={e => { setServerId(e.target.value); setError('') }}
              />
            </div>
          </div>

          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              Access Code <span className={s.optional}>Optional</span>
            </label>
            <div className={s.inputWrap}>
              <KeyRound size={13} strokeWidth={1.5} className={s.inputIcon} />
              <input
                className={`${s.input} txt-small`}
                placeholder="Leave blank for public servers"
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
            <button type="button" className={`${s.cancelBtn} txt-small`} onClick={onClose}>Cancel</button>
            <button type="submit" className={`${s.submitBtn} txt-small`} disabled={!serverId.trim()}>
              Join Server
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
