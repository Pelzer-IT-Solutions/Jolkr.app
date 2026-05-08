import { useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { X, Copy, Check } from 'lucide-react'
import { useAuthStore } from '../../stores/auth'
import { useT } from '../../hooks/useT'
import Avatar from '../Avatar/Avatar'
import s from './QrCodeDisplay.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

// QR encodes the same `https://jolkr.app/app/add/<userId>` URL the deep-link
// handler in App.tsx already understands (path === 'add'), so a scan from any
// device — desktop, mobile web, or Tauri — lands the recipient on the friend
// request flow without per-platform forks.
function buildAddUrl(userId: string): string {
  return `https://jolkr.app/app/add/${userId}`
}

// Black/white version of /public/icon.svg, inlined as a data URL so the
// `<image>` element qrcode.react injects works identically across web,
// Tauri, and any subpath basename. Paired with `excavate: true` the QR
// modules behind the logo are cleared so scanners still resolve cleanly
// at error-correction level H.
const LOGO_DATA_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="16" ry="16" fill="#000"/>' +
      '<path fill="#fff" d="M32.2597 46.8873C33.0742 48.7438 34.5922 50.2229 36.4976 51.0167L36.9706 51.2132L36.4976 51.4103C34.5922 52.204 33.0742 53.6831 32.2597 55.5397L32.058 56L31.8557 55.5397C31.0411 53.683 29.5231 52.204 27.6178 51.4103L27.1453 51.2132L27.6178 51.0167C29.5231 50.2229 31.0411 48.7438 31.8557 46.8873L32.058 46.4269L32.2597 46.8873ZM21.7418 8C24.3834 9.11849 26.7424 10.835 28.818 13.1486C29.6986 14.1292 30.5631 15.3014 31.4122 16.665C32.2613 18.0133 33.0166 19.576 33.677 21.3532C34.3374 23.1152 34.8718 25.1073 35.2806 27.3289C35.5408 28.7523 35.7177 30.2812 35.8122 31.9156C36.2617 31.1758 36.7818 30.3698 37.3752 29.499C38.0972 28.4624 38.9057 27.4022 39.8003 26.3192C40.6951 25.2362 41.6453 24.2464 42.6499 23.3491C43.6701 22.4673 44.7217 21.74 45.8047 21.1676C46.9034 20.5951 48.0026 20.3088 49.1013 20.3088C49.9803 20.3088 50.9927 20.4093 52.1383 20.6104C53.2842 20.8116 54.5716 21.1986 56 21.771L55.6466 22.8148C55.1916 22.6293 54.7677 22.5132 54.3753 22.4669C53.9987 22.4204 53.7002 22.3971 53.4804 22.3971C53.0252 22.3972 52.4991 22.5523 51.9028 22.8617C51.322 23.1866 50.694 23.6276 50.0191 24.1844C49.3442 24.7569 48.6459 25.4223 47.9239 26.1803C47.2176 26.9384 46.511 27.7583 45.8047 28.6402C45.0983 29.522 44.4233 30.4424 43.7798 31.4018C43.1362 32.361 42.5477 33.3206 42.014 34.2798C43.3952 34.5892 44.7452 35.0069 46.0638 35.5329C47.3979 36.0743 48.5829 36.7551 49.6189 37.575C50.6704 38.395 51.5104 39.3774 52.1383 40.5222C52.7819 41.6671 53.1037 43.0058 53.1037 44.5374C53.1036 45.1184 53.0572 45.6722 52.9667 46.1991C50.6112 45.4056 48.0149 44.7418 45.2336 44.2339C45.2044 43.2299 45.0501 42.3253 44.7686 41.5206C44.4702 40.6231 44.07 39.826 43.5677 39.1298C43.0653 38.4337 42.4928 37.8301 41.8493 37.3197C41.2058 36.8091 40.5462 36.3681 39.8713 35.9969C38.6691 35.3452 37.3426 34.8483 35.8919 34.5052C35.8924 34.61 35.8937 34.7151 35.8937 34.8207V40.0018C35.8937 41.6713 36.571 43.0789 39.8948 43.0789V44.002C39.8948 44.002 36.842 43.5404 32.3158 43.5404C27.7896 43.5404 24.421 44.002 24.421 44.002V43.0789C26.2626 43.0789 28.2864 42.2542 28.411 40.2037L28.4171 40.0018V34.4349C26.8454 34.7789 25.4162 35.2993 24.1293 35.9969C23.4543 36.3681 22.7949 36.8091 22.1513 37.3197C21.5078 37.8301 20.9347 38.4336 20.4323 39.1298C19.93 39.826 19.5298 40.6231 19.2314 41.5206C18.9499 42.3253 18.7954 43.2299 18.7664 44.2339C15.9849 44.7418 13.3883 45.4054 11.0327 46.1991C10.9421 45.6723 10.8964 45.1184 10.8964 44.5374C10.8964 43.0058 11.2181 41.6671 11.8616 40.5222C12.4895 39.3773 13.3295 38.395 14.3812 37.575C15.4171 36.7551 16.6021 36.0743 17.9362 35.5329C19.2548 35.0069 20.6053 34.5892 21.9867 34.2798C21.453 33.3206 20.8638 32.361 20.2202 31.4018C19.5767 30.4426 18.9017 29.522 18.1953 28.6402C17.489 27.7584 16.783 26.9383 16.0767 26.1803C15.3547 25.4223 14.6558 24.7569 13.9809 24.1844C13.3059 23.6276 12.678 23.1867 12.0972 22.8617C11.5008 22.5523 10.9747 22.3971 10.5195 22.3971C10.2998 22.3971 10.0017 22.4204 9.6252 22.4669C9.2328 22.5132 8.8086 22.6292 8.35341 22.8148L8 21.771C9.4284 21.1986 10.7158 20.8116 11.8616 20.6104C13.0075 20.4093 14.0202 20.3088 14.8992 20.3088C15.998 20.3088 17.0966 20.5952 18.1953 21.1676C19.2784 21.74 20.3304 22.4672 21.3508 23.3491C22.3552 24.2463 23.305 25.2363 24.1997 26.3192C25.0943 27.4022 25.9028 28.4624 26.6248 29.499C27.3216 30.5214 27.9189 31.4536 28.4171 32.2953V29.3283C28.4171 27.4898 28.315 25.7812 28.1106 24.2031C27.9062 22.6404 27.6307 21.2078 27.2848 19.9054C26.9546 18.5879 26.5776 17.4 26.153 16.3428C25.7284 15.2857 25.2956 14.3432 24.8552 13.5158C23.8176 11.5701 22.6382 9.98413 21.3174 8.75844L21.7418 8Z"/>' +
      '</svg>',
  )

export function QrCodeDisplay({ open, onClose }: Props) {
  const { t } = useT()
  const user = useAuthStore(st => st.user)
  const [copied, setCopied] = useState(false)

  if (!open || !user) return null

  const url = buildAddUrl(user.id)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write may fail in non-secure contexts; the URL is still
      // visible on screen so users can copy it manually.
    }
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div className={s.modal}>
        <div className={s.header}>
          <span className={`${s.title} txt-medium`}>{t('qrDisplay.title')}</span>
          <button className={s.closeBtn} onClick={onClose} aria-label={t('qrDisplay.close')}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className={s.body}>
          <Avatar
            url={user.avatar_url}
            name={user.display_name ?? user.username}
            size="2xl"
            userId={user.id}
          />
          <span className={`${s.username} txt-small txt-semibold`}>{user.username}</span>

          <div className={s.qrFrame}>
            <QRCodeSVG
              value={url}
              size={200}
              // Bumped to "H" so the logo overlay can excavate ~15% of the
              // matrix without breaking scan reliability.
              level="H"
              imageSettings={{
                src: LOGO_DATA_URL,
                height: 44,
                width: 44,
                excavate: true,
              }}
            />
          </div>

          <p className={`${s.hint} txt-tiny`}>
            {t('qrDisplay.hint')}
          </p>

          <button className={`${s.copyBtn} txt-small txt-medium`} onClick={handleCopy}>
            {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.5} />}
            {copied ? t('qrDisplay.copied') : t('qrDisplay.copyLink')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
