import { createPortal } from 'react-dom'
import { useClickOutside } from '../hooks/useClickOutside'
import GifPicker from './GifPicker/GifPicker'
import s from './EmojiPickerPopup/EmojiPickerPopup.module.css'

interface Props {
  position: { top: number; left: number }
  onSelect: (gifUrl: string) => void
  onClose: () => void
}

export default function GifPickerPopup({ position, onSelect, onClose }: Props) {
  const ref = useClickOutside<HTMLDivElement>(onClose, true)

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
