import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../../api/client'
import { useT } from '../../hooks/useT'
import { useToast } from '../../stores/toast'
import s from './GroupSettingsModal.module.css'
import type { DMConversation } from '../../types'

/** Mirror of BE `MAX_GROUP_NAME_LENGTH` in jolkr-core/services/dm.rs. */
const MAX_GROUP_NAME_LENGTH = 100

export interface GroupSettingsModalProps {
  open: boolean
  conv: DMConversation | null
  onClose: () => void
}

export function GroupSettingsModal({ open, conv, onClose }: GroupSettingsModalProps) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset draft state every time the modal opens for a new conversation.
  // Using state-during-render (vs `useEffect` + setState) avoids a cascading
  // re-render the moment the modal mounts. `openKey` collapses (open, id) so
  // a single comparison gates the reset.
  const openKey = open ? (conv?.id ?? '') : null
  const [prevOpenKey, setPrevOpenKey] = useState<string | null>(null)
  if (openKey !== prevOpenKey) {
    setPrevOpenKey(openKey)
    setName(openKey === null ? '' : (conv?.name ?? ''))
    setIsSaving(false)
  }

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !conv) return null

  const trimmed = name.trim()
  const currentName = conv.name ?? ''
  const isDirty = trimmed !== currentName.trim()
  const canSave = isDirty && !isSaving && trimmed.length <= MAX_GROUP_NAME_LENGTH

  async function handleSave() {
    if (!canSave || !conv) return
    setIsSaving(true)
    try {
      // BE accepts empty/null to clear; we send `null` so the API normalises
      // to "no custom name" rather than persisting an empty string.
      await api.updateDm(conv.id, { name: trimmed.length > 0 ? trimmed : null })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('groupSettingsModal.errSaveFailed')
      useToast.getState().show(msg, 'error')
      setIsSaving(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget && !isSaving) onClose()
  }

  const placeholder = conv.participants.map(p => p.name).join(', ')

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal} role="dialog" aria-labelledby="group-settings-title">
        <button
          className={s.closeBtnOverlay}
          onClick={onClose}
          aria-label={t('groupSettingsModal.cancel')}
          disabled={isSaving}
        >
          <X size={18} strokeWidth={1.5} />
        </button>

        <div className={s.header}>
          <span id="group-settings-title" className={s.title}>
            {t('groupSettingsModal.title')}
          </span>
        </div>

        <div className={s.body}>
          <label className={s.field}>
            <span className={`${s.label} txt-tiny txt-semibold`}>
              {t('groupSettingsModal.groupName')}
            </span>
            <input
              ref={inputRef}
              type="text"
              className={`${s.input} txt-small`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              maxLength={MAX_GROUP_NAME_LENGTH}
              disabled={isSaving}
              autoComplete="off"
            />
            <span className={`${s.counter} txt-tiny`} aria-live="polite">
              {trimmed.length}/{MAX_GROUP_NAME_LENGTH}
            </span>
          </label>
        </div>

        <div className={s.footer}>
          <button
            type="button"
            className={`${s.btn} ${s.btnGhost} txt-small`}
            onClick={onClose}
            disabled={isSaving}
          >
            {t('groupSettingsModal.cancel')}
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary} txt-small`}
            onClick={handleSave}
            disabled={!canSave}
          >
            {t('groupSettingsModal.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
