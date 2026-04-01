import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Globe, Lock } from 'lucide-react'

import s from './CreateServerModal.module.css'

const COLOR_SWATCHES: { label: string; hue: number | null; color: string }[] = [
  { label: 'Neutral',  hue: null, color: 'oklch(50% 0 0)'       },
  { label: 'Red',      hue: 20,   color: 'oklch(58% 0.2 20)'    },
  { label: 'Orange',   hue: 40,   color: 'oklch(65% 0.18 40)'   },
  { label: 'Yellow',   hue: 65,   color: 'oklch(70% 0.16 65)'   },
  { label: 'Green',    hue: 143,  color: 'oklch(58% 0.18 143)'  },
  { label: 'Teal',     hue: 192,  color: 'oklch(58% 0.14 192)'  },
  { label: 'Blue',     hue: 220,  color: 'oklch(55% 0.2 220)'   },
  { label: 'Indigo',   hue: 255,  color: 'oklch(55% 0.2 255)'   },
  { label: 'Purple',   hue: 280,  color: 'oklch(55% 0.2 280)'   },
  { label: 'Pink',     hue: 330,  color: 'oklch(60% 0.2 330)'   },
]

interface CreateServerData {
  name:    string
  icon:    string
  hue:     number | null
  color:   string
  privacy: 'public' | 'private'
}

interface Props {
  onClose:  () => void
  onCreate: (data: { name: string; icon: string; color: string; hue?: number; privacy: 'public' | 'private' }) => void
}

export function CreateServerModal({ onClose, onCreate }: Props) {
  const [name,    setName]    = useState('')
  const [icon,    setIcon]    = useState('')
  const [selectedSwatch, setSelectedSwatch] = useState(0)
  const [privacy, setPrivacy] = useState<'public' | 'private'>('public')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 0)
  }, [])

  const swatch  = COLOR_SWATCHES[selectedSwatch]
  const iconChar = (icon.trim() || name.trim()[0] || '?').slice(0, 2)
  const iconBg  = swatch.color

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate({
      name:    trimmed,
      icon:    iconChar,
      color:   iconBg,
      hue:     swatch.hue ?? undefined,
      privacy,
    } as CreateServerData & { hue?: number })
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal}>
        <div className={s.header}>
          <span className={s.title}>Create a Server</span>
          <button className={s.closeBtn} onClick={onClose} type="button">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.desc}>
          <p className="txt-small">Give your community a home. Customise it to make it yours.</p>
        </div>

        <form className={s.body} onSubmit={handleSubmit}>
          {/* Icon preview */}
          <div className={s.iconPreviewRow}>
            <div className={s.iconPreview} style={{ background: iconBg }}>
              <span className={s.iconChar}>{iconChar}</span>
            </div>
            <div className={s.iconMeta}>
              <span className={`${s.iconLabel} txt-tiny txt-semibold`}>Server icon</span>
              <span className="txt-tiny" style={{ color: 'var(--text-faint)' }}>Shown in tabs and the server browser</span>
            </div>
          </div>

          {/* Server name */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              Server Name <span className={s.required}>*</span>
            </label>
            <input
              ref={nameRef}
              className={`${s.input} txt-small`}
              placeholder="My Awesome Server"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          {/* Icon character */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              Icon Character <span className={s.optional}>Optional</span>
            </label>
            <input
              className={`${s.input} txt-small`}
              placeholder="Leave blank to use first letter of name"
              value={icon}
              onChange={e => setIcon(e.target.value.slice(0, 2))}
              maxLength={2}
            />
          </div>

          {/* Color theme */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>Color Theme</label>
            <div className={s.swatches}>
              {COLOR_SWATCHES.map((sw, i) => (
                <button
                  key={sw.label}
                  type="button"
                  className={`${s.swatch} ${selectedSwatch === i ? s.swatchActive : ''}`}
                  style={{ '--swatch-color': sw.color } as React.CSSProperties}
                  title={sw.label}
                  onClick={() => setSelectedSwatch(i)}
                />
              ))}
            </div>
          </div>

          {/* Privacy */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>Privacy</label>
            <div className={s.privacyOptions}>
              <button
                type="button"
                className={`${s.privacyOption} ${privacy === 'public' ? s.privacyActive : ''}`}
                onClick={() => setPrivacy('public')}
              >
                <div className={s.privacyIcon}><Globe size={16} strokeWidth={1.5} /></div>
                <div className={s.privacyText}>
                  <span className={`${s.privacyTitle} txt-small txt-medium`}>Public</span>
                  <span className={`${s.privacySub} txt-tiny`}>Anyone can join with the server ID</span>
                </div>
                <div className={`${s.privacyRadio} ${privacy === 'public' ? s.privacyRadioActive : ''}`} />
              </button>

              <button
                type="button"
                className={`${s.privacyOption} ${privacy === 'private' ? s.privacyActive : ''}`}
                onClick={() => setPrivacy('private')}
              >
                <div className={s.privacyIcon}><Lock size={16} strokeWidth={1.5} /></div>
                <div className={s.privacyText}>
                  <span className={`${s.privacyTitle} txt-small txt-medium`}>Private</span>
                  <span className={`${s.privacySub} txt-tiny`}>Members need an access code to join</span>
                </div>
                <div className={`${s.privacyRadio} ${privacy === 'private' ? s.privacyRadioActive : ''}`} />
              </button>
            </div>
          </div>

          <div className={s.footer}>
            <button type="button" className={`${s.cancelBtn} txt-small`} onClick={onClose}>Cancel</button>
            <button type="submit" className={`${s.submitBtn} txt-small`} disabled={!name.trim()}>
              Create Server
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
