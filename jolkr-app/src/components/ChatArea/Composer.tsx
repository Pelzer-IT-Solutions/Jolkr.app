/**
 * Composer — the bottom block of the ChatArea.
 *
 * Renders one of two states:
 *   1. Read-only banner (system channel, no SEND_MESSAGES permission, or
 *      explicit `readOnly` prop).
 *   2. Full composer: floating format bar (Bold/Italic/Strike/Code) above
 *      the active selection, reply card, mention + emoji autocomplete
 *      dropdowns, pending file thumbnails, the RichInput, and the
 *      emoji/attach/GIF/poll/send action buttons.
 *
 * Owns the composer-internal UI state (format bar position, picker open
 * flags + positions, poll modal open, content ref, file input ref). Reads
 * `replyingTo` + `pendingFiles` + the input handle as props because
 * drag-drop in the parent ChatArea also needs to feed pending files in
 * and the parent's MessageList uses `setReplyingTo` indirectly when the
 * user clicks the per-message reply action.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  CornerUpLeft, X, Smile, Paperclip, ImagePlay, SendHorizontal,
  Bold, Italic, Strikethrough, Code, BarChart3,
} from 'lucide-react'
import type { ChannelDisplay, MessageVM } from '../../types'
import EmojiPickerPopup from '../EmojiPickerPopup/EmojiPickerPopup'
import GifPickerPopup from '../GifPickerPopup'
import { emojiToImgUrl } from '../../utils/emoji'
import { RichInput, type RichInputHandle } from './RichInput'
import { useAutocomplete } from './useAutocomplete'
import { PollCreator } from '../Poll/PollCreator'
import { useChatActions, useChatPermissions } from './chatContexts'
import type { MentionableUser } from './ChatArea'
import s from './ChatArea.module.css'

interface Props {
  channel:        ChannelDisplay
  inputPlaceholder: string
  mentionableUsers: MentionableUser[]
  // Owned by parent ChatArea (drag-drop overlay also writes pendingFiles;
  // MessageList row-click writes replyingTo via handleReply).
  inputRef:       React.RefObject<RichInputHandle | null>
  replyingTo:     MessageVM | null
  setReplyingTo:  React.Dispatch<React.SetStateAction<MessageVM | null>>
  pendingFiles:   File[]
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>
  acceptValidFiles: (incoming: FileList | File[]) => void
}

export function Composer({
  channel, inputPlaceholder, mentionableUsers,
  inputRef, replyingTo, setReplyingTo, pendingFiles, setPendingFiles, acceptValidFiles,
}: Props) {
  const { isDm, isReadOnly, canSendMessages, canAttachFiles } = useChatPermissions()
  const { onSend, onTyping } = useChatActions()
  const contentRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fmtBar, setFmtBar] = useState<{ top: number; left: number } | null>(null)
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const [composerEmojiPos, setComposerEmojiPos] = useState<{ top: number; left: number } | null>(null)
  const composerEmojiBtnRef = useRef<HTMLButtonElement>(null)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [gifPickerPos, setGifPickerPos] = useState<{ top: number; left: number } | null>(null)
  const gifBtnRef = useRef<HTMLButtonElement>(null)
  // Poll creator modal — server channels only (gated on !isDm).
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false)

  // Reset composer side-state on channel/DM switch — the imperative APIs
  // on the input handle stay in an effect since they aren't reactive.
  useEffect(() => {
    contentRef.current = ''
    inputRef.current?.clear()
    inputRef.current?.focus()
  }, [channel.id, inputRef])

  // ── Autocomplete (emoji `:foo` + `@mention`) ──
  const ac = useAutocomplete(inputRef, mentionableUsers, onTyping)
  const {
    emojiQuery, emojiIndex, emojiMatches,
    mentionQuery, mentionIndex, mentionMatches,
    syncContent, insertEmoji, insertMention,
  } = ac

  // ── Formatting (selection-based on contentEditable) ──
  const insertFormatting = useCallback((prefix: string, suffix: string) => {
    inputRef.current?.focus()
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const selectedText = range.toString()
    range.deleteContents()
    const textNode = document.createTextNode(prefix + selectedText + suffix)
    range.insertNode(textNode)
    const newRange = document.createRange()
    if (selectedText) {
      newRange.setStart(textNode, prefix.length)
      newRange.setEnd(textNode, prefix.length + selectedText.length)
    } else {
      newRange.setStart(textNode, prefix.length)
      newRange.collapse(true)
    }
    sel.removeAllRanges()
    sel.addRange(newRange)
  }, [inputRef])

  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) { setFmtBar(null); return }
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width > 0) {
      setFmtBar({ top: rect.top - 6, left: rect.left + rect.width / 2 })
    } else { setFmtBar(null) }
  }, [])

  const handleInputChange = useCallback((plainText: string) => {
    contentRef.current = plainText
    syncContent(plainText)
  }, [syncContent])

  function send() {
    const text = contentRef.current.trim()
    if (!text && pendingFiles.length === 0) return
    const replyRef = replyingTo ? { id: replyingTo.id, author: replyingTo.author, text: replyingTo.content } : undefined
    onSend(text || '', replyRef, pendingFiles.length > 0 ? pendingFiles : undefined)
    inputRef.current?.clear()
    contentRef.current = ''
    setPendingFiles([])
    setReplyingTo(null)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Autocomplete picker has first crack at the keystroke (arrow / tab /
    // enter / escape). Returns true if it consumed the event.
    if (ac.handleKeyDown(e)) return
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); insertFormatting('**', '**'); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); insertFormatting('*', '*'); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === 'Escape' && replyingTo) setReplyingTo(null)
  }

  if (isReadOnly) {
    return (
      <div className={s.composerWrap}>
        <div className={`${s.composer} ${s.readOnly}`}>
          <span className={`${s.readOnlyText} txt-small`}>
            {channel.is_system
              ? 'This is a system channel'
              : !canSendMessages
                ? 'You do not have permission to send messages in this channel'
                : 'This is a read-only channel'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={s.composerWrap}>
        <div className={s.composerStack}>
          {replyingTo && (
            <div className={s.replyCard}>
              <div className={s.replyCardInner}>
                <CornerUpLeft size={12} strokeWidth={1.5} />
                <span className={`${s.replyCardLabel} txt-tiny`}>
                  Replying to <strong>{replyingTo.author}</strong>
                </span>
                <span className={`${s.replyCardPreview} txt-tiny`}>
                  {replyingTo.content.length > 72 ? replyingTo.content.slice(0, 72) + '…' : replyingTo.content}
                </span>
              </div>
              <button className={s.replyCardClose} title="Cancel reply" onClick={() => setReplyingTo(null)}>
                <X size={11} strokeWidth={1.75} />
              </button>
            </div>
          )}

          {mentionQuery !== null && mentionMatches.length > 0 && (
            <div role="listbox" className={s.autocomplete}>
              <div className={s.autocompleteHeader}>Members</div>
              {mentionMatches.map((u, i) => (
                <button
                  key={u.id}
                  role="option"
                  aria-selected={i === mentionIndex}
                  onClick={() => insertMention(u.username)}
                  className={`${s.autocompleteItem} ${i === mentionIndex ? s.autocompleteItemActive : ''}`}
                >
                  <span className={s.accentChar}>@</span>
                  <span>{u.username}</span>
                </button>
              ))}
            </div>
          )}

          {emojiQuery !== null && emojiMatches.length > 0 && (
            <div role="listbox" className={s.autocomplete}>
              <div className={s.autocompleteHeader}>Emoji matching :{emojiQuery}</div>
              {emojiMatches.map((entry, i) => (
                <button
                  key={entry.name}
                  role="option"
                  aria-selected={i === emojiIndex}
                  onClick={() => insertEmoji(entry.emoji)}
                  className={`${s.autocompleteItem} ${i === emojiIndex ? s.autocompleteItemActive : ''}`}
                >
                  <img src={emojiToImgUrl(entry.emoji)} alt={entry.emoji} className={s.autocompleteEmoji} loading="lazy" draggable={false} />
                  <span className={s.autocompleteEmojiName}>:{entry.name}:</span>
                </button>
              ))}
            </div>
          )}

          {pendingFiles.length > 0 && (
            <div className={s.pendingFiles}>
              {pendingFiles.map((file, i) => (
                <div key={`${file.name}-${i}`} className={s.pendingFile}>
                  {file.type.startsWith('image/') ? (
                    <img src={URL.createObjectURL(file)} alt={file.name} className={s.pendingFileThumb} />
                  ) : (
                    <div className={s.pendingFileIcon}><Paperclip size={15} strokeWidth={1.25} /></div>
                  )}
                  <span className={`${s.pendingFileName} txt-tiny`}>{file.name}</span>
                  <button
                    className={s.pendingFileRemove}
                    onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={s.composer}>
            {fmtBar && (
              <div
                className={s.fmtBar}
                style={{ top: fmtBar.top, left: fmtBar.left }}
                onMouseDown={e => e.preventDefault()}
              >
                <button className={s.fmtBtn} title="Bold (Ctrl+B)" onClick={() => insertFormatting('**', '**')}>
                  <Bold size={14} strokeWidth={2} />
                </button>
                <button className={s.fmtBtn} title="Italic (Ctrl+I)" onClick={() => insertFormatting('*', '*')}>
                  <Italic size={14} strokeWidth={2} />
                </button>
                <button className={s.fmtBtn} title="Strikethrough" onClick={() => insertFormatting('~~', '~~')}>
                  <Strikethrough size={14} strokeWidth={2} />
                </button>
                <button className={s.fmtBtn} title="Code" onClick={() => insertFormatting('`', '`')}>
                  <Code size={14} strokeWidth={2} />
                </button>
              </div>
            )}
            <div className={s.emojiAnchor}>
              <button
                ref={composerEmojiBtnRef}
                className={s.emojiBtn}
                title="Emoji"
                onClick={() => {
                  if (!showComposerEmoji && composerEmojiBtnRef.current) {
                    const r = composerEmojiBtnRef.current.getBoundingClientRect()
                    setComposerEmojiPos({ top: r.top, left: r.left + r.width / 2 })
                  }
                  setShowComposerEmoji(v => !v)
                }}
              >
                <Smile size={15} strokeWidth={1.25} />
              </button>
              {showComposerEmoji && composerEmojiPos && (
                <EmojiPickerPopup
                  position={composerEmojiPos}
                  onSelect={(emoji) => {
                    inputRef.current?.insertEmojiAtCursor(emoji)
                  }}
                  onClose={() => setShowComposerEmoji(false)}
                  anchor={composerEmojiBtnRef}
                />
              )}
            </div>
            <div className={s.inputWrap}>
              <RichInput
                ref={inputRef}
                placeholder={inputPlaceholder}
                onInput={handleInputChange}
                onKeyDown={handleKeyDown}
                onSelectionChange={checkSelection}
              />
            </div>
            <div className={s.composerActions}>
              {canAttachFiles && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*,.pdf,.txt,.zip,.doc,.docx"
                    multiple
                    className={s.fileInputHidden}
                    onChange={(e) => {
                      if (e.target.files) acceptValidFiles(e.target.files)
                      e.target.value = ''
                    }}
                  />
                  <button className={s.composerBtn} title="Attach file" onClick={() => fileInputRef.current?.click()}>
                    <Paperclip size={15} strokeWidth={1.25} />
                  </button>
                  <button
                    ref={gifBtnRef}
                    className={s.composerBtn}
                    title="GIF"
                    onClick={() => {
                      if (!showGifPicker && gifBtnRef.current) {
                        const r = gifBtnRef.current.getBoundingClientRect()
                        setGifPickerPos({ top: r.top, left: r.left + r.width / 2 })
                      }
                      setShowGifPicker(v => !v)
                    }}
                  >
                    <ImagePlay size={15} strokeWidth={1.25} />
                  </button>
                  {showGifPicker && gifPickerPos && (
                    <GifPickerPopup
                      position={gifPickerPos}
                      onSelect={(gifUrl) => {
                        onSend(gifUrl)
                        inputRef.current?.focus()
                      }}
                      onClose={() => setShowGifPicker(false)}
                      anchor={gifBtnRef}
                    />
                  )}
                </>
              )}
              {!isDm && (
                <button
                  className={s.composerBtn}
                  title="Create poll"
                  onClick={() => setPollCreatorOpen(true)}
                >
                  <BarChart3 size={15} strokeWidth={1.25} />
                </button>
              )}
              <button className={s.sendBtn} title="Send (Enter)" onClick={send}>
                <SendHorizontal size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
      {!isDm && (
        <PollCreator
          open={pollCreatorOpen}
          channelId={channel.id}
          onClose={() => setPollCreatorOpen(false)}
        />
      )}
    </>
  )
}
