import { useState, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from 'react'
import {
  Phone, Video, Files, CornerUpLeft, X,
  PanelLeftOpen, AlignLeft, Users, Smile,
  Paperclip, ImagePlay, SendHorizontal,
  Bold, Italic, Strikethrough, Code,
} from 'lucide-react'
import type { Channel, DMConversation, Message as MessageType, ReplyRef } from '../../types'
import { revealDelay, revealWindowMs, CHAT_REVEAL_LIMIT } from '../../utils/animations'
import { createPortal } from 'react-dom'
import { Message } from '../Message/Message'
import s from './ChatArea.module.css'

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'))

interface Props {
  channel:            Channel
  messages:           MessageType[]
  sidebarCollapsed:   boolean
  membersVisible:     boolean
  onExpandSidebar:    () => void
  onToggleMembers:    () => void
  onSend:             (text: string, replyTo?: ReplyRef) => void
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
}

export function ChatArea({ channel, messages, sidebarCollapsed, membersVisible, onExpandSidebar, onToggleMembers, onSend, onToggleReaction, onDeleteMessage, onEditMessage, isDm = false, dmConversation, animationKey, onTyping, onLoadOlder, hasMore, readOnly = false }: Props) {
  const listRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)

  const [replyingTo,  setReplyingTo]  = useState<MessageType | null>(null)
  const [isRevealing, setIsRevealing] = useState(false)

  // Tracks previous values to distinguish navigation from message sends
  const prevAnimKeyRef    = useRef<string | null>(null) // null = sentinel for first mount
  const prevMsgCountRef   = useRef(0)
  const navTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 'smooth' signals the scroll effect to slide to the new message; 'auto' = skip
  const scrollBehaviorRef = useRef<ScrollBehavior>('auto')

  useLayoutEffect(() => {
    const prevAnimKey  = prevAnimKeyRef.current
    const prevMsgCount = prevMsgCountRef.current
    prevAnimKeyRef.current  = animationKey
    prevMsgCountRef.current = messages.length

    if (animationKey !== prevAnimKey) {
      // Navigation (first mount, channel/server/DM switch):
      // jump to bottom instantly before paint so the stagger reveal starts correctly
      if (navTimerRef.current) clearTimeout(navTimerRef.current)
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      setIsRevealing(true)
      const animCount = Math.min(messages.length, CHAT_REVEAL_LIMIT)
      navTimerRef.current = setTimeout(() => {
        setIsRevealing(false)
        navTimerRef.current = null
      }, revealWindowMs(animCount))
      return
    }

    if (messages.length > prevMsgCount) {
      // New message sent — signal the scroll effect to slide smoothly to it
      scrollBehaviorRef.current = 'smooth'
    }
  }, [animationKey, messages])

  // Smooth scroll when a message is sent; navigation is handled in the layout effect above
  useEffect(() => {
    if (!listRef.current || scrollBehaviorRef.current !== 'smooth') return
    listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    scrollBehaviorRef.current = 'auto'
  }, [messages])

  // Cleanup nav timer on unmount
  useEffect(() => () => {
    if (navTimerRef.current) clearTimeout(navTimerRef.current)
  }, [])


  // Load older messages when scrolling to top
  function handleScroll() {
    if (!listRef.current || !hasMore || !onLoadOlder) return
    if (listRef.current.scrollTop < 100) onLoadOlder()
  }

  const [fmtBar, setFmtBar] = useState<{ top: number; left: number } | null>(null)
  const [showComposerEmoji, setShowComposerEmoji] = useState(false)
  const composerEmojiRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)

  // Close composer emoji on outside click
  useEffect(() => {
    if (!showComposerEmoji) return
    function handleClick(e: MouseEvent) {
      if (composerEmojiRef.current && !composerEmojiRef.current.contains(e.target as Node)) {
        setShowComposerEmoji(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showComposerEmoji])

  // Clear reply context when channel changes
  useEffect(() => { setReplyingTo(null) }, [channel.id])

  const checkSelection = useCallback(() => {
    const sel = window.getSelection()
    if (
      !sel || sel.isCollapsed || !sel.rangeCount ||
      !inputRef.current?.contains(sel.anchorNode)
    ) {
      setFmtBar(null)
      savedRange.current = null
      return
    }
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()
    if (rect.width === 0) { setFmtBar(null); return }
    savedRange.current = range.cloneRange()
    setFmtBar({ top: rect.top - 6, left: rect.left + rect.width / 2 })
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', checkSelection)
    return () => document.removeEventListener('selectionchange', checkSelection)
  }, [checkSelection])

  function wrapSelection(before: string, after: string) {
    const sel = window.getSelection()
    const range = savedRange.current
    if (!sel || !range || !inputRef.current) return

    const text = range.toString()
    if (!text) return

    sel.removeAllRanges()
    sel.addRange(range)
    range.deleteContents()
    const node = document.createTextNode(before + text + after)
    range.insertNode(node)

    const newRange = document.createRange()
    newRange.setStart(node, before.length)
    newRange.setEnd(node, before.length + text.length)
    sel.removeAllRanges()
    sel.addRange(newRange)

    setFmtBar(null)
    savedRange.current = null
    inputRef.current.focus()
  }

  function send() {
    const text = inputRef.current?.innerText.trim() ?? ''
    if (!text) return
    const replyRef = replyingTo ? { id: replyingTo.id, author: replyingTo.author, text: replyingTo.content } : undefined
    onSend(text, replyRef)
    if (inputRef.current) inputRef.current.innerText = ''
    setReplyingTo(null)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
    if (e.key === 'Escape' && replyingTo) {
      setReplyingTo(null)
    }
  }

  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const dmName        = dmConversation?.name ?? (dmConversation ? `@${dmConversation.participants[0].name}` : '')
  const dmFirstP      = dmConversation?.participants[0]
  const inputPlaceholder = isDm
    ? `Message ${dmName}`
    : `Message #${channel.name}`

  return (
    <main className={s.area}>
      {/* Header — always full width */}
      <div className={s.header}>
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
            <button className={s.iconBtn} title="Thread view">
              <ThreadsIcon />
            </button>
          )}
          <button
            className={`${s.iconBtn} ${membersVisible ? s.active : ''}`}
            title={isDm ? 'Files & pins' : 'Members'}
            onClick={onToggleMembers}
          >
            {isDm ? <FilesIcon /> : <MembersIcon />}
          </button>
        </div>
      </div>

      {/* Centered body — messages + composer */}
      <div className={s.chatBody}>
        <div className={`${s.messageList} scrollbar-thin`} ref={listRef} onScroll={handleScroll}>
          <div className={s.spacer} />
          <div className={`${s.messageInner} ${isDm ? s.messageInnerDm : ''}`}>
            <div className={s.dateSeparator}>
              <div className={s.sepLine} />
              <span className={`${s.sepLabel} txt-tiny txt-semibold`}>
                Today · {dateLabel}
              </span>
              <div className={s.sepLine} />
            </div>
            {messages.map((msg, i) => {
              // Bottom-up stagger on navigation; messages added by sends are not animated
              // — they appear below the fold and slide in via smooth scroll instead.
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
                    onToggleReaction={readOnly ? undefined : (emoji) => onToggleReaction(msg.id, emoji)}
                    onDelete={readOnly ? undefined : () => onDeleteMessage(msg.id)}
                    onEdit={readOnly ? undefined : (newText) => onEditMessage(msg.id, newText)}
                    onReply={readOnly ? undefined : () => { setReplyingTo(msg); inputRef.current?.focus() }}
                    isDm={isDm}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {readOnly ? (
          <div className={s.composerWrap}>
            <div className={`${s.composer} ${s.readOnly}`} style={{ padding: '.725rem .625rem' }}>
              <span className="txt-small" style={{ opacity: 0.4, textAlign: 'center', width: '100%' }}>
                This is a read-only channel
              </span>
            </div>
          </div>
        ) : (
        <div className={s.composerWrap}>
          <div className={s.composerStack}>
            {/* ── Reply card — slides up from behind the composer ── */}
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

            {/* ── Composer — sits in front of reply card ── */}
            <div className={s.composer}>
              {fmtBar && (
                <div
                  className={s.fmtBar}
                  style={{ top: fmtBar.top, left: fmtBar.left }}
                  onMouseDown={e => e.preventDefault()}
                >
                  <button className={s.fmtBtn} title="Bold" onClick={() => wrapSelection('**', '**')}>
                    <Bold size={14} strokeWidth={2} />
                  </button>
                  <button className={s.fmtBtn} title="Italic" onClick={() => wrapSelection('*', '*')}>
                    <Italic size={14} strokeWidth={2} />
                  </button>
                  <button className={s.fmtBtn} title="Strikethrough" onClick={() => wrapSelection('~~', '~~')}>
                    <Strikethrough size={14} strokeWidth={2} />
                  </button>
                  <button className={s.fmtBtn} title="Code" onClick={() => wrapSelection('`', '`')}>
                    <Code size={14} strokeWidth={2} />
                  </button>
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <button className={s.emojiBtn} title="Emoji" onClick={() => setShowComposerEmoji(v => !v)}>
                  <EmojiIcon />
                </button>
                {showComposerEmoji && createPortal(
                  <div ref={composerEmojiRef} style={{ position: 'fixed', bottom: '4.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999 }}>
                    <Suspense fallback={<div style={{ width: 350, height: 400, background: 'var(--surface-raised)', borderRadius: '0.75rem' }} />}>
                      <LazyEmojiPicker
                        onEmojiClick={(emojiData) => {
                          if (inputRef.current) {
                            inputRef.current.innerText += emojiData.emoji
                            inputRef.current.focus()
                          }
                          setShowComposerEmoji(false)
                        }}
                        theme={'dark' as import('emoji-picker-react').Theme}
                        width={350}
                        height={400}
                        searchPlaceholder="Search emoji..."
                        lazyLoadEmojis
                      />
                    </Suspense>
                  </div>,
                  document.body,
                )}
              </div>
              <div
                ref={inputRef}
                className={`${s.input} txt-body`}
                contentEditable
                suppressContentEditableWarning
                data-placeholder={inputPlaceholder}
                onKeyDown={handleKeyDown}
                onInput={() => onTyping?.()}
              />
              <div className={s.composerActions}>
                <button className={s.composerBtn} title="Attach file"><AttachIcon /></button>
                <button className={s.composerBtn} title="GIF"><GifIcon /></button>
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
