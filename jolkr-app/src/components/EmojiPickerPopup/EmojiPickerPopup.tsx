import { lazy, Suspense, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useColorMode } from '../../utils/colorMode'
import s from './EmojiPickerPopup.module.css'

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'))

interface Props {
  /** Fixed-position anchor point. The picker appears above and centered on this point. */
  position: { top: number; left: number }
  onSelect: (emoji: string) => void
  onClose: () => void
  /** Trigger button — clicks here are not treated as outside, so toggling works. */
  anchor?: RefObject<HTMLElement | null>
}

export function EmojiPickerPopup({ position, onSelect, onClose, anchor }: Props) {
  const ref = useClickOutside<HTMLDivElement>(onClose, true, anchor)
  const { isDark } = useColorMode()
  const theme = (isDark ? 'dark' : 'light') as never

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
          onEmojiClick={(emojiData) => { onSelect(emojiData.emoji); }}
          width={300}
          height={350}
          lazyLoadEmojis
        />
      </Suspense>
    </div>,
    document.body,
  )
}
