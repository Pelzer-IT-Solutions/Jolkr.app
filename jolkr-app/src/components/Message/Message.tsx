import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  SmilePlus, CornerUpLeft, Pencil, MoreHorizontal,
  Copy, Pin, Trash2, Flag, MessageSquare,
} from 'lucide-react'
import type { MessageVM } from '../../types'
import type { User, MessageEmbed } from '../../api/types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useShiftKey } from '../../hooks/useShiftKey'
import { useAuthStore } from '../../stores/auth'
import { useMenuPosition } from '../../utils/position'
import { emojiToImgUrl } from '../../utils/emoji'
import { parseVideoUrl, getYouTubeThumbnail, getPlatformName, getPlatformColor } from '../../utils/videoUrl'
import EmojiPickerPopup from '../EmojiPickerPopup/EmojiPickerPopup'
import MessageContent from '../MessageContent'
import VideoEmbed from '../VideoEmbed/VideoEmbed'
import LinkEmbed from '../LinkEmbed/LinkEmbed'
import Avatar from '../Avatar/Avatar'
import { MessageAttachments } from '../MessageAttachments/MessageAttachments'
import { PollDisplay } from '../Poll/PollDisplay'
import { ReactionTooltip } from './ReactionTooltip'
import s from './Message.module.css'

interface Props {
  message:               MessageVM
  onToggleReaction?:     (emoji: string) => void
  onDelete?:             () => void
  onReply?:              () => void
  onEdit?:               (newText: string) => void
  onPin?:                () => void
  /** Click on author avatar/name → open profile card. */
  onOpenAuthorProfile?:  (authorId: string, e: React.MouseEvent) => void
  isDm?:                 boolean
  serverId?:             string
  userMap?:              Map<string, User>
  dmParticipantNames?:   Record<string, string>
  canManageMessages?:    boolean
  canAddReactions?:      boolean
  /** Open the thread that hangs off this message in the right panel. */
  onOpenThread?:         (threadId: string) => void
  /** Start a brand-new thread from this message (server channels only). */
  onStartThread?:        (messageId: string) => void
}

export function Message({ message, onToggleReaction, onDelete, onReply, onEdit, onPin, onOpenAuthorProfile, isDm = false, serverId, userMap, dmParticipantNames, canManageMessages = false, canAddReactions = false, onOpenThread, onStartThread }: Props) {
  const currentUserId = useAuthStore(s => s.user?.id)
  const isOwn = message.author_id === currentUserId || message.author === 'You'
  const shiftHeld = useShiftKey()
  // Shift+click on the toolbar's "more" affordance acts as instant-delete
  // when the viewer can actually delete this message. We don't gate on the
  // toolbar being visible — pressing Shift while hovering swaps the icon.
  // In DMs there's no moderator concept, so users can only delete their OWN
  // messages — `canManageMessages` may be true server-side (admin role on a
  // shared server) but it doesn't carry into the DM context.
  const canDelete = !!onDelete && (isDm ? isOwn : (isOwn || canManageMessages))
  const shiftDeleteArmed = shiftHeld && canDelete

  // Decrypt E2EE content
  const { displayContent, isEncrypted, decrypting } = useDecryptedContent(
    message.content,
    message.nonce,
    message.isDm ?? isDm,
    message.channel_id,
  )
  const messageContent = displayContent || message.content
  const showUnencryptedBadge = !isEncrypted && !!message.content

  // Client-side embed generation: extract URLs from displayed content and create
  // video embeds for known platforms (essential for E2EE where server can't read content)
  const clientEmbeds = useMemo<MessageEmbed[]>(() => {
    if ((message.embeds ?? []).length > 0) return message.embeds!
    if (!messageContent) return []
    const urls = messageContent.match(/https?:\/\/[^\s<>)"]+/gi)
    if (!urls) return []
    const seen = new Set<string>()
    const embeds: MessageEmbed[] = []
    for (const url of urls.slice(0, 5)) {
      if (seen.has(url)) continue
      seen.add(url)
      const info = parseVideoUrl(url)
      if (info) {
        embeds.push({
          url,
          title: null,
          description: null,
          image_url: info.platform === 'youtube' && info.id ? getYouTubeThumbnail(info.id) : null,
          site_name: getPlatformName(info.platform),
          color: getPlatformColor(info.platform),
        })
      }
    }
    return embeds
  }, [messageContent, message.embeds])
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
        <ReactionTooltip
          key={i}
          reaction={r}
          serverId={serverId}
          userMap={userMap}
          dmParticipantNames={dmParticipantNames}
        >
          <button
            className={`${s.reaction} ${r.me ? s.active : ''}`}
            onClick={() => onToggleReaction?.(r.emoji)}
          >
            <img src={emojiToImgUrl(r.emoji)} alt={r.emoji} className={s.reactionEmoji} draggable={false} />
            <span className={`${s.reactionCount} txt-tiny txt-medium`}>{r.count}</span>
          </button>
        </ReactionTooltip>
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
    <div className={`${s.text} txt-body`}>
      <MessageContent content={decrypting ? '...' : messageContent} serverId={serverId} />
      {editedTag}
    </div>
  )

  // Link/video embeds (server-side or client-side generated)
  const embedsBlock = clientEmbeds.length > 0 ? (
    <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {clientEmbeds.map((embed, i) => {
        const videoInfo = parseVideoUrl(embed.url)
        return videoInfo ? (
          <VideoEmbed key={`${embed.url}-${i}`} embed={embed} videoInfo={videoInfo} />
        ) : (
          <LinkEmbed key={`${embed.url}-${i}`} embed={embed} />
        )
      })}
    </div>
  ) : null

  const attachmentsBlock = (message.attachments?.length ?? 0) > 0 ? (
    <MessageAttachments attachments={message.attachments!} />
  ) : null

  // Inline poll renderer. The store updates `message.poll` live via PollUpdate
  // WS events, so this just re-renders when the prop changes.
  const pollBlock = message.poll ? <PollDisplay poll={message.poll} /> : null

  // Thread reply badge — shown when this message is a thread parent (has a
  // thread_id) and at least one reply exists. Clicking opens the right-panel
  // thread view. Threads are server-only — never shown in DMs.
  const threadReplyCount = message.thread_reply_count ?? 0
  const threadBadge = !isDm && message.thread_id && threadReplyCount > 0 && onOpenThread ? (
    <button
      type="button"
      className={s.threadReplyLink}
      onClick={() => onOpenThread(message.thread_id!)}
    >
      <MessageSquare size={11} strokeWidth={1.6} />
      <span className="txt-tiny txt-semibold">
        {threadReplyCount} {threadReplyCount === 1 ? 'reply' : 'replies'} in thread
      </span>
    </button>
  ) : null

  const body = (
    <>
      {replyBlock}
      {textContent}
      {attachmentsBlock}
      {embedsBlock}
      {pollBlock}
      {reactionsBlock}
      {threadBadge}
    </>
  )

  const hasActions = !!(onToggleReaction || onDelete || onReply || onEdit)

  const toolbar = !hasActions ? null : (
    <div className={`${s.actions} ${anyOpen ? s.actionsVisible : ''} ${isDm ? s.actionsDm : ''}`}>
      {/* ── Add reaction (requires ADD_REACTIONS permission) ── */}
      {canAddReactions && (
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
      )}
      {showEmoji && (
        <EmojiPickerPopup
          position={{ top: pickerPos.top, left: pickerPos.left }}
          onSelect={(emoji) => handleReactionClick(emoji)}
          onClose={() => setShowEmoji(false)}
          anchor={emojiTriggerRef}
        />
      )}

      {/* ── Reply ── */}
      {onReply && <button className={s.actionBtn} title="Reply" onClick={onReply}><ReplyIcon /></button>}

      {/* ── Edit (own only) ── */}
      {isOwn && <button className={s.actionBtn} title="Edit message" onClick={startEdit}><EditIcon /></button>}

      {/* ── More options (Shift swaps to instant-delete when user can delete) ── */}
      <div ref={moreRef} className={s.actionWrap}>
        <button
          className={`${s.actionBtn} ${shiftDeleteArmed ? s.dangerBtn : ''}`}
          title={shiftDeleteArmed ? 'Delete message (Shift+click)' : 'More options'}
          onClick={(e) => {
            // Use the actual click event's shift state, not the hook — that
            // way a click never desyncs from what the user thinks they did
            // (e.g. they release Shift mid-click).
            if (canDelete && e.shiftKey) {
              e.stopPropagation()
              handleDelete()
              return
            }
            const r = e.currentTarget.getBoundingClientRect()
            setMoreTriggerPos({ x: r.right, y: r.bottom + 4 })
            setShowMore(v => !v)
            setShowEmoji(false)
          }}
        >
          {shiftDeleteArmed ? <TrashIcon /> : <MoreIcon />}
        </button>
        {showMore && createPortal(
          <div
            ref={moreMenuRef}
            className={s.moreMenu}
            role="menu"
            style={{ position: 'fixed', top: morePos.y, left: morePos.x - 184 }}
          >
            <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onReply?.() }}>
              <ReplyIcon /><span>Reply</span>
            </button>
            {isOwn && (
              <button role="menuitem" className={s.menuItem} onClick={startEdit}>
                <EditIcon /><span>Edit Message</span>
              </button>
            )}
            <button role="menuitem" className={s.menuItem} onClick={handleCopyText}>
              <CopyIcon /><span>Copy Text</span>
            </button>
            {canManageMessages && onPin && (
              <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onPin() }}>
                <PinIcon /><span>{message.is_pinned ? 'Unpin Message' : 'Pin Message'}</span>
              </button>
            )}
            {!isDm && onStartThread && !message.thread_id && (
              <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onStartThread(message.id) }}>
                <ThreadIcon /><span>Start Thread</span>
              </button>
            )}
            {!isDm && message.thread_id && onOpenThread && (
              <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onOpenThread(message.thread_id!) }}>
                <ThreadIcon /><span>Open Thread</span>
              </button>
            )}
            <div className={s.menuDivider} />
            {isOwn ? (
              <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                <TrashIcon /><span>Delete Message</span>
              </button>
            ) : canManageMessages ? (
              <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                <TrashIcon /><span>Delete Message</span>
              </button>
            ) : (
              <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={() => setShowMore(false)}>
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
      <article className={`${s.dmRow} ${isOwn ? s.dmRowOwn : ''}`}>
        <div className={`${s.dmCard} ${isOwn ? s.dmCardOwn : ''}`}>
          {/* Header: sender on left, actions on right */}
          <div className={s.dmHeader}>
            <div className={s.dmHeaderSender}>
              <Avatar url={message.avatarUrl} name={message.author} size="xs" userId={message.author_id} className={s.dmAvatar} color={message.color} />
              <span className={`${s.dmAuthor} txt-body txt-semibold`}>{message.author}</span>
              <span className={`${s.dmTimeBadge} txt-tiny`}>{message.time}</span>
            </div>

            <div className={`${s.dmActions} ${anyOpen ? s.dmActionsVisible : ''}`}>
              {canAddReactions && (
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
              )}
              {showEmoji && (
                <EmojiPickerPopup
                  position={{ top: pickerPos.top, left: pickerPos.left }}
                  onSelect={(emoji) => handleReactionClick(emoji)}
                  onClose={() => setShowEmoji(false)}
                  anchor={emojiTriggerRef}
                />
              )}

              {onReply && <button className={s.dmActionBtn} title="Reply" onClick={onReply}><ReplyIcon /></button>}

              <div ref={moreRef} className={s.actionWrap}>
                <button
                  className={`${s.dmActionBtn} ${shiftDeleteArmed ? s.dangerBtn : ''}`}
                  title={shiftDeleteArmed ? 'Delete message (Shift+click)' : 'More options'}
                  onClick={(e) => {
                    if (canDelete && e.shiftKey) {
                      e.stopPropagation()
                      handleDelete()
                      return
                    }
                    const r = e.currentTarget.getBoundingClientRect()
                    setMoreTriggerPos({ x: r.right, y: r.bottom + 4 })
                    setShowMore(v => !v)
                    setShowEmoji(false)
                  }}
                >
                  {shiftDeleteArmed ? <TrashIcon /> : <MoreIcon />}
                </button>
                {showMore && createPortal(
                  <div
                    ref={moreMenuRef}
                    className={s.moreMenu}
                    style={{ position: 'fixed', top: morePos.y, left: morePos.x - 184 }}
                  >
                    <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onReply?.() }}>
                      <ReplyIcon /><span>Reply</span>
                    </button>
                    {isOwn && (
                      <button role="menuitem" className={s.menuItem} onClick={startEdit}>
                        <EditIcon /><span>Edit Message</span>
                      </button>
                    )}
                    <button role="menuitem" className={s.menuItem} onClick={handleCopyText}>
                      <CopyIcon /><span>Copy Text</span>
                    </button>
                    {canManageMessages && onPin && (
                      <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onPin() }}>
                        <PinIcon /><span>{message.is_pinned ? 'Unpin Message' : 'Pin Message'}</span>
                      </button>
                    )}
                    <div className={s.menuDivider} />
                    {isOwn ? (
                      <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                        <TrashIcon /><span>Delete Message</span>
                      </button>
                    ) : canManageMessages ? (
                      <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                        <TrashIcon /><span>Delete Message</span>
                      </button>
                    ) : (
                      <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={() => setShowMore(false)}>
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
              <div className={`${s.text} txt-body`}>
                <MessageContent content={decrypting ? '...' : messageContent} serverId={serverId} />
                {editedTag}
              </div>
            )}
            {attachmentsBlock}
            {embedsBlock}
            {pollBlock}
          </div>

          {/* Reactions — overlaid on the card's bottom edge */}
          {reactionsBlock && (
            <div className={s.dmReactions}>
              {reactionsBlock}
            </div>
          )}
        </div>
      </article>
    )
  }

  /* ─── Standard channel layout ─── */
  if (message.continued) {
    return (
      <article className={`${s.msg} ${s.continued} ${anyOpen ? s.hasMenu : ''}`}>
        <div className={s.body}>{body}</div>
        {toolbar}
      </article>
    )
  }

  const handleAuthorClick = onOpenAuthorProfile && message.author_id
    ? (e: React.MouseEvent) => onOpenAuthorProfile(message.author_id!, e)
    : undefined

  return (
    <article className={`${s.msg} ${anyOpen ? s.hasMenu : ''}`}>
      <MessageAvatar message={message} onClick={handleAuthorClick} />
      <div className={s.body}>
        <div className={s.meta}>
          {handleAuthorClick ? (
            <button
              type="button"
              className={`${s.author} ${s.authorClickable} txt-body txt-semibold`}
              onClick={handleAuthorClick}
            >{message.author}</button>
          ) : (
            <span className={`${s.author} txt-body txt-semibold`}>{message.author}</span>
          )}
          <time className={`${s.time} txt-tiny`}>{message.time}</time>
          {message.is_pinned && <Pin size={11} strokeWidth={1.4} className={s.pinnedBadge} />}
          {showUnencryptedBadge && <span className={`${s.unencryptedBadge} txt-tiny`}>unencrypted</span>}
        </div>
        {body}
      </div>
      {toolbar}
    </article>
  )
}

/* ─── Icons ─── */
function MessageAvatar({ message, onClick }: { message: MessageVM; onClick?: (e: React.MouseEvent) => void }) {
  const avatar = (
    <Avatar url={message.avatarUrl} name={message.author} size="md" status={null} userId={message.author_id} className={s.avatar} color={message.color} />
  )
  if (!onClick) return avatar
  return (
    <button type="button" onClick={onClick} className={s.avatarClickable} aria-label={`Open profile of ${message.author}`}>
      {avatar}
    </button>
  )
}

function EmojiAddIcon() { return <SmilePlus      size={14} strokeWidth={1.4} /> }
function ReplyIcon()    { return <CornerUpLeft   size={14} strokeWidth={1.4} /> }
function EditIcon()     { return <Pencil         size={14} strokeWidth={1.4} /> }
function MoreIcon()     { return <MoreHorizontal size={14} strokeWidth={1.4} /> }
function CopyIcon()     { return <Copy           size={14} strokeWidth={1.4} /> }
function PinIcon()      { return <Pin            size={14} strokeWidth={1.4} /> }
function TrashIcon()    { return <Trash2         size={14} strokeWidth={1.4} /> }
function FlagIcon()     { return <Flag           size={14} strokeWidth={1.4} /> }
function ThreadIcon()   { return <MessageSquare  size={14} strokeWidth={1.4} /> }
