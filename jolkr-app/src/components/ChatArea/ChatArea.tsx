import { useState, useEffect, useRef, useCallback } from 'react'
import { Paperclip } from 'lucide-react'
import type { ChannelDisplay, DMConversation, MessageVM, ReplyRef } from '../../types'
import type { User } from '../../api/types'
import { MAX_ATTACHMENT_BYTES } from '../../utils/constants'
import { type RichInputHandle } from './RichInput'
import { ChatHeader } from './ChatHeader'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
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
  const inputRef = useRef<RichInputHandle>(null)

  // System channels are read-only; also hide composer if user lacks SEND_MESSAGES
  const isReadOnly = readOnly || channel.is_system || !canSendMessages

  const [replyingTo,   setReplyingTo]   = useState<MessageVM | null>(null)
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

  const handleReply = useCallback((msg: MessageVM) => {
    setReplyingTo(msg)
    inputRef.current?.focus()
  }, [])

  // Clear reply context synchronously on channel switch — the input/content
  // resets live in Composer's own channel-switch effect.
  const [prevChannelId, setPrevChannelId] = useState(channel.id)
  if (prevChannelId !== channel.id) {
    setPrevChannelId(channel.id)
    setReplyingTo(null)
  }

  // Sync handle clear on channel switch — Composer focuses + clears internally.
  useEffect(() => {
    inputRef.current?.focus()
  }, [channel.id])

  // `participants[0]` can be undefined for one-sided DMs — e.g. when the other
  // member just closed it and a DmUpdate with only the current user as
  // remaining member arrived. Use the optional chain so the chat doesn't crash.
  const dmFirstP      = dmConversation?.participants[0]
  const dmName        = dmConversation?.name ?? (dmFirstP ? `@${dmFirstP.name}` : '')
  const inputPlaceholder = isDm
    ? `Message ${dmName}`
    : `Message #${channel.name}`

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
      <ChatHeader
        channel={channel}
        isDm={isDm}
        dmConversation={dmConversation}
        sidebarCollapsed={sidebarCollapsed}
        rightPanelMode={rightPanelMode}
        onExpandSidebar={onExpandSidebar}
        onSetRightPanelMode={onSetRightPanelMode}
        hasPinnedMessages={hasPinnedMessages}
        hasThreads={hasThreads}
      />

      <div className={s.chatBody}>
        <MessageList
          channel={channel}
          messages={messages}
          animationKey={animationKey}
          isDm={isDm}
          dmConversation={dmConversation}
          serverId={serverId}
          userMap={userMap}
          isReadOnly={isReadOnly}
          canManageMessages={canManageMessages}
          canAddReactions={canAddReactions}
          hasMore={hasMore}
          onLoadOlder={onLoadOlder}
          onToggleReaction={onToggleReaction}
          onDeleteMessage={onDeleteMessage}
          onHideMessage={onHideMessage}
          onEditMessage={onEditMessage}
          onReply={handleReply}
          onPinMessage={onPinMessage}
          onOpenAuthorProfile={onOpenAuthorProfile}
          onOpenThread={onOpenThread}
          onStartThread={onStartThread}
        />

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

        <Composer
          channel={channel}
          isDm={isDm}
          isReadOnly={isReadOnly}
          canSendMessages={canSendMessages}
          canAttachFiles={canAttachFiles}
          inputPlaceholder={inputPlaceholder}
          mentionableUsers={mentionableUsers}
          onTyping={onTyping}
          onSend={onSend}
          inputRef={inputRef}
          replyingTo={replyingTo}
          setReplyingTo={setReplyingTo}
          pendingFiles={pendingFiles}
          setPendingFiles={setPendingFiles}
          acceptValidFiles={acceptValidFiles}
        />
      </div>
    </main>
  )
}
