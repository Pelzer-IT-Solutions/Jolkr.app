import { useState, useRef, useMemo, lazy, Suspense, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Message, User, Reaction, MessageEmbed } from '../api/types';
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
import VideoEmbed from './VideoEmbed';
import { parseVideoUrl, getYouTubeThumbnail, getPlatformName, getPlatformColor } from '../utils/videoUrl';
import PollDisplay from './PollDisplay';
import ConfirmDialog from './dialogs/ConfirmDialog';
import { useToast } from './Toast';
import { useDecryptedContent } from '../hooks/useDecryptedContent';
import { useDmReadsStore } from '../stores/dm-reads';
import { useMobileView } from '../hooks/useMobileView';
import { Reply, Lock, FileText, MessageSquare, Check, Bookmark, Smile, Pencil, Trash2 } from 'lucide-react';
import { useContextMenuStore } from '../stores/context-menu';

const URL_RE = /https?:\/\/[^\s<>)\]']+/g;

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));

export interface MessageTileProps {
  message: Message;
  compact?: boolean;
  author?: User;
  isDm?: boolean;
  channelId?: string;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
  hideThreadButton?: boolean;
  replyMessage?: Message;
  replyAuthor?: User;
}

function MessageTileInner({ message, compact, author, isDm, channelId, onReply, onOpenThread, hideThreadButton, replyMessage, replyAuthor }: MessageTileProps) {
  const user = useAuthStore((s) => s.user);
  const editMessage = useMessagesStore((s) => s.editMessage);
  const deleteMessage = useMessagesStore((s) => s.deleteMessage);
  const updateMessage = useMessagesStore((s) => s.updateMessage);
  const updateReactions = useMessagesStore((s) => s.updateReactions);
  const mobile = useMobileView();
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const { displayContent, isEncrypted } = useDecryptedContent(
    message.content, message.encrypted_content, message.nonce, isDm,
    user?.id === message.author_id, channelId,
  );
  const hasText = !!displayContent && displayContent.trim().length > 0 && displayContent !== '\u200B';

  // Client-side embed generation: extract URLs from displayed content and create
  // video embeds for known platforms. This is essential for encrypted messages where
  // the server cannot read the content to generate embeds.
  const clientEmbeds = useMemo<MessageEmbed[]>(() => {
    // If server already provided embeds, use those
    if ((message.embeds ?? []).length > 0) return message.embeds!;
    if (!displayContent) return [];
    const urls = displayContent.match(URL_RE);
    if (!urls) return [];
    const seen = new Set<string>();
    const embeds: MessageEmbed[] = [];
    for (const url of urls.slice(0, 5)) {
      if (seen.has(url)) continue;
      seen.add(url);
      const info = parseVideoUrl(url);
      if (info) {
        embeds.push({
          url,
          title: getPlatformName(info.platform),
          description: null,
          image_url: info.platform === 'youtube' && info.id ? getYouTubeThumbnail(info.id) : null,
          site_name: getPlatformName(info.platform),
          color: getPlatformColor(info.platform),
        });
      }
    }
    return embeds;
  }, [displayContent, message.embeds]);

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
      showToast('Failed to update reaction', 'error');
    }
  };

  const isOwn = user?.id === message.author_id;
  const readStates = useDmReadsStore((s) => isDm ? s.readStates[message.channel_id] : undefined);
  const isReadByOther = isDm && isOwn && readStates &&
    Object.values(readStates).some((msgId) => msgId === message.id);
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
  const isVideo = (ct: string) => ct.startsWith('video/');

  return (
    <div
      className={`group flex items-start gap-2.5 md:gap-3 px-4 py-1 md:py-1.5 hover:bg-hover relative ${compact ? 'py-0.5' : '[.compact-mode_&]:py-0.5'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onFocusCapture={() => setShowActions(true)}
      onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setShowActions(false); }}
      onTouchStart={() => setShowActions(true)}
    >
      {compact ? (
        <div className="w-8 md:w-10 shrink-0 flex justify-center">
          <span className="text-2xs md:text-xs text-text-tertiary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">{timeStr}</span>
        </div>
      ) : message.webhook_id ? (
        <div className="shrink-0">
          <Avatar url={message.webhook_avatar ?? author?.avatar_url} name={message.webhook_name ?? (author?.display_name || author?.username) ?? '?'} size={mobile ? 32 : 40} userId={message.author_id} />
        </div>
      ) : (
        <button
          className="shrink-0 cursor-pointer"
          onClick={(e) => setProfileAnchor({ x: e.clientX, y: e.clientY })}
        >
          <Avatar url={message.webhook_avatar ?? author?.avatar_url} name={message.webhook_name ?? (author?.display_name || author?.username) ?? '?'} size={mobile ? 32 : 40} userId={message.author_id} />
        </button>
      )}

      <div className="flex-1 min-w-0">
        {/* Reply reference */}
        {message.reply_to_id && (
          <div className="flex items-center gap-1.5 mb-0.5 text-xs text-text-tertiary">
            <Reply className="size-3 shrink-0" />
            <span className="text-text-secondary font-medium">{replyAuthor?.username ?? 'Unknown'}</span>
            <span className="truncate max-w-75">{replyMessage?.content ?? '...'}</span>
          </div>
        )}

        {!compact && (
          <div className="flex items-center gap-2">
            {message.webhook_id ? (
              <span className="text-sm font-semibold text-text-primary truncate max-w-75">
                {message.webhook_name ?? 'Webhook'}
              </span>
            ) : (
              <button
                className="text-sm font-semibold text-accent hover:underline cursor-pointer truncate max-w-75"
                onClick={(e) => setProfileAnchor({ x: e.clientX, y: e.clientY })}
              >
                {(author?.display_name || author?.username) ?? 'Unknown'}
              </button>
            )}
            {message.webhook_id && (
              <span className="px-1 py-0.5 text-2xs bg-accent-muted text-accent rounded font-bold uppercase shrink-0">
                BOT
              </span>
            )}
            <span className="text-2xs md:text-xs text-text-tertiary">{mobile ? timeStr : `${dateStr} ${timeStr}`}</span>
            {isEncrypted && (
              <span title="End-to-end encrypted"><Lock className="size-3 text-green-400 inline-block" /></span>
            )}
            {message.is_edited && <span className="text-xs text-text-tertiary">(edited)</span>}
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
              className="w-full px-3 py-1.5 bg-bg border border-divider rounded-lg text-text-primary text-sm resize-none"
              rows={Math.min(editContent.split('\n').length, 6)}
              autoFocus
            />
            {editError && <div className="text-xs text-danger mt-1">{editError}</div>}
            <div className="text-xs text-text-tertiary mt-1">
              Enter to save &middot; Shift+Enter for new line &middot; Escape to cancel
            </div>
          </div>
        ) : hasText ? (
          <MessageContent content={displayContent} className="text-sm text-text-primary leading-relaxed break-words" />
        ) : null}

        {/* Attachments */}
        {(message.attachments ?? []).length > 0 && (() => {
          const atts = message.attachments ?? [];
          const imageAtts = atts.filter((a) => isImage(a.content_type));
          const videoAtts = atts.filter((a) => isVideo(a.content_type));
          const fileAtts = atts.filter((a) => !isImage(a.content_type) && !isVideo(a.content_type));
          const lightboxImages = imageAtts.map((a) => ({
            src: rewriteStorageUrl(a.url) ?? a.url,
            alt: a.filename,
            filename: a.filename,
            sizeBytes: a.size_bytes,
            contentType: a.content_type,
          }));
          const imgCount = imageAtts.length;

          return (
            <div className={`${hasText ? 'mt-2' : ''} flex flex-col gap-2`}>
              {/* Image grid */}
              {imgCount > 0 && (
                <div
                  className={`grid gap-1 rounded-lg overflow-hidden max-w-100 ${
                    imgCount === 1 ? 'grid-cols-1' :
                    imgCount === 2 ? 'grid-cols-2' :
                    imgCount === 3 ? 'grid-cols-2' :
                    'grid-cols-2'
                  }`}
                >
                  {imageAtts.map((att, i) => {
                    const attUrl = rewriteStorageUrl(att.url) ?? att.url;
                    const spanFull = imgCount === 3 && i === 0;
                    return (
                      <AttachmentImage
                        key={att.id}
                        src={attUrl}
                        alt={att.filename}
                        grid={imgCount > 1}
                        spanFull={spanFull}
                        onOpen={() => setLightboxIndex(i)}
                        onRefreshUrl={async () => {
                          try {
                            await useMessagesStore.getState().fetchMessages(message.channel_id, !!isDm);
                            const msgs = useMessagesStore.getState().messages[message.channel_id] ?? [];
                            const freshMsg = msgs.find((m) => m.id === message.id);
                            const match = freshMsg?.attachments?.find((a) => a.id === att.id);
                            return match ? rewriteStorageUrl(match.url) ?? match.url : undefined;
                          } catch { return undefined; }
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Video attachments */}
              {videoAtts.map((att) => {
                const attUrl = rewriteStorageUrl(att.url) ?? att.url;
                return (
                  <VideoEmbed
                    key={att.id}
                    embed={{ url: attUrl, title: att.filename, site_name: 'Attachment' }}
                    videoInfo={{ platform: 'direct', src: attUrl }}
                  />
                );
              })}

              {/* File attachments */}
              {fileAtts.map((att) => {
                const attUrl = rewriteStorageUrl(att.url) ?? att.url;
                return (
                  <FileAttachment key={att.id} url={attUrl} filename={att.filename} sizeBytes={att.size_bytes} />
                );
              })}

              {/* Lightbox for all images */}
              {lightboxIndex !== null && lightboxImages.length > 0 && (
                <ImageLightbox
                  images={lightboxImages}
                  initialIndex={lightboxIndex}
                  onClose={() => setLightboxIndex(null)}
                />
              )}
            </div>
          );
        })()}

        {/* Link Embeds (server-side or client-side generated) */}
        {clientEmbeds.length > 0 && (
          <div className="mt-1 flex flex-col gap-1">
            {clientEmbeds.map((embed, i) => {
              const videoInfo = parseVideoUrl(embed.url);
              return videoInfo ? (
                <VideoEmbed key={`${embed.url}-${i}`} embed={embed} videoInfo={videoInfo} />
              ) : (
                <LinkEmbed key={`${embed.url}-${i}`} embed={embed} />
              );
            })}
          </div>
        )}

        {/* Poll */}
        {message.poll && (
          <PollDisplay pollId={message.poll.id} initialPoll={message.poll} />
        )}

        {/* Reactions */}
        {reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => handleReaction(r.emoji)}
                className={`px-2.5 py-1 rounded-full text-xs flex items-center gap-1 border ${
                  r.me
                    ? 'bg-accent-muted border-accent/50 text-text-primary'
                    : 'bg-surface border-divider text-text-secondary hover:bg-hover'
                }`}
              >
                <img src={emojiToImgUrl(r.emoji)} alt={r.emoji} className="inline-block w-4.5 h-4.5" loading="lazy" draggable={false} />
                <span>{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Thread reply count badge */}
        {message.thread_id && (message.thread_reply_count ?? 0) > 0 && !hideThreadButton && (
          <button
            onClick={() => onOpenThread?.(message)}
            className="mt-1 flex items-center gap-1.5 text-accent text-xs hover:underline cursor-pointer"
          >
            <MessageSquare className="size-3.5" />
            <span>{message.thread_reply_count ?? 0} {(message.thread_reply_count ?? 0) === 1 ? 'reply' : 'replies'}</span>
          </button>
        )}

        {/* DM read receipt indicator */}
        {isReadByOther && (
          <div className="flex items-center gap-1 mt-0.5">
            <Check className="size-3 text-accent" />
            <span className="text-2xs text-text-tertiary">Read</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {showActions && !editing && (
        <div className="absolute right-4 -top-3 flex rounded-lg bg-surface border border-divider shadow-float">
          <button
            onClick={() => onReply?.(message)}
            className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-hover"
            title="Reply"
            aria-label="Reply"
          >
            <Reply className="size-4" />
          </button>
          {!isDm && !hideThreadButton && (
            <button
              onClick={() => onOpenThread?.(message)}
              className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-hover"
              title="Thread"
              aria-label="Thread"
            >
              <MessageSquare className="size-4" />
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
                    showToast('Message unpinned', 'success');
                  } else {
                    const updated = await api.pinMessage(message.channel_id, message.id);
                    updateMessage(message.channel_id, { ...message, ...updated, is_pinned: true });
                    showToast('Message pinned', 'success');
                  }
                } catch (e) {
                  showToast((e as Error).message || 'Failed to pin/unpin', 'error');
                } finally {
                  setPinning(false);
                }
              }}
              disabled={pinning}
              className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-hover disabled:opacity-50"
              title={message.is_pinned ? 'Unpin Message' : 'Pin Message'}
              aria-label={message.is_pinned ? 'Unpin Message' : 'Pin Message'}
            >
              <Bookmark className={`size-4 ${message.is_pinned ? 'text-accent' : ''}`} />
            </button>
          )}
          <button
            ref={reactionBtnRef}
            onClick={() => {
              if (!showReactionPicker && reactionBtnRef.current) {
                const rect = reactionBtnRef.current.getBoundingClientRect();
                setPickerPos({
                  top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 366)),
                  left: Math.min(rect.left, window.innerWidth - 316),
                });
              }
              setShowReactionPicker(!showReactionPicker);
            }}
            className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-hover"
            title="Add Reaction"
            aria-label="Add Reaction"
          >
            <Smile className="size-4" />
          </button>
          {isOwn && (
            <>
              {!isEncrypted && (
                <button
                  onClick={() => { setEditing(true); setEditContent(displayContent || ''); }}
                  className="px-2 py-1 text-text-secondary hover:text-text-primary hover:bg-hover"
                  title="Edit"
                  aria-label="Edit"
                >
                  <Pencil className="size-4" />
                </button>
              )}
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-text-secondary hover:text-danger hover:bg-hover"
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 className="size-4" />
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
            <Suspense fallback={<div className="w-75 h-87.5 bg-surface rounded-lg flex items-center justify-center text-text-tertiary text-sm">Loading...</div>}>
              <LazyEmojiPicker
                theme={(localStorage.getItem('jolkr_theme') === 'light' ? 'light' : 'dark') as never}
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

    </div>
  );
}

const MessageTile = memo(MessageTileInner);
export default MessageTile;

function FileAttachment({ url, filename, sizeBytes }: { url: string; filename: string; sizeBytes: number }) {
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    useContextMenuStore.getState().open(e.clientX, e.clientY, [
      {
        label: 'Download', icon: 'Download', onClick: async () => {
          try {
            const response = await fetch(url, { mode: 'cors' });
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(blobUrl);
          } catch {
            window.open(url, '_blank');
          }
        },
      },
      {
        label: 'Open in New Tab', icon: 'ExternalLink', onClick: () => {
          window.open(url, '_blank', 'noopener');
        },
      },
    ]);
  };

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onContextMenu={handleContextMenu}
      className="flex items-center gap-2 bg-surface border border-divider rounded-lg px-3 py-2 max-w-75 hover:bg-hover"
    >
      <FileText className="size-5 text-text-tertiary shrink-0" />
      <div className="min-w-0">
        <div className="text-sm text-accent truncate">{filename}</div>
        <div className="text-xs text-text-tertiary">{formatBytes(sizeBytes)}</div>
      </div>
    </a>
  );
}

function AttachmentImage({ src, alt, onOpen, grid, spanFull, onRefreshUrl }: {
  src: string; alt: string; onOpen: () => void; grid?: boolean; spanFull?: boolean;
  onRefreshUrl?: () => Promise<string | undefined>;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);
  const retriedRef = useRef(false);
  const prevSrcRef = useRef(src);

  // Pick up fresh URL from parent (e.g. after message refetch)
  if (src !== prevSrcRef.current) {
    prevSrcRef.current = src;
    setCurrentSrc(src);
    setErrored(false);
    setLoaded(false);
    retriedRef.current = false;
  }

  const handleError = async () => {
    if (!retriedRef.current && onRefreshUrl) {
      retriedRef.current = true;
      try {
        const freshUrl = await onRefreshUrl();
        if (freshUrl) {
          setCurrentSrc(freshUrl);
          return;
        }
      } catch { /* fall through to errored */ }
    }
    setErrored(true);
  };

  if (errored) {
    return (
      <div className={`bg-surface border border-divider rounded-lg px-3 py-2 text-text-tertiary text-sm ${spanFull ? 'col-span-2' : ''}`}>
        Image expired: {alt}
      </div>
    );
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const imgSrc = currentSrc;
    useContextMenuStore.getState().open(e.clientX, e.clientY, [
      { label: 'Show', icon: 'Search', onClick: () => onOpen() },
      {
        label: 'Download', icon: 'Download', onClick: async () => {
          try {
            const response = await fetch(imgSrc, { mode: 'cors' });
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = alt;
            a.click();
            URL.revokeObjectURL(blobUrl);
          } catch {
            window.open(imgSrc, '_blank');
          }
        },
      },
      {
        label: 'Open in New Tab', icon: 'ExternalLink', onClick: () => {
          window.open(imgSrc, '_blank', 'noopener');
        },
      },
    ]);
  };

  if (grid) {
    return (
      <div className={`relative overflow-hidden ${spanFull ? 'col-span-2 h-50' : 'h-37.5'}`}>
        {!loaded && (
          <div className="absolute inset-0 bg-hover animate-pulse" />
        )}
        <img
          src={currentSrc}
          alt={alt}
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          className={`w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onClick={onOpen}
          onContextMenu={handleContextMenu}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={handleError}
        />
      </div>
    );
  }

  return (
    <div className="relative max-w-100 min-h-15 rounded-lg overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 bg-hover animate-pulse rounded-lg" />
      )}
      <img
        src={currentSrc}
        alt={alt}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        className={`max-w-100 max-h-75 rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onClick={onOpen}
        onContextMenu={handleContextMenu}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={handleError}
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
