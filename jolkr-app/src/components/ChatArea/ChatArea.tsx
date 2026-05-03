import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import {
  Phone, Video, Files, CornerUpLeft, X,
  PanelLeftOpen, AlignLeft, Users, Smile,
  Paperclip, ImagePlay, SendHorizontal,
  Bold, Italic, Strikethrough, Code, Pin, BarChart3,
} from 'lucide-react'
import type { ChannelDisplay, DMConversation, MessageVM, ReplyRef } from '../../types'
import type { User } from '../../api/types'
import { revealDelay, revealWindowMs, CHAT_REVEAL_LIMIT } from '../../utils/animations'
import { MAX_ATTACHMENT_BYTES } from '../../utils/constants'
import { formatDayLabel, dayKey } from '../../utils/dateFormat'
import { Message } from '../Message/Message'
import EmojiPickerPopup from '../EmojiPickerPopup/EmojiPickerPopup'
import GifPickerPopup from '../GifPickerPopup'
import { emojiToImgUrl } from '../../utils/emoji'
import { RichInput, type RichInputHandle } from './RichInput'
import { useAutocomplete } from './useAutocomplete'
import { PollCreator } from '../Poll/PollCreator'
import { useCallStore } from '../../stores/call'
import { useVoiceStore } from '../../stores/voice'
import s from './ChatArea.module.css'

export interface MentionableUser {
  id: string
  username: string
}

interface Props {
  channel:            ChannelDisplay
  messages:           MessageVM[]
  sidebarCollapsed:   boolean
  rightPanelMode:     'members' | 'pinned' | 'threads' | null
  onExpandSidebar:    () => void
  onSetRightPanelMode: (mode: 'members' | 'pinned' | 'threads' | null) => void
  onSend:             (text: string, replyTo?: ReplyRef, files?: File[]) => void
  onToggleReaction:   (msgId: string, emoji: string) => void
  onDeleteMessage:    (msgId: string) => void
  /** Soft-hide a DM message for the caller only — DM context only. */
  onHideMessage?:     (msgId: string) => void
  onEditMessage:      (msgId: string, newText: string) => void
  isDm?:              boolean
  dmConversation?:    DMConversation
  animationKey:       string
  onTyping?:          () => void
  onLoadOlder?:       () => void
  hasMore?:           boolean
  readOnly?:          boolean
  typingUsers?:       string[]
  onPinMessage?:      (msgId: string) => void
  /** Click on a message author's avatar/name → open profile card. */
  onOpenAuthorProfile?: (authorId: string, e: React.MouseEvent) => void
  hasPinnedMessages?: boolean
  hasThreads?:        boolean
  serverId?:          string
  userMap?:           Map<string, User>
  mentionableUsers?:  MentionableUser[]
  canManageMessages?: boolean
  canAddReactions?:   boolean
  canSendMessages?:   boolean
  canAttachFiles?:    boolean
  /** Open the right-panel thread view for an existing thread. */
  onOpenThread?:      (threadId: string) => void
  /** Start a new thread off a parent message (server channels only). */
  onStartThread?:     (messageId: string) => void
}

export function ChatArea({ channel, messages, sidebarCollapsed, rightPanelMode, onExpandSidebar, onSetRightPanelMode, onSend, onToggleReaction, onDeleteMessage, onHideMessage, onEditMessage, isDm = false, dmConversation, animationKey, onTyping, onLoadOlder, hasMore, readOnly = false, typingUsers, onPinMessage, onOpenAuthorProfile, serverId, userMap, mentionableUsers = [], canManageMessages = false, canAddReactions = false, canSendMessages = true, canAttachFiles = true, hasPinnedMessages = false, hasThreads = false, onOpenThread, onStartThread }: Props) {
  const listRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<RichInputHandle>(null)
  const contentRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // System channels are read-only; also hide composer if user lacks SEND_MESSAGES
  const isReadOnly = readOnly || channel.is_system || !canSendMessages

  const [replyingTo,  setReplyingTo]  = useState<MessageVM | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)

  // File attachment state
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  // Drag & drop state. We use a counter to handle the dragenter/leave bubble
  // pattern — a single ref-counted depth lets us correctly detect "actually
  // left the chat area" vs. "moved between two child elements".
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragDepthRef = useRef(0)

  // Limit + filter helper shared by the file picker and drop handler.
  const acceptValidFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming)
    const oversized = list.filter((f) => f.size > MAX_ATTACHMENT_BYTES)
    if (oversized.length) {
      alert(`File too large (max 25 MB): ${oversized.map((f) => f.name).join(', ')}`)
    }
    const valid = list.filter((f) => f.size <= MAX_ATTACHMENT_BYTES)
    if (valid.length) setPendingFiles((prev) => [...prev, ...valid])
  }, [])

  // Tracks previous values to distinguish navigation from message sends
  const prevMsgCountRef   = useRef(0)
  const scrollBehaviorRef = useRef<ScrollBehavior>('auto')

  // Flip the reveal animation on synchronously when navigating to a new
  // channel/DM. Detecting the change in render keeps a single coherent
  // render cycle instead of an effect-driven double-render flicker.
  const [prevAnimKey, setPrevAnimKey] = useState(animationKey)
  if (prevAnimKey !== animationKey) {
    setPrevAnimKey(animationKey)
    setIsRevealing(true)
  }

  // Clear the reveal flag after the animation window expires. Re-runs only
  // when isRevealing flips to true; the cleanup cancels the timer if a
  // second navigation lands before the first finishes.
  useEffect(() => {
    if (!isRevealing) return
    const animCount = Math.min(messages.length, CHAT_REVEAL_LIMIT)
    const timer = setTimeout(() => setIsRevealing(false), revealWindowMs(animCount))
    return () => clearTimeout(timer)
  }, [isRevealing, messages.length, setIsRevealing])

  // Scroll to top on channel/DM navigation.
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
  }, [animationKey])

  // Track message count to flag a smooth-scroll on the next paint when new
  // messages arrive (vs. initial load).
  useLayoutEffect(() => {
    const prevMsgCount = prevMsgCountRef.current
    prevMsgCountRef.current = messages.length
    if (messages.length > prevMsgCount) {
      scrollBehaviorRef.current = 'smooth'
    }
  }, [messages])

  useEffect(() => {
    if (!listRef.current || scrollBehaviorRef.current !== 'smooth') return
    listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    scrollBehaviorRef.current = 'auto'
  }, [messages])

  function handleScroll() {
    if (!listRef.current || !hasMore || !onLoadOlder) return
    const el = listRef.current
    if (el.scrollHeight + el.scrollTop - el.clientHeight < 100) onLoadOlder()
  }

  const [fmtBar, setFmtBar] = useState<{ top: number; left: number } | null>(null)
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const [composerEmojiPos, setComposerEmojiPos] = useState<{ top: number; left: number } | null>(null)
  const composerEmojiBtnRef = useRef<HTMLButtonElement>(null)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [gifPickerPos, setGifPickerPos] = useState<{ top: number; left: number } | null>(null)
  const gifBtnRef = useRef<HTMLButtonElement>(null)
  // Poll creator modal — server channels only (gated on !isDm).
  const [pollCreatorOpen, setPollCreatorOpen] = useState(false)

  // Clear reply context synchronously on channel switch — the ref + input
  // resets stay in an effect since they're side-effects on imperative APIs.
  const [prevChannelId, setPrevChannelId] = useState(channel.id)
  if (prevChannelId !== channel.id) {
    setPrevChannelId(channel.id)
    setReplyingTo(null)
  }

  useEffect(() => {
    contentRef.current = ''
    inputRef.current?.clear()
    inputRef.current?.focus()
  }, [channel.id])

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
  }, [])

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

  // `participants[0]` can be undefined for one-sided DMs — e.g. when the other
  // member just closed it and a DmUpdate with only the current user as
  // remaining member arrived. Use the optional chain so the chat doesn't crash.
  const dmFirstP      = dmConversation?.participants[0]
  const dmName        = dmConversation?.name ?? (dmFirstP ? `@${dmFirstP.name}` : '')
  const inputPlaceholder = isDm
    ? `Message ${dmName}`
    : `Message #${channel.name}`

  // ── Voice call wiring (DM) ───────────────────────────────────────
  // Works for both 1-on-1 and group DMs. The SFU treats `dm_id` as a room id
  // and routes audio between any number of participants, so group calls are
  // an N-way join into the same room. E2EE is only derived for 1-on-1 calls
  // (where there's a single peer to do the X25519/ML-KEM handshake against);
  // group calls fall back to DTLS-SRTP only.
  const isGroupDm = isDm && dmConversation?.type === 'group'
  const recipientUserId = !isGroupDm ? dmFirstP?.userId : undefined
  const activeCallDmId = useCallStore((st) => st.activeCallDmId)
  const incomingCall   = useCallStore((st) => st.incomingCall)
  const outgoingCall   = useCallStore((st) => st.outgoingCall)
  const startCall      = useCallStore((st) => st.startCall)
  const voiceState     = useVoiceStore((st) => st.connectionState)
  const inAnyCall      = !!activeCallDmId || !!outgoingCall || !!incomingCall || voiceState !== 'disconnected'
  const callDisabled      = !isDm || !dmConversation || inAnyCall
  const videoCallDisabled = callDisabled || isGroupDm
  const callTitle         = inAnyCall ? 'Already in a call' : 'Start voice call'
  const videoCallTitle    = inAnyCall
    ? 'Already in a call'
    : isGroupDm
      ? 'Video calls are 1-on-1 only'
      : 'Start video call'

  const handleStartCall = useCallback(() => {
    if (callDisabled || !dmConversation) return
    void startCall(dmConversation.id, dmName, recipientUserId)
  }, [callDisabled, dmConversation, dmName, recipientUserId, startCall])

  const handleStartVideoCall = useCallback(() => {
    if (videoCallDisabled || !dmConversation) return
    void startCall(dmConversation.id, dmName, recipientUserId, { video: true })
  }, [videoCallDisabled, dmConversation, dmName, recipientUserId, startCall])

  // Only treat drags that actually carry files as attachable — a regular
  // text/HTML drag (e.g. dragging a message link around) shouldn't show the
  // overlay.
  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files')

  function handleDragEnter(e: React.DragEvent) {
    if (!canAttachFiles || !dragHasFiles(e)) return
    e.preventDefault()
    dragDepthRef.current += 1
    setIsDraggingFiles(true)
  }
  function handleDragOver(e: React.DragEvent) {
    if (!canAttachFiles || !dragHasFiles(e)) return
    e.preventDefault()
    // 'move' suppresses the green "+ Copy" badge that Windows attaches when
    // dropEffect is 'copy' — the OS still owns the cursor at the system
    // level for native file drags, but we apply `cursor: grabbing` on the
    // drop area below as a best-effort override (browsers honour it in some
    // cases). 'none' would also remove the badge but blocks the drop.
    e.dataTransfer.dropEffect = 'move'
  }
  function handleDragLeave(e: React.DragEvent) {
    if (!canAttachFiles || !dragHasFiles(e)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDraggingFiles(false)
  }
  function handleDrop(e: React.DragEvent) {
    if (!canAttachFiles || !dragHasFiles(e)) return
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDraggingFiles(false)
    if (e.dataTransfer.files.length > 0) {
      acceptValidFiles(e.dataTransfer.files)
    }
  }

  return (
    <main
      className={`${s.area} ${isDraggingFiles && canAttachFiles ? s.areaDragging : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFiles && canAttachFiles && (
        <div className={s.dropOverlay} aria-hidden>
          <div className={s.dropBox}>
            <Paperclip size={28} strokeWidth={1.5} />
            <span className="txt-body txt-semibold">Drop to attach</span>
            <span className={`${s.dropHint} txt-small`}>Up to 25 MB per file</span>
          </div>
        </div>
      )}
      <header className={s.header}>
        {sidebarCollapsed && (
          <button className={s.iconBtn} title="Expand channels" aria-label="Expand channels" onClick={onExpandSidebar}>
            <SidebarIcon />
          </button>
        )}

        {isDm && dmConversation ? (
          <>
            {dmConversation.type === 'group' ? (
              <div className={s.groupAvatars}>
                {dmConversation.participants.slice(0, 2).map((p, i) => (
                  <div
                    key={p.userId ?? `${p.name}-${i}`}
                    className={`${s.groupAvatar} ${i === 1 ? s.groupAvatarBack : ''}`}
                    style={p.avatarUrl ? undefined : { background: p.color }}
                  >
                    {p.avatarUrl
                      ? <img src={p.avatarUrl} alt={`${p.name} avatar`} width={20} height={20} style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} />
                      : p.letter}
                  </div>
                ))}
              </div>
            ) : (
              <div className={s.dmAvatar} style={dmFirstP?.avatarUrl ? undefined : { background: dmFirstP?.color }}>
                {dmFirstP?.avatarUrl
                  ? <img src={dmFirstP.avatarUrl} alt={dmFirstP.name ? `${dmFirstP.name} avatar` : ''} width={28} height={28} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  : dmFirstP?.letter}
                <span className={`${s.dmStatusDot} ${s[dmFirstP?.status ?? 'offline']}`} />
              </div>
            )}
            <span className={`${s.headerName} txt-body txt-semibold`}>{dmName}</span>
          </>
        ) : (
          <>
            <span className={`${s.headerIcon} ${!sidebarCollapsed ? s.headerIconPadded : ''}`}>{channel.icon === '#' ? '#' : channel.icon}</span>
            <span className={`${s.headerName} txt-body txt-semibold`}>{channel.name}</span>
            <div className={s.headerDivider} />
            <span className={`${s.headerDesc} txt-small txt-truncate`}>{channel.desc}</span>
          </>
        )}

        <div className={s.headerActions}>
          {isDm ? (
            <>
              <button
                className={`${s.iconBtn} ${callDisabled ? s.iconBtnDisabled : ''}`}
                title={callTitle}
                aria-label={callTitle}
                disabled={callDisabled}
                onClick={handleStartCall}
              >
                <CallIcon />
              </button>
              <button
                className={`${s.iconBtn} ${videoCallDisabled ? s.iconBtnDisabled : ''}`}
                title={videoCallTitle}
                aria-label={videoCallTitle}
                disabled={videoCallDisabled}
                onClick={handleStartVideoCall}
              >
                <VideoIcon />
              </button>
              <div className={s.headerSep} />
            </>
          ) : (
            <>
              {hasThreads && (
                <button
                  className={`${s.iconBtn} ${rightPanelMode === 'threads' ? s.active : ''}`}
                  title="Threads"
                  aria-label="Toggle threads panel"
                  onClick={() => onSetRightPanelMode(rightPanelMode === 'threads' ? null : 'threads')}
                >
                  <ThreadsIcon />
                </button>
              )}
              {hasPinnedMessages && (
                <button
                  className={`${s.iconBtn} ${rightPanelMode === 'pinned' ? s.active : ''}`}
                  title="Pinned messages"
                  aria-label="Toggle pinned messages panel"
                  onClick={() => onSetRightPanelMode(rightPanelMode === 'pinned' ? null : 'pinned')}
                >
                  <Pin size={14} strokeWidth={1.5} />
                </button>
              )}
            </>
          )}
          <button
            className={`${s.iconBtn} ${rightPanelMode === 'members' ? s.active : ''}`}
            title={isDm ? 'Files & pins' : 'Members'}
            aria-label={isDm ? 'Toggle files and pins panel' : 'Toggle members panel'}
            onClick={() => onSetRightPanelMode(rightPanelMode === 'members' ? null : 'members')}
          >
            {isDm ? <FilesIcon /> : <MembersIcon />}
          </button>
        </div>
      </header>

      <div className={s.chatBody}>
        <div className={`${s.messageList} scrollbar-thin scroll-view-y-chat`} ref={listRef} onScroll={handleScroll}>
          {messages.length === 0 ? (
            <div className={s.chatEmpty}>
              <div className={s.chatEmptyIcon}>{isDm ? '💬' : '👋'}</div>
              <h2 className={`${s.chatEmptyTitle} txt-body txt-semibold`}>
                {isDm
                  ? `No messages yet with ${dmConversation?.name ?? dmConversation?.participants[0]?.name ?? 'this user'}`
                  : `Welcome to #${channel.name}`}
              </h2>
              <p className={`${s.chatEmptyText} txt-small`}>
                {isDm
                  ? 'Send a message below to start the conversation.'
                  : 'Be the first to say something — type a message below to get the channel going.'}
              </p>
            </div>
          ) : null}
          <div className={`${s.messageInner} ${isDm ? s.messageInnerDm : ''}`}>
            {messages.map((msg, i) => {
              const fromBottom   = messages.length - 1 - i
              const shouldReveal = isRevealing && fromBottom < CHAT_REVEAL_LIMIT
              const prevDay = i > 0 ? dayKey(messages[i - 1].created_at) : ''
              const thisDay = dayKey(msg.created_at)
              // Insert a separator at the very first message and whenever the
              // day changes between consecutive messages.
              const showSeparator = thisDay !== '' && thisDay !== prevDay
              return (
                <div key={msg.id}>
                  {showSeparator && (
                    <div className={s.dateSeparator}>
                      <div className={s.sepLine} />
                      <span className={`${s.sepLabel} txt-tiny txt-semibold`}>
                        {formatDayLabel(msg.created_at)}
                      </span>
                      <div className={s.sepLine} />
                    </div>
                  )}
                  <div
                    className={shouldReveal ? 'revealing' : undefined}
                    style={shouldReveal
                      ? { '--reveal-delay': `${revealDelay(fromBottom)}ms` } as React.CSSProperties
                      : undefined
                    }
                  >
                    <Message
                      message={msg}
                      onToggleReaction={readOnly || channel.is_system || !canAddReactions ? undefined : (emoji) => onToggleReaction(msg.id, emoji)}
                      onDelete={() => onDeleteMessage(msg.id)}
                      onHideForMe={isDm && onHideMessage ? () => onHideMessage(msg.id) : undefined}
                      onEdit={readOnly || channel.is_system ? undefined : (newText) => onEditMessage(msg.id, newText)}
                      onReply={isReadOnly ? undefined : () => { setReplyingTo(msg); inputRef.current?.focus() }}
                      onPin={() => onPinMessage?.(msg.id)}
                      onOpenAuthorProfile={onOpenAuthorProfile}
                      isDm={isDm}
                      isGroupDm={isDm && (dmConversation?.participants.length ?? 0) > 2}
                      serverId={isDm ? undefined : serverId}
                      userMap={userMap}
                      dmParticipantNames={isDm && dmConversation
                        ? Object.fromEntries(dmConversation.participants.map(p => [p.userId ?? p.name, p.name]))
                        : undefined}
                      canManageMessages={canManageMessages}
                      canAddReactions={canAddReactions}
                      onOpenThread={!isDm && onOpenThread ? onOpenThread : undefined}
                      onStartThread={!isDm && onStartThread ? onStartThread : undefined}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className={s.spacer} />
        </div>

        {typingUsers && typingUsers.length > 0 && (
          <div className={s.typingIndicator}>
            <span className={s.typingDots}>
              <span className={s.dot} />
              <span className={s.dot} />
              <span className={s.dot} />
            </span>
            <span className={`${s.typingText} txt-tiny`}>
              {typingUsers.length === 1
                ? <><strong>{typingUsers[0]}</strong> is typing...</>
                : typingUsers.length === 2
                ? <><strong>{typingUsers[0]}</strong> and <strong>{typingUsers[1]}</strong> are typing...</>
                : <>Several people are typing...</>
              }
            </span>
          </div>
        )}

        {isReadOnly ? (
          <div className={s.composerWrap}>
            <div className={`${s.composer} ${s.readOnly}`} style={{ padding: '.725rem .625rem' }}>
              <span className="txt-small" style={{ opacity: 0.4, textAlign: 'center', width: '100%' }}>
                {channel.is_system ? 'This is a system channel' : !canSendMessages ? 'You do not have permission to send messages in this channel' : 'This is a read-only channel'}
              </span>
            </div>
          </div>
        ) : (
        <div className={s.composerWrap}>
          <div className={s.composerStack}>
            {replyingTo && (
              <div className={s.replyCard}>
                <div className={s.replyCardInner}>
                  <ReplySmallIcon />
                  <span className={`${s.replyCardLabel} txt-tiny`}>
                    Replying to <strong>{replyingTo.author}</strong>
                  </span>
                  <span className={`${s.replyCardPreview} txt-tiny`}>
                    {replyingTo.content.length > 72 ? replyingTo.content.slice(0, 72) + '…' : replyingTo.content}
                  </span>
                </div>
                <button className={s.replyCardClose} title="Cancel reply" onClick={() => setReplyingTo(null)}>
                  <CloseIcon />
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
                      <div className={s.pendingFileIcon}><AttachIcon /></div>
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
              <div style={{ position: 'relative' }}>
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
                  <EmojiIcon />
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
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files) acceptValidFiles(e.target.files)
                        e.target.value = ''
                      }}
                    />
                    <button className={s.composerBtn} title="Attach file" onClick={() => fileInputRef.current?.click()}>
                      <AttachIcon />
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
                      <GifIcon />
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
                    <PollIcon />
                  </button>
                )}
                <button className={s.sendBtn} title="Send (Enter)" onClick={send}>
                  <SendIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
      {!isDm && (
        <PollCreator
          open={pollCreatorOpen}
          channelId={channel.id}
          onClose={() => setPollCreatorOpen(false)}
        />
      )}
    </main>
  )
}

function CallIcon()       { return <Phone         size={14} strokeWidth={1.5} /> }
function VideoIcon()      { return <Video         size={14} strokeWidth={1.5} /> }
function FilesIcon()      { return <Files         size={14} strokeWidth={1.5} /> }
function ReplySmallIcon() { return <CornerUpLeft  size={12} strokeWidth={1.5} /> }
function CloseIcon()      { return <X             size={11} strokeWidth={1.75} /> }
function SidebarIcon()    { return <PanelLeftOpen size={14} strokeWidth={1.5} /> }
function ThreadsIcon()    { return <AlignLeft     size={14} strokeWidth={1.5} /> }
function MembersIcon()    { return <Users         size={14} strokeWidth={1.5} /> }
function EmojiIcon()      { return <Smile         size={15} strokeWidth={1.25} /> }
function AttachIcon()     { return <Paperclip     size={15} strokeWidth={1.25} /> }
function GifIcon()        { return <ImagePlay     size={15} strokeWidth={1.25} /> }
function PollIcon()       { return <BarChart3     size={15} strokeWidth={1.25} /> }
function SendIcon()       { return <SendHorizontal size={15} strokeWidth={1.5} /> }
