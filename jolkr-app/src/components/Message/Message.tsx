import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  SmilePlus, CornerUpLeft, Pencil, MoreHorizontal,
  Copy, Pin, Trash2, Flag, MessageSquare,
} from 'lucide-react'
import type { MessageVM } from '../../types'
import type { User, MessageEmbed } from '../../api/types'
import { useDecryptedContent } from '../../hooks/useDecryptedContent'
import { useAuthStore } from '../../stores/auth'
import { useMessageActions } from './useMessageActions'
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
import { DeleteMessageDialog } from '../DeleteMessageDialog/DeleteMessageDialog'
import s from './Message.module.css'

interface Props {
  message:               MessageVM
  onToggleReaction?:     (emoji: string) => void
  /** Hard delete (visible to all members). Author-only on the server. */
  onDelete?:             () => void
  /** Soft-hide for the caller only — DM context only. */
  onHideForMe?:          () => void
  onReply?:              () => void
  onEdit?:               (newText: string) => void
  onPin?:                () => void
  /** Click on author avatar/name → open profile card. */
  onOpenAuthorProfile?:  (authorId: string, e: React.MouseEvent) => void
  isDm?:                 boolean
  /** Group DM (>2 members) — only used to label the "everyone" delete button. */
  isGroupDm?:            boolean
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

export function Message({ message, onToggleReaction, onDelete, onHideForMe, onReply, onEdit, onPin, onOpenAuthorProfile, isDm = false, isGroupDm = false, serverId, userMap, dmParticipantNames, canManageMessages = false, canAddReactions = false, onOpenThread, onStartThread }: Props) {
  const currentUserId = useAuthStore(s => s.user?.id)
  const { isOwn, canHideForMe, canShiftRemove, shiftDeleteArmed } = useMessageActions({
    authorId: message.author_id,
    authorLabel: message.author,
    currentUserId,
    isDm,
    canManageMessages,
    onDelete,
    onHideForMe,
  })
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

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
    if (message.embeds && message.embeds.length > 0) return message.embeds
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
    // Best-effort copy — fall back silently if the OS denies clipboard access
    // (e.g. focus lost, permission revoked). Logged so we can spot a pattern.
    navigator.clipboard.writeText(messageContent).catch((e) => {
      console.warn('[Message.copy] clipboard.writeText failed:', e)
    })
    setShowMore(false)
  }

  function handleDelete() {
    setShowMore(false)
    onDelete?.()
  }

  // In DMs, normal-click delete opens a confirmation dialog so the user can
  // pick "Delete for me" vs. "Delete for everyone". In server channels we
  // keep the existing behaviour (single-step hard delete) because moderators
  // already expect that.
  function handleNormalDeleteClick() {
    setShowMore(false)
    if (isDm) {
      setShowDeleteDialog(true)
    } else {
      onDelete?.()
    }
  }

  // Shift+click on a non-own DM message hides it for the caller only.
  // For everything else (own DM message, server-channel mods) it hard-deletes.
  function handleShiftRemove() {
    if (isDm && !isOwn) {
      onHideForMe?.()
    } else {
      onDelete?.()
    }
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
      <ReplyPreview replyTo={message.replyTo} isDm={message.isDm ?? isDm} />
    </div>
  ) : null

  const reactionsBlock = message.reactions.length > 0 ? (
    <div className={s.reactions}>
      {message.reactions.map((r) => (
        <ReactionTooltip
          key={r.emoji}
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
    <div className={s.embedList}>
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

  const attachmentsBlock = message.attachments && message.attachments.length > 0 ? (
    <MessageAttachments attachments={message.attachments} />
  ) : null

  // Inline poll renderer. The store updates `message.poll` live via PollUpdate
  // WS events, so this just re-renders when the prop changes.
  const pollBlock = message.poll ? <PollDisplay poll={message.poll} /> : null

  // Thread reply badge — shown when this message is a thread parent (has a
  // thread_id) and at least one reply exists. Clicking opens the right-panel
  // thread view. Threads are server-only — never shown in DMs.
  const threadReplyCount = message.thread_reply_count ?? 0
  const threadId = message.thread_id
  const threadBadge = !isDm && threadId && threadReplyCount > 0 && onOpenThread ? (
    <button
      type="button"
      className={s.threadReplyLink}
      onClick={() => onOpenThread(threadId)}
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

  // Single dialog instance shared across the three return paths below — it
  // portals to document.body so its physical position in the tree is moot.
  const deleteDialog = showDeleteDialog ? (
    <DeleteMessageDialog
      isOwn={isOwn}
      isGroup={isGroupDm}
      onClose={() => setShowDeleteDialog(false)}
      onDeleteForEveryone={onDelete}
      onDeleteForMe={() => onHideForMe?.()}
    />
  ) : null

  const hasActions = !!(onToggleReaction || onDelete || onReply || onEdit)

  // Toolbar styling diverges between standard channel and DM card layouts.
  // The structure (reaction picker → reply → more menu) is identical; only
  // the button/container classes and a couple of menu items differ.
  const toolbarRowClass = isDm ? s.dmActions : s.actions
  const toolbarVisibleClass = isDm ? s.dmActionsVisible : s.actionsVisible
  const btnClass = isDm ? s.dmActionBtn : s.actionBtn

  const toolbar = !hasActions ? null : (
    <div className={`${toolbarRowClass} ${anyOpen ? toolbarVisibleClass : ''} ${!isDm ? s.actionsDm : ''}`}>
      {/* ── Add reaction (requires ADD_REACTIONS permission) ── */}
      {canAddReactions && (
      <div className={s.actionWrap}>
        <button
          ref={emojiTriggerRef}
          className={btnClass}
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
      {onReply && <button className={btnClass} title="Reply" onClick={onReply}><ReplyIcon /></button>}

      {/* ── Edit (own only, server channels only — DM exposes Edit only via menu) ── */}
      {!isDm && isOwn && <button className={btnClass} title="Edit message" onClick={startEdit}><EditIcon /></button>}

      {/* ── More options (Shift swaps to instant-delete when user can delete) ── */}
      <div ref={moreRef} className={s.actionWrap}>
        <button
          className={`${btnClass} ${shiftDeleteArmed ? s.dangerBtn : ''}`}
          title={shiftDeleteArmed ? 'Delete message (Shift+click)' : 'More options'}
          onClick={(e) => {
            // Use the actual click event's shift state, not the hook — that
            // way a click never desyncs from what the user thinks they did
            // (e.g. they release Shift mid-click).
            if (canShiftRemove && e.shiftKey) {
              e.stopPropagation()
              handleShiftRemove()
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
            {!isDm && threadId && onOpenThread && (
              <button role="menuitem" className={s.menuItem} onClick={() => { setShowMore(false); onOpenThread(threadId) }}>
                <ThreadIcon /><span>Open Thread</span>
              </button>
            )}
            <div className={s.menuDivider} />
            {isOwn ? (
              <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={handleNormalDeleteClick}>
                <TrashIcon /><span>Delete Message</span>
              </button>
            ) : canManageMessages ? (
              <button role="menuitem" className={`${s.menuItem} ${s.danger}`} onClick={handleDelete}>
                <TrashIcon /><span>Delete Message</span>
              </button>
            ) : isDm && canHideForMe ? (
              <button
                role="menuitem"
                className={`${s.menuItem} ${s.danger}`}
                onClick={() => { setShowMore(false); onHideForMe?.() }}
              >
                <TrashIcon /><span>Delete for me</span>
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
      <>
      <article className={`${s.dmRow} ${isOwn ? s.dmRowOwn : ''}`}>
        <div className={`${s.dmCard} ${isOwn ? s.dmCardOwn : ''}`}>
          {/* Header: sender on left, shared toolbar on right */}
          <div className={s.dmHeader}>
            <div className={s.dmHeaderSender}>
              <Avatar url={message.avatarUrl} name={message.author} size="xs" userId={message.author_id} className={s.dmAvatar} color={message.color} />
              <span className={`${s.dmAuthor} txt-body txt-semibold`}>{message.author}</span>
              <span className={`${s.dmTimeBadge} txt-tiny`}>{message.time}</span>
            </div>
            {toolbar}
          </div>

          {/* Body */}
          <div className={s.dmBody}>
            {replyBlock}
            {textContent}
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
      {deleteDialog}
      </>
    )
  }

  /* ─── Standard channel layout ─── */
  if (message.continued) {
    return (
      <>
      <article className={`${s.msg} ${s.continued} ${anyOpen ? s.hasMenu : ''}`}>
        <div className={s.body}>{body}</div>
        {toolbar}
      </article>
      {deleteDialog}
      </>
    )
  }

  const authorId = message.author_id
  const handleAuthorClick = onOpenAuthorProfile && authorId
    ? (e: React.MouseEvent) => onOpenAuthorProfile(authorId, e)
    : undefined

  return (
    <>
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
    {deleteDialog}
    </>
  )
}

function ReplyPreview({ replyTo, isDm }: { replyTo: NonNullable<MessageVM['replyTo']>; isDm: boolean }) {
  const { displayContent, decrypting } = useDecryptedContent(
    replyTo.text,
    replyTo.nonce ?? null,
    isDm,
    replyTo.channelId ?? '',
  )
  const text = decrypting ? '…' : (displayContent || '')
  const trimmed = text.length > 80 ? text.slice(0, 80) + '…' : text
  return <span className={`${s.replyPreview} txt-tiny`}>{trimmed}</span>
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
