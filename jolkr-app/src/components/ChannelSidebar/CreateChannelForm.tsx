/**
 * Inline input row used by ChannelSidebar to create a new folder, text
 * channel, or voice channel. The icon + placeholder are derived from the
 * `creating` state. The parent owns the input value and the confirm/cancel
 * handlers; this component only renders the row.
 *
 * Reused in two places:
 *
 *   1. At the bottom of the channel nav for folder creation and
 *      uncategorized channel creation.
 *   2. Inside a `SortableCategory` (via `inlineCreateChannel` prop) for
 *      per-folder channel creation.
 */
import { FolderPlus, Hash, Volume2 } from 'lucide-react'
import type { CreatingState } from './ChannelContextMenu'
import s from './ChannelSidebar.module.css'

interface Props {
  creating: CreatingState
  value: string
  onChange: (value: string) => void
  onConfirm: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onCancel: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}

export function CreateChannelForm({ creating, value, onChange, onConfirm, onCancel, inputRef }: Props) {
  const icon = creating.type === 'folder'
    ? <FolderPlus size={13} strokeWidth={1.5} />
    : creating.kind === 'voice'
      ? <Volume2 size={13} strokeWidth={1.5} />
      : <Hash size={13} strokeWidth={1.5} />

  const placeholder = creating.type === 'folder'
    ? 'Folder name…'
    : creating.kind === 'voice'
      ? 'voice-channel-name…'
      : 'channel-name…'

  return (
    <div className={s.newItemRow}>
      <span className={s.newItemIcon}>{icon}</span>
      <input
        ref={inputRef}
        className={`${s.newItemInput} txt-small`}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onConfirm}
        onBlur={onCancel}
      />
    </div>
  )
}
