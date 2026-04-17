import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import {
  Phone, Video, Files, CornerUpLeft, X,
  PanelLeftOpen, AlignLeft, Users, Smile,
  Paperclip, ImagePlay, SendHorizontal,
  Bold, Italic, Strikethrough, Code, Pin,
} from 'lucide-react'
import type { Channel, DMConversation, Message as MessageType, ReplyRef } from '../../types'
import type { User } from '../../api/types'
import { revealDelay, revealWindowMs, CHAT_REVEAL_LIMIT } from '../../utils/animations'
import { Message } from '../Message/Message'
import EmojiPickerPopup from '../EmojiPickerPopup'
import GifPickerPopup from '../GifPickerPopup'
import { searchEmojis, emojiToImgUrl } from '../../utils/emoji'
import { RichInput, type RichInputHandle } from './RichInput'
import { createEmojiImg } from './richInputHelpers'
import s from './ChatArea.module.css'

export interface MentionableUser {
  id: string
  username: string
}

interface Props {
  channel:            Channel
  messages:           MessageType[]
  sidebarCollapsed:   boolean
  rightPanelMode:     'members' | 'pinned' | 'threads' | null
  onExpandSidebar:    () => void
  onSetRightPanelMode: (mode: 'members' | 'pinned' | 'threads' | null) => void
  onSend:             (text: string, replyTo?: ReplyRef, files?: File[]) => void
  onToggleReaction:   (msgId: string, emoji: string) => void
  onDeleteMessage:    (msgId: string) => void
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
  hasPinnedMessages?: boolean
  hasThreads?:        boolean
  serverId?:          string
  userMap?:           Map<string, User>
  mentionableUsers?:  MentionableUser[]
  canManageMessages?: boolean
  canAddReactions?:   boolean
  canSendMessages?:   boolean
  canAttachFiles?:    boolean
}

export function ChatArea({ channel, messages, sidebarCollapsed, rightPanelMode, onExpandSidebar, onSetRightPanelMode, onSend, onToggleReaction, onDeleteMessage, onEditMessage, isDm = false, dmConversation, animationKey, onTyping, onLoadOlder, hasMore, readOnly = false, typingUsers, onPinMessage, serverId, userMap, mentionableUsers = [], canManageMessages = false, canAddReactions = false, canSendMessages = true, canAttachFiles = true, hasPinnedMessages = false, hasThreads = false }: Props) {
  const listRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<RichInputHandle>(null)
  const contentRef = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // System channels are read-only; also hide composer if user lacks SEND_MESSAGES
  const isReadOnly = readOnly || channel.is_system || !canSendMessages

  const [replyingTo,  setReplyingTo]  = useState<MessageType | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)

  // Emoji autocomplete state
  const [emojiQuery, setEmojiQuery]   = useState<string | null>(null)
  const [emojiIndex, setEmojiIndex]   = useState(0)

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  // File attachment state
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  // Tracks previous values to distinguish navigation from message sends
  const prevAnimKeyRef    = useRef<string | null>(null)
  const prevMsgCountRef   = useRef(0)
  const navTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mentionTimerRef   = useRef<ReturnType<typeof setTimeout>>(undefined)
  const scrollBehaviorRef = useRef<ScrollBehavior>('auto')

  useLayoutEffect(() => {
    const prevAnimKey  = prevAnimKeyRef.current
    const prevMsgCount = prevMsgCountRef.current
    prevAnimKeyRef.current  = animationKey
    prevMsgCountRef.current = messages.length

    if (animationKey !== prevAnimKey) {
      if (navTimerRef.current) clearTimeout(navTimerRef.current)
      if (listRef.current) listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      setIsRevealing(true)
      const animCount = Math.min(messages.length, CHAT_REVEAL_LIMIT)
      navTimerRef.current = setTimeout(() => {
        setIsRevealing(false)
        navTimerRef.current = null
      }, revealWindowMs(animCount))
      return
    }

    if (messages.length > prevMsgCount) {
      scrollBehaviorRef.current = 'smooth'
    }
  }, [animationKey, messages])

  useEffect(() => {
    if (!listRef.current || scrollBehaviorRef.current !== 'smooth') return
    listRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    scrollBehaviorRef.current = 'auto'
  }, [messages])

  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current)
    if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current)
  }, [])

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

  // Clear reply context + content when channel changes
  useEffect(() => {
    setReplyingTo(null)
    contentRef.current = ''
    inputRef.current?.clear()
  }, [channel.id])

  // Auto-focus input on channel switch
  useEffect(() => { inputRef.current?.focus() }, [channel.id])

  // ── Emoji autocomplete ──
  const emojiMatches = useMemo(() => {
    if (emojiQuery === null) return []
    return searchEmojis(emojiQuery, 8)
  }, [emojiQuery])

  const insertEmoji = useCallback((emoji: string) => {
    const handle = inputRef.current
    if (!handle) return
    const text = handle.getTextBeforeCursor()
    if (!text) return
    const lastColon = text.lastIndexOf(':')
    if (lastColon === -1) return
    const charCount = text.length - lastColon
    handle.replaceBeforeCursor(charCount, createEmojiImg(emoji))
    setEmojiQuery(null)
    setEmojiIndex(0)
  }, [])

  // ── Mention autocomplete ──
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || mentionableUsers.length === 0) return []
    const q = mentionQuery.toLowerCase()
    return mentionableUsers.filter((u) => u.username.toLowerCase().includes(q)).slice(0, 8)
  }, [mentionQuery, mentionableUsers])

  const insertMention = useCallback((username: string) => {
    const handle = inputRef.current
    if (!handle) return
    const text = handle.getTextBeforeCursor()
    if (!text) return
    const lastAt = text.lastIndexOf('@')
    if (lastAt === -1) return
    const charCount = text.length - lastAt
    handle.replaceBeforeCursor(charCount, `@${username} `)
    setMentionQuery(null)
    setMentionIndex(0)
  }, [])

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

  const syncContent = useCallback((plainText: string) => {
    contentRef.current = plainText
    if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current)
    mentionTimerRef.current = setTimeout(() => {
      const text = inputRef.current?.getTextBeforeCursor() ?? null
      if (text) {
        const lastColon = text.lastIndexOf(':')
        if (lastColon !== -1 && (lastColon === 0 || /\s/.test(text[lastColon - 1]))) {
          const query = text.slice(lastColon + 1)
          if (query.length >= 2 && /^[a-zA-Z0-9_]+$/.test(query)) {
            setEmojiQuery(query); setEmojiIndex(0)
          } else { setEmojiQuery(null) }
        } else { setEmojiQuery(null) }

        const lastAt = text.lastIndexOf('@')
        if (lastAt !== -1 && (lastAt === 0 || /\s/.test(text[lastAt - 1]))) {
          const mQuery = text.slice(lastAt + 1)
          if (!/\s/.test(mQuery)) {
            setMentionQuery(mQuery); setMentionIndex(0)
          } else { setMentionQuery(null) }
        } else { setMentionQuery(null) }
      } else {
        setEmojiQuery(null)
        setMentionQuery(null)
      }
    }, 0)
    onTyping?.()
  }, [onTyping])

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
    if (emojiQuery !== null && emojiMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiIndex((i) => (i + 1) % emojiMatches.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setEmojiIndex((i) => (i - 1 + emojiMatches.length) % emojiMatches.length); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); insertEmoji(emojiMatches[emojiIndex].emoji); return }
      if (e.key === 'Escape') { e.preventDefault(); setEmojiQuery(null); return }
    }
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % mentionMatches.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); insertMention(mentionMatches[mentionIndex].username); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); insertFormatting('**', '**'); return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); insertFormatting('*', '*'); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === 'Escape' && replyingTo) setReplyingTo(null)
  }

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const dmName        = dmConversation?.name ?? (dmConversation ? `@${dmConversation.participants[0].name}` : '')
  const dmFirstP      = dmConversation?.participants[0]
  const inputPlaceholder = isDm
    ? `Message ${dmName}`
    : `Message #${channel.name}`

  return (
    <main className={s.area}>
      <header className={s.header}>
        {sidebarCollapsed && (
          <button className={s.iconBtn} title="Expand channels" onClick={onExpandSidebar}>
            <SidebarIcon />
          </button>
        )}

        {isDm && dmConversation ? (
          <>
            {dmConversation.type === 'group' ? (
              <div className={s.groupAvatars}>
                {dmConversation.participants.slice(0, 2).map((p, i) => (
                  <div
                    key={i}
                    className={`${s.groupAvatar} ${i === 1 ? s.groupAvatarBack : ''}`}
                    style={p.avatarUrl ? undefined : { background: p.color }}
                  >
                    {p.avatarUrl
                      ? <img src={p.avatarUrl} alt="" width={20} height={20} style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} />
                      : p.letter}
                  </div>
                ))}
              </div>
            ) : (
              <div className={s.dmAvatar} style={dmFirstP?.avatarUrl ? undefined : { background: dmFirstP?.color }}>
                {dmFirstP?.avatarUrl
                  ? <img src={dmFirstP.avatarUrl} alt="" width={28} height={28} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
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
              <button className={s.iconBtn} title="Start voice call"><CallIcon /></button>
              <button className={s.iconBtn} title="Start video call"><VideoIcon /></button>
              <div className={s.headerSep} />
            </>
          ) : (
            <>
              {hasThreads && (
                <button
                  className={`${s.iconBtn} ${rightPanelMode === 'threads' ? s.active : ''}`}
                  title="Threads"
                  onClick={() => onSetRightPanelMode(rightPanelMode === 'threads' ? null : 'threads')}
                >
                  <ThreadsIcon />
                </button>
              )}
              {hasPinnedMessages && (
                <button
                  className={`${s.iconBtn} ${rightPanelMode === 'pinned' ? s.active : ''}`}
                  title="Pinned messages"
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
            onClick={() => onSetRightPanelMode(rightPanelMode === 'members' ? null : 'members')}
          >
            {isDm ? <FilesIcon /> : <MembersIcon />}
          </button>
        </div>
      </header>

      <div className={s.chatBody}>
        <div className={`${s.messageList} scrollbar-thin scroll-view-y-chat`} ref={listRef} onScroll={handleScroll}>
          <div className={`${s.messageInner} ${isDm ? s.messageInnerDm : ''}`}>
            <div className={s.dateSeparator}>
              <div className={s.sepLine} />
              <span className={`${s.sepLabel} txt-tiny txt-semibold`}>
                Today · {dateLabel}
              </span>
              <div className={s.sepLine} />
            </div>
            {messages.map((msg, i) => {
              const fromBottom   = messages.length - 1 - i
              const shouldReveal = isRevealing && fromBottom < CHAT_REVEAL_LIMIT
              return (
                <div
                  key={msg.id}
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
                    onEdit={readOnly || channel.is_system ? undefined : (newText) => onEditMessage(msg.id, newText)}
                    onReply={isReadOnly ? undefined : () => { setReplyingTo(msg); inputRef.current?.focus() }}
                    onPin={() => onPinMessage?.(msg.id)}
                    isDm={isDm}
                    serverId={isDm ? undefined : serverId}
                    userMap={userMap}
                    dmParticipantNames={isDm && dmConversation
                      ? Object.fromEntries(dmConversation.participants.map(p => [p.userId ?? p.name, p.name]))
                      : undefined}
                    canManageMessages={canManageMessages}
                    canAddReactions={canAddReactions}
                  />
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
                  />
                )}
              </div>
              <div className={s.inputWrap}>
                <RichInput
                  ref={inputRef}
                  placeholder={inputPlaceholder}
                  onInput={syncContent}
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
                        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (matches server limit)
                        const files = Array.from(e.target.files ?? [])
                        const oversized = files.filter(f => f.size > MAX_FILE_SIZE);
                        if (oversized.length) {
                          alert(`File too large (max 25 MB): ${oversized.map(f => f.name).join(', ')}`);
                        }
                        const valid = files.filter(f => f.size <= MAX_FILE_SIZE);
                        if (valid.length) setPendingFiles(prev => [...prev, ...valid])
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
                      />
                    )}
                  </>
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
function SendIcon()       { return <SendHorizontal size={15} strokeWidth={1.5} /> }
