import { lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '../hooks/useClickOutside'
import s from './EmojiPickerPopup.module.css'

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'))

interface Props {
  /** Fixed-position anchor point. The picker appears above and centered on this point. */
  position: { top: number; left: number }
  onSelect: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPickerPopup({ position, onSelect, onClose }: Props) {
  const ref = useClickOutside<HTMLDivElement>(onClose, true)
  const theme = (localStorage.getItem('jolkr_theme') === 'light' ? 'light' : 'dark') as never

  return createPortal(
    <div
      ref={ref}
      className={s.popup}
      style={{ top: position.top, left: position.left }}
    >
      <Suspense fallback={
        <div style={{ width: 300, height: 350, background: 'var(--bg-loud)', borderRadius: '0.75rem' }} />
      }>
        <LazyEmojiPicker
          theme={theme}
          onEmojiClick={(emojiData) => { onSelect(emojiData.emoji); onClose(); }}
          width={300}
          height={350}
          lazyLoadEmojis
        />
      </Suspense>
    </div>,
    document.body,
  )
}
