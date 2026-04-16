import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '../hooks/useClickOutside'
import { getApiBaseUrl } from '../platform/config'
import s from './EmojiPickerPopup.module.css'

const LazyGifPicker = lazy(() => import('gif-picker-react'))

const TENOR_ORIGIN = 'https://tenor.googleapis.com/v2/'

// Patch fetch once globally — intercepts gif-picker-react's Tenor calls
// and redirects them to our backend proxy. Safe to leave active permanently
// since it only rewrites URLs starting with the Tenor origin.
const originalFetch = window.fetch
const apiBase = getApiBaseUrl().replace(/\/api$/, '')

window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  if (url.startsWith(TENOR_ORIGIN)) {
    const tenorPath = url.slice(TENOR_ORIGIN.length)
    const proxiedUrl = `${apiBase}/api/gifs/${tenorPath}`
    return originalFetch.call(window, proxiedUrl, init)
  }
  return originalFetch.call(window, input, init)
}

interface Props {
  position: { top: number; left: number }
  onSelect: (gifUrl: string) => void
  onClose: () => void
}

export default function GifPickerPopup({ position, onSelect, onClose }: Props) {
  const ref = useClickOutside<HTMLDivElement>(onClose, true)
  const theme = (localStorage.getItem('jolkr_theme') === 'light' ? 'light' : 'dark') as never

  return createPortal(
    <div
      ref={ref}
      className={s.popup}
      style={{ top: position.top, left: position.left }}
    >
      <Suspense fallback={
        <div style={{ width: 350, height: 450, background: 'var(--bg-loud)', borderRadius: '0.75rem' }} />
      }>
        <LazyGifPicker
          tenorApiKey="proxied"
          theme={theme}
          onGifClick={(gif) => { onSelect(gif.url); onClose() }}
          width={350}
          height={450}
        />
      </Suspense>
    </div>,
    document.body,
  )
}
