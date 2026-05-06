/**
 * Two contexts that drop the heavy prop-drilling between ChatArea and its
 * three children (ChatHeader / MessageList / Composer):
 *
 *   - ChatActionsContext — every callback the children invoke (send,
 *     reactions, edit/delete/hide/pin, profile/thread open, panel toggles,
 *     load-older, typing).
 *   - ChatPermissionsContext — every boolean the children gate on (isDm,
 *     readOnly, can* permissions, has* content flags).
 *
 * ChatArea remains the single API surface for AppShell — callers still
 * pass every prop in the same shape. The contexts are an internal
 * implementation detail to keep the sub-components from threading
 * twenty-something props each.
 */
import { createContext, useContext } from 'react'
import type { MessageVM, ReplyRef } from '../../types'

export interface ChatActions {
  onExpandSidebar:    () => void
  onSetRightPanelMode: (mode: 'members' | 'pinned' | 'threads' | null) => void
  onSend:             (text: string, replyTo?: ReplyRef, files?: File[]) => void
  onToggleReaction:   (msgId: string, emoji: string) => void
  onDeleteMessage:    (msgId: string) => void
  onHideMessage?:     (msgId: string) => void
  onEditMessage:      (msgId: string, newText: string) => void
  onReply:            (msg: MessageVM) => void
  onTyping?:          () => void
  onLoadOlder?:       () => void
  onPinMessage?:      (msgId: string) => void
  onOpenAuthorProfile?: (authorId: string, e: React.MouseEvent) => void
  onOpenThread?:      (threadId: string) => void
  onStartThread?:     (messageId: string) => void
}

export interface ChatPermissions {
  isDm:               boolean
  readOnly:           boolean
  isReadOnly:         boolean   // readOnly || channel.is_system || !canSendMessages
  canManageMessages:  boolean
  canAddReactions:    boolean
  canSendMessages:    boolean
  canAttachFiles:     boolean
  hasMore:            boolean
  hasPinnedMessages:  boolean
  hasThreads:         boolean
}

const ChatActionsContext = createContext<ChatActions | null>(null)
const ChatPermissionsContext = createContext<ChatPermissions | null>(null)

export const ChatActionsProvider = ChatActionsContext.Provider
export const ChatPermissionsProvider = ChatPermissionsContext.Provider

export function useChatActions(): ChatActions {
  const ctx = useContext(ChatActionsContext)
  if (!ctx) throw new Error('useChatActions must be used inside <ChatActionsProvider>')
  return ctx
}

export function useChatPermissions(): ChatPermissions {
  const ctx = useContext(ChatPermissionsContext)
  if (!ctx) throw new Error('useChatPermissions must be used inside <ChatPermissionsProvider>')
  return ctx
}
