import { X, Globe, Lock } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../../hooks/useT'
import s from './CreateServerModal.module.css'

/** `labelKey` resolves to a colour name under `createServerModal.colors.*`
 *  so the swatch tooltip flips per locale. Hue/colour are language-neutral. */
const COLOR_SWATCHES: { labelKey: string; hue: number | null; color: string }[] = [
  { labelKey: 'neutral', hue: null, color: 'oklch(50% 0 0)'       },
  { labelKey: 'red',     hue: 20,   color: 'oklch(58% 0.2 20)'    },
  { labelKey: 'orange',  hue: 40,   color: 'oklch(65% 0.18 40)'   },
  { labelKey: 'yellow',  hue: 65,   color: 'oklch(70% 0.16 65)'   },
  { labelKey: 'green',   hue: 143,  color: 'oklch(58% 0.18 143)'  },
  { labelKey: 'teal',    hue: 192,  color: 'oklch(58% 0.14 192)'  },
  { labelKey: 'blue',    hue: 220,  color: 'oklch(55% 0.2 220)'   },
  { labelKey: 'indigo',  hue: 255,  color: 'oklch(55% 0.2 255)'   },
  { labelKey: 'purple',  hue: 280,  color: 'oklch(55% 0.2 280)'   },
  { labelKey: 'pink',    hue: 330,  color: 'oklch(60% 0.2 330)'   },
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
  const { t } = useT()
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
          <span className={s.title}>{t('createServerModal.title')}</span>
          <button className={s.closeBtn} onClick={onClose} type="button">
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.desc}>
          <p className="txt-small">{t('createServerModal.description')}</p>
        </div>

        <form className={s.body} onSubmit={handleSubmit}>
          {/* Icon preview */}
          <div className={s.iconPreviewRow}>
            <div className={s.iconPreview} style={{ background: iconBg }}>
              <span className={s.iconChar}>{iconChar}</span>
            </div>
            <div className={s.iconMeta}>
              <span className={`${s.iconLabel} txt-tiny txt-semibold`}>{t('createServerModal.iconLabel')}</span>
              <span className="txt-tiny" style={{ color: 'var(--text-faint)' }}>{t('createServerModal.iconHelper')}</span>
            </div>
          </div>

          {/* Server name */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              {t('createServerModal.nameLabel')} <span className={s.required}>{t('common.required')}</span>
            </label>
            <input
              ref={nameRef}
              className={`${s.input} txt-small`}
              placeholder={t('createServerModal.namePlaceholder')}
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          {/* Icon character */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>
              {t('createServerModal.iconCharLabel')} <span className={s.optional}>Optional</span>
            </label>
            <input
              className={`${s.input} txt-small`}
              placeholder={t('createServerModal.iconCharPlaceholder')}
              value={icon}
              onChange={e => setIcon(e.target.value.slice(0, 2))}
              maxLength={2}
            />
          </div>

          {/* Color theme */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>{t('createServerModal.colorLabel')}</label>
            <div className={s.swatches}>
              {COLOR_SWATCHES.map((sw, i) => (
                <button
                  key={sw.labelKey}
                  type="button"
                  className={`${s.swatch} ${selectedSwatch === i ? s.swatchActive : ''}`}
                  style={{ '--swatch-color': sw.color } as React.CSSProperties}
                  title={t(`createServerModal.colors.${sw.labelKey}`)}
                  onClick={() => setSelectedSwatch(i)}
                />
              ))}
            </div>
          </div>

          {/* Privacy */}
          <div className={s.fieldGroup}>
            <label className={`${s.label} txt-tiny txt-semibold`}>{t('createServerModal.privacyLabel')}</label>
            <div className={s.privacyOptions}>
              <button
                type="button"
                className={`${s.privacyOption} ${privacy === 'public' ? s.privacyActive : ''}`}
                onClick={() => setPrivacy('public')}
              >
                <div className={s.privacyIcon}><Globe size={16} strokeWidth={1.5} /></div>
                <div className={s.privacyText}>
                  <span className={`${s.privacyTitle} txt-small txt-medium`}>{t('createServerModal.publicTitle')}</span>
                  <span className={`${s.privacySub} txt-tiny`}>{t('createServerModal.publicDesc')}</span>
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
                  <span className={`${s.privacyTitle} txt-small txt-medium`}>{t('createServerModal.privateTitle')}</span>
                  <span className={`${s.privacySub} txt-tiny`}>{t('createServerModal.privateDesc')}</span>
                </div>
                <div className={`${s.privacyRadio} ${privacy === 'private' ? s.privacyRadioActive : ''}`} />
              </button>
            </div>
          </div>

          <div className={s.footer}>
            <button type="button" className={`${s.cancelBtn} txt-small`} onClick={onClose}>{t('createServerModal.cancel')}</button>
            <button type="submit" className={`${s.submitBtn} txt-small`} disabled={!name.trim()}>
              {t('createServerModal.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
