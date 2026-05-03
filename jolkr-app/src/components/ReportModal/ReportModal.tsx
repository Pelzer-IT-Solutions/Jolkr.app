import { useState } from 'react'
import { Flag, AlertCircle } from 'lucide-react'
import type { MemberDisplay } from '../../types'
import Modal from '../ui/Modal'
import s from './ReportModal.module.css'

type ReportReason = 'harassment' | 'spam' | 'nsfw' | 'violence' | 'other'

interface ReportOption {
  value: ReportReason
  label: string
  description: string
}

const REPORT_OPTIONS: ReportOption[] = [
  {
    value: 'harassment',
    label: 'Harassment or Bullying',
    description: 'Targeted abuse or intimidation',
  },
  {
    value: 'spam',
    label: 'Spam',
    description: 'Unwanted or repetitive messages',
  },
  {
    value: 'nsfw',
    label: 'Inappropriate Content',
    description: 'NSFW or explicit material',
  },
  {
    value: 'violence',
    label: 'Threats or Violence',
    description: 'Direct threats or violent content',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Something else',
  },
]

interface Props {
  open: boolean
  onClose: () => void
  user: MemberDisplay | null
  onSubmit?: (userId: string, reason: ReportReason, details: string) => void
}

export function ReportModal({ open, onClose, user, onSubmit }: Props) {
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)

  // Reset form fields when modal closes (canonical store-info-from-prev-render).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) {
      setSelectedReason(null)
      setDetails('')
      setIsSubmitting(false)
      setIsSuccess(false)
    }
  }

  const handleSubmit = async () => {
    if (!user || !selectedReason) return

    setIsSubmitting(true)

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000))

    onSubmit?.(user.user_id, selectedReason, details)
    setIsSubmitting(false)
    setIsSuccess(true)
  }

  if (!user) return null

  return (
    <Modal open={open} onClose={onClose} overlayClassName={s.overlay} className={s.modal}>
        {isSuccess ? (
          <div className={s.successView}>
            <div className={s.successIcon}>
              <Flag size={32} strokeWidth={1.5} />
            </div>
            <h3 className={`${s.title} txt-title`}>Report Submitted</h3>
            <p className={`${s.description} txt-small`}>
              Thank you for helping keep our community safe. We'll review your report and take appropriate action.
            </p>
            <button className={s.closeBtn} onClick={onClose}>
              <span className="txt-small txt-medium">Close</span>
            </button>
          </div>
        ) : (
          <>
            <div className={s.header}>
              <div className={s.headerIcon}>
                <AlertCircle size={20} strokeWidth={1.5} />
              </div>
              <div>
                <h3 className={`${s.title} txt-title`}>Report User</h3>
                <p className={`${s.subtitle} txt-tiny`}>
                  @{user.username}
                </p>
              </div>
            </div>

            <div className={s.content}>
              <p className={`${s.description} txt-small`}>
                Please select a reason for reporting this user. Your report will be reviewed by our moderation team.
              </p>

              <div className={s.options}>
                {REPORT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    className={`${s.option} ${selectedReason === option.value ? s.selected : ''}`}
                    onClick={() => setSelectedReason(option.value)}
                  >
                    <div className={s.optionRadio}>
                      <div className={s.radioInner} />
                    </div>
                    <div className={s.optionText}>
                      <span className={`${s.optionLabel} txt-small txt-medium`}>{option.label}</span>
                      <span className={`${s.optionDescription} txt-tiny`}>{option.description}</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className={s.field}>
                <label className={`${s.label} txt-small txt-semibold`}>
                  Additional Details (optional)
                </label>
                <textarea
                  className={`${s.textarea} txt-small`}
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder="Provide any additional context that might help our moderators..."
                  rows={3}
                  maxLength={500}
                />
                <span className={`${s.charCount} txt-tiny`}>{details.length}/500</span>
              </div>
            </div>

            <div className={s.footer}>
              <button className={s.cancelBtn} onClick={onClose}>
                <span className="txt-small">Cancel</span>
              </button>
              <button
                className={s.submitBtn}
                disabled={!selectedReason || isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting ? (
                  <span className="txt-small">Submitting...</span>
                ) : (
                  <>
                    <Flag size={14} strokeWidth={1.5} />
                    <span className="txt-small">Submit Report</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
    </Modal>
  )
}
