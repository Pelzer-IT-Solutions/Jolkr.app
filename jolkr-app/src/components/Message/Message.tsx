import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  SmilePlus, CornerUpLeft, Pencil, MoreHorizontal,
  Copy, Pin, Trash2, Flag,
} from 'lucide-react'
import type { Message as MessageType } from '../../types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useAuthStore } from '../../stores/auth'
import { renderMarkdown } from '../../utils/markdown'
import { useMenuPosition } from '../../utils/position'
import EmojiPickerPopup from '../EmojiPickerPopup'
import Avatar from '../Avatar'
import s from './Message.module.css'

interface Props {
  message:          MessageType
  onToggleReaction?: (emoji: string) => void
  onDelete?:         () => void
  onReply?:          () => void
  onEdit?:           (newText: string) => void
  onPin?:            () => void
  isDm?:            boolean
}

export function Message({ message, onToggleReaction, onDelete, onReply, onEdit, onPin, isDm = false }: Props) {
  const currentUserId = useAuthStore(s => s.user?.id)
  const isOwn = message.author_id === currentUserId || message.author === 'You'

  // Decrypt E2EE content
  const { displayContent, isEncrypted, decrypting } = useDecryptedContent(
    message.content,
    message.nonce,
    message.isDm ?? isDm,
    message.channel_id,
  )
  const messageContent = displayContent || message.content
  // Webhook messages have no nonce → isEncrypted=false, but only show badge if content exists
  const showUnencryptedBadge = !isEncrypted && !!message.content
  const [showEmoji, setShowEmoji] = useState(false)
  const [showMore,  setShowMore]  = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [pickerPos, setPickerPos] = useState({ top: 0, left: 0 })

  const [moreTriggerPos, setMoreTriggerPos] = useState<{ x: number; y: number } | null>(null)
  const emojiTriggerRef = useRef<HTMLButtonElement>(null)
  const moreRef         = useRef<HTMLDivElement>(null)
  const moreMenuRef     = useRef<HTMLDivElement>(null)
  const editRef         = useRef<HTMLDivElement>(null)

  const morePos = useMenuPosition(moreTriggerPos, moreMenuRef, showMore)
  const anyOpen = showEmoji || showMore

  // Close more menu on outside click (emoji picker handles its own close)
  useEffect(() => {
    if (!showMore) return
    function handle(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node) &&
          moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMore(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showMore])

  function handleReactionClick(emoji: string) {
    onToggleReaction?.(emoji)
    setShowEmoji(false)
  }

  function handleCopyText() {
    navigator.clipboard.writeText(messageContent).catch(() => {})
    setShowMore(false)
  }

  function handleDelete() {
    setShowMore(false)
    onDelete?.()
  }

  function startEdit() {
    setShowMore(false)
    setIsEditing(true)
  }

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.innerText = messageContent
      editRef.current.focus()
      const sel = window.getSelection()
      if (sel) {
        sel.selectAllChildren(editRef.current)
        sel.collapseToEnd()
      }
    }
  }, [isEditing, messageContent])

  function saveEdit() {
    const newText = editRef.current?.innerText.trim() ?? ''
    if (newText && newText !== messageContent) {
      onEdit?.(newText)
    }
    setIsEditing(false)
  }

  function cancelEdit() {
    setIsEditing(false)
  }

  function handleEditKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveEdit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  const editedTag = message.edited ? (
    <span className={`${s.editedTag} txt-tiny`}>(edited)</span>
  ) : null

  const replyBlock = message.replyTo ? (
    <div className={s.replyContext}>
      <ReplyIcon />
      <span className={`${s.replyAuthor} txt-tiny txt-semibold`}>{message.replyTo.author}</span>
      <span className={`${s.replyPreview} txt-tiny`}>{message.replyTo.text.length > 80 ? message.replyTo.text.slice(0, 80) + '…' : message.replyTo.text}</span>
    </div>
  ) : null

  const reactionsBlock = message.reactions.length > 0 ? (
    <div className={s.reactions}>
      {message.reactions.map((r, i) => (
        <button
          key={i}
          className={`${s.reaction} ${r.me ? s.active : ''}`}
          onClick={() => onToggleReaction?.(r.emoji)}
        >
          <span>{r.emoji}</span>
          <span className={`${s.reactionCount} txt-tiny txt-medium`}>{r.count}</span>
        </button>
      ))}
    </div>
  ) : null

  const textContent = isEditing ? (
    <div className={s.editWrap}>
      <div
        ref={editRef}
        className={`${s.editInput} txt-body`}
        contentEditable
        suppressContentEditableWarning
        onKeyDown={handleEditKeyDown}
      />
      <span className={`${s.editHint} txt-tiny`}>
        escape to <button className={s.editHintBtn} onClick={cancelEdit}>cancel</button> · enter to <button className={s.editHintBtn} onClick={saveEdit}>save</button>
      </span>
    </div>
  ) : (
    <div className={`${s.text} txt-body`}>{renderMarkdown(decrypting ? '...' : messageContent)}{editedTag}</div>
  )

  const body = (
    <>
      {replyBlock}
      {textContent}
      {reactionsBlock}
    </>
  )

  const hasActions = !!(onToggleReaction || onDelete || onReply || onEdit)

  const toolbar = !hasActions ? null : (
    <div className={`${s.actions} ${anyOpen ? s.actionsVisible : ''} ${isDm ? s.actionsDm : ''}`}>
      {/* ── Add reaction ── */}
      <div className={s.actionWrap}>
        <button
          ref={emojiTriggerRef}
          className={s.actionBtn}
          title="Add reaction"
          onClick={() => {
            if (!showEmoji && emojiTriggerRef.current) {
              const r = emojiTriggerRef.current.getBoundingClientRect()
              setPickerPos({ top: r.top, left: r.left + r.width / 2 })
            }
            setShowEmoji(v => !v)
            setShowMore(false)
          }}
        >
          <EmojiAddIcon />
        </button>
      </div>
      {showEmoji && (
        <EmojiPickerPopup
          position={{ top: pickerPos.top, left: pickerPos.left }}
          onSelect={(emoji) => handleReactionClick(emoji)}
          onClose={() => setShowEmoji(false)}
        />
      )}

      {/* ── Reply ── */}
      {onReply && <button className={s.actionBtn} title="Reply" onClick={onReply}><ReplyIcon /></button>}

      {/* ── Edit (own only) ── */}
      {isOwn && <button className={s.actionBtn} title="Edit message" onClick={startEdit}><EditIcon /></button>}

      {/* ── More options ── */}
      <div ref={moreRef} className={s.actionWrap}>
        <button
          className={s.actionBtn}
          title="More options"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMoreTriggerPos({ x: r.right, y: r.bottom + 4 })
            setShowMore(v => !v)
            setShowEmoji(false)
          }}
        >
          <MoreIcon />
        </button>
        {showMore && createPortal(
          <div
            ref={moreMenuRef}
            className={s.moreMenu}
            style={{ position: 'fixed', top: morePos.y, left: morePos.x - 184 }}
          >
            <button className={s.menuItem} onClick={() => { setShowMore(false); onReply?.() }}>
              <ReplyIcon /><span>Reply</span>
            </button>
            {isOwn && (
              <button className={s.menuItem} onClick={startEdit}>
                <EditIcon /><span>Edit Message</span>
              </button>
            )}
            <button className={s.menuItem} onClick={handleCopyText}>
              <CopyIcon /><span>Copy Text</span>
            </button>
            <button className={s.menuItem} onClick={() => { setShowMore(false); onPin?.() }}>
              <PinIcon /><span>{message.is_pinned ? 'Unpin Message' : 'Pin Message'}</span>
            </button>
            <div className={s.menuDivider} />
            {isOwn ? (
              <button className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                <TrashIcon /><span>Delete Message</span>
              </button>
            ) : (
              <button className={`${s.menuItem} ${s.danger}`} onClick={() => setShowMore(false)}>
                <FlagIcon /><span>Report Message</span>
              </button>
            )}
          </div>,
          document.body,
        )}
      </div>
    </div>
  )

  /* ─── DM card layout ─── */
  if (isDm) {
    return (
      <div className={`${s.dmRow} ${isOwn ? s.dmRowOwn : ''}`}>
        <div className={`${s.dmCard} ${isOwn ? s.dmCardOwn : ''}`}>
          {/* Header: sender on left, actions on right */}
          <div className={s.dmHeader}>
            <div className={s.dmHeaderSender}>
              <Avatar url={message.avatarUrl} name={message.author} size="xs" userId={message.author_id} className={s.dmAvatar} color={message.color} />
              <span className={`${s.dmAuthor} txt-body txt-semibold`}>{message.author}</span>
              <span className={`${s.dmTimeBadge} txt-tiny`}>{message.time}</span>
            </div>

            <div className={`${s.dmActions} ${anyOpen ? s.dmActionsVisible : ''}`}>
              <div className={s.actionWrap}>
                <button
                  ref={emojiTriggerRef}
                  className={s.dmActionBtn}
                  title="Add reaction"
                  onClick={() => {
                    if (!showEmoji && emojiTriggerRef.current) {
                      const r = emojiTriggerRef.current.getBoundingClientRect()
                      setPickerPos({ top: r.top, left: r.left + r.width / 2 })
                    }
                    setShowEmoji(v => !v)
                    setShowMore(false)
                  }}
                >
                  <EmojiAddIcon />
                </button>
              </div>
              {showEmoji && (
                <EmojiPickerPopup
                  position={{ top: pickerPos.top, left: pickerPos.left }}
                  onSelect={(emoji) => handleReactionClick(emoji)}
                  onClose={() => setShowEmoji(false)}
                />
              )}

              <button className={s.dmActionBtn} title="Reply" onClick={onReply}><ReplyIcon /></button>

              <div ref={moreRef} className={s.actionWrap}>
                <button
                  className={s.dmActionBtn}
                  title="More options"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setMoreTriggerPos({ x: r.right, y: r.bottom + 4 })
                    setShowMore(v => !v)
                    setShowEmoji(false)
                  }}
                >
                  <MoreIcon />
                </button>
                {showMore && createPortal(
                  <div
                    ref={moreMenuRef}
                    className={s.moreMenu}
                    style={{ position: 'fixed', top: morePos.y, left: morePos.x - 184 }}
                  >
                    <button className={s.menuItem} onClick={() => { setShowMore(false); onReply?.() }}>
                      <ReplyIcon /><span>Reply</span>
                    </button>
                    {isOwn && (
                      <button className={s.menuItem} onClick={startEdit}>
                        <EditIcon /><span>Edit Message</span>
                      </button>
                    )}
                    <button className={s.menuItem} onClick={handleCopyText}>
                      <CopyIcon /><span>Copy Text</span>
                    </button>
                    <button className={s.menuItem} onClick={() => { setShowMore(false); onPin?.() }}>
                      <PinIcon /><span>{message.is_pinned ? 'Unpin Message' : 'Pin Message'}</span>
                    </button>
                    <div className={s.menuDivider} />
                    {isOwn ? (
                      <button className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                        <TrashIcon /><span>Delete Message</span>
                      </button>
                    ) : (
                      <button className={`${s.menuItem} ${s.danger}`} onClick={() => setShowMore(false)}>
                        <FlagIcon /><span>Report Message</span>
                      </button>
                    )}
                  </div>,
                  document.body,
                )}
              </div>
            </div>
          </div>

          {/* Body */}
          <div className={s.dmBody}>
            {replyBlock}
            {isEditing ? (
              <div className={s.editWrap}>
                <div
                  ref={editRef}
                  className={`${s.editInput} txt-body`}
                  contentEditable
                  suppressContentEditableWarning
                  onKeyDown={handleEditKeyDown}
                />
                <span className={`${s.editHint} txt-tiny`}>
                  escape to <button className={s.editHintBtn} onClick={cancelEdit}>cancel</button> · enter to <button className={s.editHintBtn} onClick={saveEdit}>save</button>
                </span>
              </div>
            ) : (
              <div className={`${s.text} txt-body`}>{renderMarkdown(decrypting ? '...' : messageContent)}{editedTag}</div>
            )}
          </div>

          {/* Reactions — overlaid on the card's bottom edge */}
          {reactionsBlock && (
            <div className={s.dmReactions}>
              {reactionsBlock}
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ─── Standard channel layout ─── */
  if (message.continued) {
    return (
      <div className={`${s.msg} ${s.continued} ${anyOpen ? s.hasMenu : ''}`}>
        <div className={s.body}>{body}</div>
        {toolbar}
      </div>
    )
  }

  return (
    <div className={`${s.msg} ${anyOpen ? s.hasMenu : ''}`}>
      <MessageAvatar message={message} />
      <div className={s.body}>
        <div className={s.meta}>
          <span className={`${s.author} txt-body txt-semibold`}>{message.author}</span>
          <span className={`${s.time} txt-tiny`}>{message.time}</span>
          {message.is_pinned && <Pin size={11} strokeWidth={1.4} className={s.pinnedBadge} />}
          {showUnencryptedBadge && <span className={`${s.unencryptedBadge} txt-tiny`}>unencrypted</span>}
        </div>
        {body}
      </div>
      {toolbar}
    </div>
  )
}

/* ─── Icons ─── */
function MessageAvatar({ message }: { message: MessageType }) {
  return <Avatar url={message.avatarUrl} name={message.author} size="md" status={null} userId={message.author_id} className={s.avatar} color={message.color} />
}

function EmojiAddIcon() { return <SmilePlus      size={14} strokeWidth={1.4} /> }
function ReplyIcon()    { return <CornerUpLeft   size={14} strokeWidth={1.4} /> }
function EditIcon()     { return <Pencil         size={14} strokeWidth={1.4} /> }
function MoreIcon()     { return <MoreHorizontal size={14} strokeWidth={1.4} /> }
function CopyIcon()     { return <Copy           size={14} strokeWidth={1.4} /> }
function PinIcon()      { return <Pin            size={14} strokeWidth={1.4} /> }
function TrashIcon()    { return <Trash2         size={14} strokeWidth={1.4} /> }
function FlagIcon()     { return <Flag           size={14} strokeWidth={1.4} /> }
