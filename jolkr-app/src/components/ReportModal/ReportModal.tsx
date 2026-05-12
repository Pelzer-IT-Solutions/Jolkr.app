import { Flag, AlertCircle } from 'lucide-react'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import s from './ReportModal.module.css'
import type { MemberDisplay } from '../../types'

type ReportReason = 'harassment' | 'spam' | 'inappropriate' | 'violence' | 'other'

/** Reasons keyed for `reportModal.reasons.<key>.{label,desc}` lookup. */
const REPORT_REASON_KEYS: ReportReason[] = ['harassment', 'spam', 'inappropriate', 'violence', 'other']

interface Props {
  open: boolean
  onClose: () => void
  user: MemberDisplay | null
  onSubmit?: (userId: string, reason: ReportReason, details: string) => void
}

export function ReportModal({ open, onClose, user, onSubmit }: Props) {
  const { t } = useT()
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // Reset modal state when it closes — store-prev pattern.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setSelectedReason(null)
      setDetails('')
      setIsSubmitting(false)
      setIsSuccess(false)
    }
  }

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleSubmit = async () => {
    if (!user || !selectedReason) return

    setIsSubmitting(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))

    onSubmit?.(user.user_id, selectedReason, details)
    setIsSubmitting(false)
    setIsSuccess(true)
  }

  if (!open || !user) return null

  return createPortal(
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={s.modal}>
        {isSuccess ? (
          <div className={s.successView}>
            <div className={s.successIcon}>
              <Flag size={32} strokeWidth={1.5} />
            </div>
            <h3 className={`${s.title} txt-title`}>{t('reportModal.successTitle')}</h3>
            <p className={`${s.description} txt-small`}>
              {t('reportModal.successBody')}
            </p>
            <button className={s.closeBtn} onClick={onClose}>
              <span className="txt-small txt-medium">{t('reportModal.close')}</span>
            </button>
          </div>
        ) : (
          <>
            <div className={s.header}>
              <div className={s.headerIcon}>
                <AlertCircle size={20} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className={`${s.title} txt-title`}>{t('reportModal.title')}</h3>
                <p className={`${s.subtitle} txt-tiny`}>
                  @{user.username}
                </p>
              </div>
            </div>

            <div className={s.content}>
              <p className={`${s.description} txt-small`}>
                {t('reportModal.description')}
              </p>

              <div className={s.options}>
                {REPORT_REASON_KEYS.map(key => (
                  <button
                    key={key}
                    className={`${s.option} ${selectedReason === key ? s.selected : ''}`}
                    onClick={() => setSelectedReason(key)}
                  >
                    <div className={s.optionRadio}>
                      <div className={s.radioInner} />
                    </div>
                    <div className={s.optionText}>
                      <span className={`${s.optionLabel} txt-small txt-medium`}>{t(`reportModal.reasons.${key}.label`)}</span>
                      <span className={`${s.optionDescription} txt-tiny`}>{t(`reportModal.reasons.${key}.desc`)}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className={s.field}>
                <label className={`${s.label} txt-small txt-semibold`}>
                  {t('reportModal.additionalLabel')}
                </label>
                <textarea
                  className={`${s.textarea} txt-small`}
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder={t('reportModal.additionalPlaceholder')}
                  rows={3}
                  maxLength={500}
                />
                <span className={`${s.charCount} txt-tiny`}>{t('reportModal.charCount', { used: details.length, max: 500 })}</span>
              </div>
            </div>

            <div className={s.footer}>
              <button className={s.cancelBtn} onClick={onClose}>
                <span className="txt-small">{t('reportModal.cancel')}</span>
              </button>
              <button
                className={s.submitBtn}
                disabled={!selectedReason || isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting ? (
                  <span className="txt-small">{t('reportModal.submitting')}</span>
                ) : (
                  <>
                    <Flag size={14} strokeWidth={1.5} />
                    <span className="txt-small">{t('reportModal.submit')}</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
