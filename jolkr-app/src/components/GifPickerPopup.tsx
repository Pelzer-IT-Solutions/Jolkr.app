import { createPortal } from 'react-dom'
import { useClickOutside } from '../hooks/useClickOutside'
import s from './EmojiPickerPopup/EmojiPickerPopup.module.css'
import { GifPicker } from './GifPicker/GifPicker'
import type { RefObject } from 'react'

interface Props {
  position: { top: number; left: number }
  onSelect: (gifUrl: string) => void
  onClose: () => void
  /** Trigger button — clicks here are not treated as outside, so toggling works. */
  anchor?: RefObject<HTMLElement | null>
}

export function GifPickerPopup({ position, onSelect, onClose, anchor }: Props) {
  const ref = useClickOutside<HTMLDivElement>(onClose, true, anchor)

  return createPortal(
    <div
      ref={ref}
      className={s.popup}
      style={{ top: position.top, left: position.left }}
    >
      <GifPicker
        onSelect={(gifUrl) => { onSelect(gifUrl); onClose() }}
        width={450}
        height={450}
      />
    </div>,
    document.body,
  )
}
