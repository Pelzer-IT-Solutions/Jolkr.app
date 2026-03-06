import { useState, useRef, lazy, Suspense, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Message, User, Reaction } from '../api/types';
import { useAuthStore } from '../stores/auth';
import { useMessagesStore } from '../stores/messages';
import { rewriteStorageUrl } from '../platform/config';
import { emojiToImgUrl } from '../utils/emoji';
import * as api from '../api/client';
import Avatar from './Avatar';
import MessageContent from './MessageContent';
import ImageLightbox from './ImageLightbox';
import UserProfileCard from './UserProfileCard';
import LinkEmbed from './LinkEmbed';
import PollDisplay from './PollDisplay';
import ConfirmDialog from './dialogs/ConfirmDialog';
import { useToast } from './Toast';
import { useDecryptedContent } from '../hooks/useDecryptedContent';

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));

interface Props {
  message: Message;
  compact?: boolean;
  author?: User;
  isDm?: boolean;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
  hideThreadButton?: boolean;
  replyMessage?: Message;
  replyAuthor?: User;
}

function MessageTileInner({ message, compact, author, isDm, onReply, onOpenThread, hideThreadButton, replyMessage, replyAuthor }: Props) {
  const user = useAuthStore((s) => s.user);
  const editMessage = useMessagesStore((s) => s.editMessage);
  const deleteMessage = useMessagesStore((s) => s.deleteMessage);
  const updateMessage = useMessagesStore((s) => s.updateMessage);
  const updateReactions = useMessagesStore((s) => s.updateReactions);
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const reactionBtnRef = useRef<HTMLButtonElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [editError, setEditError] = useState('');
  const showToast = useToast((s) => s.show);
  const [profileAnchor, setProfileAnchor] = useState<{ x: number; y: number } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const { displayContent, isEncrypted } = useDecryptedContent(
    message.content, message.encrypted_content, message.nonce, isDm,
  );
  const hasText = !!displayContent && displayContent.trim().length > 0 && displayContent !== '\u200B';

  // Use reactions directly from store (message.reactions)
  const reactions = message.reactions ?? [];

  const handleReaction = async (emoji: string) => {
    setShowReactionPicker(false);
    const existing = reactions.find((r) => r.emoji === emoji);
    const removeFn = isDm ? api.removeDmReaction : api.removeReaction;
    const addFn = isDm ? api.addDmReaction : api.addReaction;
    const prev = [...reactions];

    // Optimistic update — update store immediately
    if (existing?.me) {
      const updated = reactions
        .map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, me: false } : r)
        .filter((r) => r.count > 0);
      updateReactions(message.channel_id, message.id, updated);
    } else {
      let updated: Reaction[];
      const idx = reactions.findIndex((r) => r.emoji === emoji);
      if (idx >= 0) {
        updated = reactions.map((r, i) => i === idx ? { ...r, count: r.count + 1, me: true } : r);
      } else {
        updated = [...reactions, { emoji, count: 1, me: true }];
      }
      updateReactions(message.channel_id, message.id, updated);
    }

    // Make API call — revert on failure
    try {
      if (existing?.me) {
        await removeFn(message.id, emoji);
      } else {
        await addFn(message.id, emoji);
      }
    } catch {
      // Revert to previous state on error
      updateReactions(message.channel_id, message.id, prev);
    }
  };

  const isOwn = user?.id === message.author_id;
  const time = new Date(message.created_at);
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString();

  const handleSaveEdit = async () => {
    if (!editContent.trim() || editContent === (displayContent || message.content)) {
      setEditing(false);
      return;
    }
    try {
      await editMessage(message.id, message.channel_id, editContent.trim(), isDm);
      setEditing(false);
      setEditError('');
    } catch {
      setEditError('Failed to edit message');
    }
  };

  const handleDelete = async () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      await deleteMessage(message.id, message.channel_id, isDm);
    } catch {
      showToast('Failed to delete message', 'error');
    }
  };

  const isImage = (ct: string) => ct.startsWith('image/') && ct !== 'image/svg+xml';

  return (
    <div
      className={`group flex items-start gap-4 px-4 hover:bg-white/[0.02] relative ${compact ? 'py-0.5' : 'py-1.5 [.compact-mode_&]:py-0.5'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onFocusCapture={() => setShowActions(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowActions(false); }}
      onTouchStart={() => setShowActions(true)}
    >
      {compact ? (
        <div className="w-10 shrink-0 flex justify-center">
          <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100">{timeStr}</span>
        </div>
      ) : message.webhook_id ? (
        <div className="shrink-0">
          <Avatar url={message.webhook_avatar ?? author?.avatar_url} name={message.webhook_name ?? author?.username ?? '?'} size={40} />
        </div>
      ) : (
        <button
          className="shrink-0 cursor-pointer"
          onClick={(e) => setProfileAnchor({ x: e.clientX, y: e.clientY })}
        >
          <Avatar url={message.webhook_avatar ?? author?.avatar_url} name={message.webhook_name ?? author?.username ?? '?'} size={40} />
        </button>
      )}

      <div className="flex-1 min-w-0">
        {/* Reply reference */}
        {message.reply_to_id && (
          <div className="flex items-center gap-1.5 mb-0.5 text-[12px] text-text-muted">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            <span className="text-text-secondary font-medium">{replyAuthor?.username ?? 'Unknown'}</span>
            <span className="truncate max-w-[300px]">{replyMessage?.content ?? '...'}</span>
          </div>
        )}

        {!compact && (
          <div className="flex items-baseline gap-2">
            {message.webhook_id ? (
              <span className="font-medium text-sm text-text-primary truncate max-w-[300px]">
                {message.webhook_name ?? 'Webhook'}
              </span>
            ) : (
              <button
                className="font-medium text-sm text-text-primary hover:underline cursor-pointer truncate max-w-[300px]"
                onClick={(e) => setProfileAnchor({ x: e.clientX, y: e.clientY })}
              >
                {author?.username ?? 'Unknown'}
              </button>
            )}
            {message.webhook_id && (
              <span className="px-1 py-0.5 text-[9px] bg-primary/20 text-primary rounded font-bold uppercase shrink-0">
                BOT
              </span>
            )}
            <span className="text-[11px] text-text-muted">{dateStr} {timeStr}</span>
            {isEncrypted && (
              <svg className="w-3 h-3 text-green-400 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <title>End-to-end encrypted</title>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
            {message.is_edited && <span className="text-[10px] text-text-muted">(edited)</span>}
          </div>
        )}

        {editing ? (
          <div className="mt-1">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-full px-3 py-1.5 bg-input rounded text-text-primary text-sm resize-none"
              rows={Math.min(editContent.split('\n').length, 6)}
              autoFocus
            />
            {editError && <div className="text-xs text-error mt-1">{editError}</div>}
            <div className="text-[11px] text-text-muted mt-1">
              Enter to save &middot; Shift+Enter for new line &middot; Escape to cancel
            </div>
          </div>
        ) : hasText ? (
          <MessageContent content={displayContent} className="text-sm text-text-primary/90 break-words" />
        ) : null}

        {/* Attachments */}
        {(message.attachments ?? []).length > 0 && (
          <div className={`${hasText ? 'mt-2' : ''} flex flex-col gap-2`}>
            {(message.attachments ?? []).map((att) => {
              const attUrl = rewriteStorageUrl(att.url) ?? att.url;
              return isImage(att.content_type) ? (
                <AttachmentImage
                  key={att.id}
                  src={attUrl}
                  alt={att.filename}
                  onOpen={() => setLightboxImage({ src: attUrl, alt: att.filename })}
                />
              ) : (
                <a
                  key={att.id}
                  href={attUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 bg-input rounded-lg px-3 py-2 max-w-[300px] hover:bg-input/80"
                >
                  <svg className="w-5 h-5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <div className="min-w-0">
                    <div className="text-sm text-primary truncate">{att.filename}</div>
                    <div className="text-[11px] text-text-muted">{formatBytes(att.size_bytes)}</div>
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {/* Link Embeds */}
        {(message.embeds ?? []).length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            {(message.embeds ?? []).map((embed, i) => (
              <LinkEmbed key={`${embed.url}-${i}`} embed={embed} />
            ))}
          </div>
        )}

        {/* Poll */}
        {message.poll && (
          <PollDisplay pollId={message.poll.id} initialPoll={message.poll} />
        )}

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => handleReaction(r.emoji)}
                className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border ${
                  r.me
                    ? 'bg-primary/20 border-primary/50 text-text-primary'
                    : 'bg-input border-divider text-text-secondary hover:bg-input/80'
                }`}
              >
                <img src={emojiToImgUrl(r.emoji)} alt={r.emoji} className="inline-block w-[18px] h-[18px]" loading="lazy" draggable={false} />
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Thread reply count badge */}
        {message.thread_id && (message.thread_reply_count ?? 0) > 0 && !hideThreadButton && (
          <button
            onClick={() => onOpenThread?.(message)}
            className="mt-1 flex items-center gap-1.5 text-primary text-xs hover:underline cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
            <span>{message.thread_reply_count ?? 0} {(message.thread_reply_count ?? 0) === 1 ? 'reply' : 'replies'}</span>
          </button>
        )}
      </div>

      {/* Action buttons */}
      {showActions && !editing && (
        <div className="absolute right-4 -top-3 flex bg-surface border border-divider rounded shadow-lg">
          <button
            onClick={() => onReply?.(message)}
            className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5"
            title="Reply"
            aria-label="Reply"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          {!isDm && !hideThreadButton && (
            <button
              onClick={() => onOpenThread?.(message)}
              className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5"
              title="Thread"
              aria-label="Thread"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
            </button>
          )}
          {!isDm && (
            <button
              onClick={async () => {
                if (pinning) return;
                setPinning(true);
                try {
                  if (message.is_pinned) {
                    const updated = await api.unpinMessage(message.channel_id, message.id);
                    updateMessage(message.channel_id, { ...message, ...updated, is_pinned: false });
                  } else {
                    const updated = await api.pinMessage(message.channel_id, message.id);
                    updateMessage(message.channel_id, { ...message, ...updated, is_pinned: true });
                  }
                } catch (e) {
                  showToast((e as Error).message || 'Failed to pin/unpin', 'error');
                } finally {
                  setPinning(false);
                }
              }}
              disabled={pinning}
              className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5 disabled:opacity-50"
              title={message.is_pinned ? 'Unpin Message' : 'Pin Message'}
              aria-label={message.is_pinned ? 'Unpin Message' : 'Pin Message'}
            >
              <svg className={`w-4 h-4 ${message.is_pinned ? 'text-primary' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
          )}
          <button
            ref={reactionBtnRef}
            onClick={() => {
              if (!showReactionPicker && reactionBtnRef.current) {
                const rect = reactionBtnRef.current.getBoundingClientRect();
                setPickerPos({
                  top: Math.min(rect.bottom + 4, window.innerHeight - 366),
                  left: Math.min(rect.left, window.innerWidth - 316),
                });
              }
              setShowReactionPicker(!showReactionPicker);
            }}
            className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5"
            title="Add Reaction"
            aria-label="Add Reaction"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {isOwn && (
            <>
              {!isEncrypted && (
                <button
                  onClick={() => { setEditing(true); setEditContent(displayContent || ''); }}
                  className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5"
                  title="Edit"
                  aria-label="Edit"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-text-secondary hover:text-error hover:bg-white/5"
                title="Delete"
                aria-label="Delete"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
        </div>
      )}

      {/* Reaction picker */}
      {showReactionPicker && pickerPos && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowReactionPicker(false)} />
          <div className="fixed z-50" style={{ top: pickerPos.top, left: pickerPos.left }}>
            <Suspense fallback={<div className="w-[300px] h-[350px] bg-surface rounded-lg flex items-center justify-center text-text-muted text-sm">Loading...</div>}>
              <LazyEmojiPicker
                theme={"dark" as never}
                onEmojiClick={(emoji: { emoji: string }) => handleReaction(emoji.emoji)}
                width={300}
                height={350}
              />
            </Suspense>
          </div>
        </>,
        document.body,
      )}

      {/* User profile card */}
      {profileAnchor && (
        <UserProfileCard
          userId={message.author_id}
          user={author}
          anchor={profileAnchor}
          onClose={() => setProfileAnchor(null)}
        />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete Message"
          message="Are you sure you want to delete this message? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Image lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}

const MessageTile = memo(MessageTileInner);
export default MessageTile;

function AttachmentImage({ src, alt, onOpen }: { src: string; alt: string; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div className="bg-input rounded-lg px-3 py-2 text-text-muted text-sm max-w-[300px]">
        Image expired: {alt}
      </div>
    );
  }

  return (
    <div className="relative max-w-[400px] min-h-[60px] rounded-lg overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 bg-white/5 animate-pulse rounded-lg" />
      )}
      <img
        src={src}
        alt={alt}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        className={`max-w-[400px] max-h-[300px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onClick={onOpen}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
