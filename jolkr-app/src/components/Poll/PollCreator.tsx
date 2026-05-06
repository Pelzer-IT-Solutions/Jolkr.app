import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2 } from 'lucide-react'
import * as api from '../../api/client'
import s from './PollCreator.module.css'

interface Props {
  open: boolean
  channelId: string
  onClose: () => void
}

const MAX_OPTIONS = 10
const MIN_OPTIONS = 2
const MAX_QUESTION_LEN = 300
const MAX_OPTION_LEN = 100

/**
 * Modal for creating a poll in a server channel. Submits to
 * `POST /channels/:id/polls` — the backend then broadcasts a `MessageCreate`
 * containing the poll-host message, which lands in the channel via the
 * normal WS path. We don't have to do anything with the response here.
 */
export function PollCreator({ open, channelId, onClose }: Props) {
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [multiSelect, setMultiSelect] = useState(false)
  const [anonymous, setAnonymous] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questionRef = useRef<HTMLInputElement>(null)

  // Reset state whenever the modal is freshly opened, and focus the question
  // field once it's mounted.
  useEffect(() => {
    if (!open) return
    setQuestion('')
    setOptions(['', ''])
    setMultiSelect(false)
    setAnonymous(false)
    setSubmitting(false)
    setError(null)
    setTimeout(() => questionRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function setOptionAt(i: number, value: string) {
    setOptions((prev) => prev.map((v, j) => (j === i ? value : v)))
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return
    setOptions((prev) => [...prev, ''])
  }

  function removeOption(i: number) {
    if (options.length <= MIN_OPTIONS) return
    setOptions((prev) => prev.filter((_, j) => j !== i))
  }

  const trimmedQuestion = question.trim()
  const nonEmptyOptions = options.map((o) => o.trim()).filter((o) => o.length > 0)
  const canSubmit =
    !submitting &&
    trimmedQuestion.length > 0 &&
    nonEmptyOptions.length >= MIN_OPTIONS

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await api.createPoll(channelId, {
        question: trimmedQuestion,
        options: nonEmptyOptions,
        multi_select: multiSelect,
        anonymous,
      })
      // Backend broadcasts MessageCreate → message lands in channel via WS.
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create poll'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-label="Create poll">
        <div className={s.header}>
          <span className={s.title}>Create a Poll</span>
          <button type="button" className={s.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <form className={s.body} onSubmit={handleSubmit}>
          {/* Question */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`} htmlFor="poll-question">
              Question <span className={s.required}>*</span>
            </label>
            <input
              id="poll-question"
              ref={questionRef}
              className={`${s.input} txt-small`}
              placeholder="What do you want to ask?"
              value={question}
              onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION_LEN))}
              maxLength={MAX_QUESTION_LEN}
            />
            <span className={`${s.charCount} txt-tiny`}>
              {question.length}/{MAX_QUESTION_LEN}
            </span>
          </div>

          {/* Options */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              Options <span className={s.required}>*</span>
            </label>
            <div className={s.optionRows}>
              {options.map((opt, i) => (
                <div key={i} className={s.optionRow}>
                  <input
                    className={`${s.input} txt-small`}
                    placeholder={`Option ${i + 1}`}
                    value={opt}
                    onChange={(e) => setOptionAt(i, e.target.value.slice(0, MAX_OPTION_LEN))}
                    maxLength={MAX_OPTION_LEN}
                  />
                  {options.length > MIN_OPTIONS && (
                    <button
                      type="button"
                      className={s.optionRemove}
                      onClick={() => removeOption(i)}
                      title="Remove option"
                      aria-label="Remove option"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < MAX_OPTIONS && (
              <button type="button" className={`${s.addOptionBtn} txt-tiny txt-semibold`} onClick={addOption}>
                <Plus size={12} strokeWidth={1.75} />
                <span>Add option</span>
              </button>
            )}
          </div>

          {/* Toggles */}
          <div className={s.fieldGroup}>
            <label className={s.toggleRow}>
              <input
                type="checkbox"
                className={s.checkbox}
                checked={multiSelect}
                onChange={(e) => setMultiSelect(e.target.checked)}
              />
              <div className={s.toggleText}>
                <span className={`${s.toggleTitle} txt-small txt-medium`}>Allow multiple votes</span>
                <span className={`${s.toggleSub} txt-tiny`}>Voters can pick more than one option</span>
              </div>
            </label>
            <label className={s.toggleRow}>
              <input
                type="checkbox"
                className={s.checkbox}
                checked={anonymous}
                onChange={(e) => setAnonymous(e.target.checked)}
              />
              <div className={s.toggleText}>
                <span className={`${s.toggleTitle} txt-small txt-medium`}>Anonymous</span>
                <span className={`${s.toggleSub} txt-tiny`}>Hide who voted for what</span>
              </div>
            </label>
          </div>

          {error && <div className={`${s.error} txt-tiny`}>{error}</div>}

          <div className={s.footer}>
            <button type="button" className={`${s.cancelBtn} txt-small`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${s.submitBtn} txt-small`} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create Poll'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
