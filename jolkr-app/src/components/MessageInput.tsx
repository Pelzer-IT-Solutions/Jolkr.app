import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { Paperclip, X, Reply, Clock, Plus, Smile, Send, Type } from 'lucide-react';
import { useClickOutside } from '../hooks/useClickOutside';
import DOMPurify from 'dompurify';
import type { Message, User } from '../api/types';
import { useMessagesStore } from '../stores/messages';
import { wsClient } from '../api/ws';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { isE2EEReady, getLocalKeys } from '../services/e2ee';
import { encryptChannelMessage } from '../crypto/channelKeys';
import { searchEmojis, emojiToImgUrl, renderUnicodeEmojis } from '../utils/emoji';
import { isMobile as isMobilePlatform } from '../platform/detect';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import EmojiPickerPopup from './EmojiPickerPopup';

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface MentionableUser {
  id: string;
  username: string;
}

export interface MessageInputProps {
  channelId: string;
  serverId?: string;
  isDm?: boolean;
  isGroupDm?: boolean;
  dmMemberIds?: string[];
  recipientUserId?: string;
  replyTo?: Message | null;
  replyAuthor?: User | null;
  onCancelReply?: () => void;
  mentionableUsers?: MentionableUser[];
  canSend?: boolean; // undefined = still loading perms
  canAttach?: boolean; // false = hide file button, ignore paste/drop
  slowmodeSeconds?: number;
  droppedFiles?: File[];
  isAnnouncement?: boolean;
}

function SortableFileChip({ file, id, index, onRemove }: { file: File; id: string; index: number; onRemove: (i: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="flex items-center gap-2 bg-surface border border-divider rounded-lg px-3 py-2 text-sm"
    >
      <Paperclip className="size-4 text-text-tertiary shrink-0" />
      <span className="text-text-primary truncate max-w-37.5">{file.name}</span>
      <span className="text-text-tertiary text-xs">({formatFileSize(file.size)})</span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-text-tertiary hover:text-danger"
        aria-label={`Remove ${file.name}`}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export default function MessageInput({ channelId, isDm, dmMemberIds, recipientUserId, replyTo, replyAuthor, onCancelReply, mentionableUsers = [], canSend, canAttach = true, slowmodeSeconds, droppedFiles, isAnnouncement }: MessageInputProps) {
  const [content, setContent] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showTextFormat, setShowTextFormat] = useState(false);
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [emojiIndex, setEmojiIndex] = useState(0);
  const [slowmodeCooldown, setSlowmodeCooldown] = useState(0);
  const slowmodeTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sendErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mobileEmojiRef = useRef<HTMLDivElement>(null);
  const desktopEmojiRef = useRef<HTMLDivElement>(null);
  const mobileEmojiBtnRef = useRef<HTMLButtonElement>(null);
  const desktopEmojiBtnRef = useRef<HTMLButtonElement>(null);
  const [emojiPos, setEmojiPos] = useState<{ top: number; left: number } | null>(null);
  const textFormatRef = useClickOutside<HTMLDivElement>(() => setShowTextFormat(false), showTextFormat);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const fileIds = useMemo(() => {
    const seen = new Map<string, number>();
    return files.map((f) => {
      const base = `${f.name}-${f.size}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count > 0 ? `${base}-${count}` : base;
    });
  }, [files]);
  // Clear slowmode cooldown + sendError timer on channel change or unmount
  useEffect(() => {
    setSlowmodeCooldown(0);
    if (slowmodeTimerRef.current) clearInterval(slowmodeTimerRef.current);
    return () => {
      if (slowmodeTimerRef.current) clearInterval(slowmodeTimerRef.current);
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
    };
  }, [channelId]);

  // Cleanup mention detection timer on unmount
  useEffect(() => {
    return () => {
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    };
  }, []);

  // Auto-focus textarea on channel/DM switch (skip on mobile to avoid keyboard popup)
  useEffect(() => {
    if (!isMobilePlatform()) inputRef.current?.focus();
  }, [channelId]);

  // Merge files dropped from parent drag-and-drop overlay
  useEffect(() => {
    if (droppedFiles && droppedFiles.length > 0 && canAttach) {
      setFiles((prev) => [...prev, ...droppedFiles]);
      if (!isMobilePlatform()) inputRef.current?.focus();
    }
  }, [droppedFiles, canAttach]);

  // Paste-to-upload handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!canAttach) return;
    const pastedFiles = Array.from(e.clipboardData.files);
    const valid = pastedFiles.filter((f) => f.size <= MAX_FILE_SIZE);
    if (valid.length > 0) {
      e.preventDefault();
      setFiles((prev) => [...prev, ...valid]);
    }
  }, [canAttach]);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const sendMessage = useMessagesStore((s) => s.sendMessage);
  const sendDmMessage = useMessagesStore((s) => s.sendDmMessage);
  const addMessage = useMessagesStore((s) => s.addMessage);
  const fetchMessages = useMessagesStore((s) => s.fetchMessages);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || mentionableUsers.length === 0) return [];
    const q = mentionQuery.toLowerCase();
    return mentionableUsers.filter((u) => u.username.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionableUsers]);

  const emojiMatches = useMemo(() => {
    if (emojiQuery === null) return [];
    return searchEmojis(emojiQuery, 8);
  }, [emojiQuery]);

  const getEmojiContext = useCallback(() => {
    const el = inputRef.current;
    if (!el) return null;
    const cursor = el.selectionStart;
    const text = el.value.slice(0, cursor);
    // Find the last : that could be start of emoji shortcode
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null;
    // Must be at start or preceded by whitespace
    if (lastColon > 0 && !/\s/.test(text[lastColon - 1])) return null;
    const query = text.slice(lastColon + 1);
    // No spaces, must be 2+ alphanumeric chars
    if (/\s/.test(query) || query.length < 2 || !/^[a-zA-Z0-9_]+$/.test(query)) return null;
    return { start: lastColon, query };
  }, []);

  const insertEmoji = useCallback((emoji: string) => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const text = el.value;
    const before = text.slice(0, cursor);
    const lastColon = before.lastIndexOf(':');
    if (lastColon === -1) return;
    const after = text.slice(cursor);
    const newContent = text.slice(0, lastColon) + emoji + ' ' + after;
    setContent(newContent);
    setEmojiQuery(null);
    setEmojiIndex(0);
    setTimeout(() => {
      const newPos = lastColon + emoji.length + 1; // emoji + space
      el.selectionStart = el.selectionEnd = newPos;
      el.focus();
    }, 0);
  }, []);

  const getMentionContext = useCallback(() => {
    const el = inputRef.current;
    if (!el) return null;
    const cursor = el.selectionStart;
    const text = el.value.slice(0, cursor);
    // Find the last @ that could be start of mention
    const lastAt = text.lastIndexOf('@');
    if (lastAt === -1) return null;
    // Must be at start or preceded by whitespace
    if (lastAt > 0 && !/\s/.test(text[lastAt - 1])) return null;
    const query = text.slice(lastAt + 1);
    // No spaces in mention query
    if (/\s/.test(query)) return null;
    return { start: lastAt, query };
  }, []);

  const insertFormatting = useCallback((prefix: string, suffix: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = el.value;
    const selected = text.slice(start, end);
    const newContent = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
    setContent(newContent);
    // Position cursor: if there was selected text, select the wrapped text. Otherwise, place cursor between prefix/suffix.
    setTimeout(() => {
      if (selected) {
        el.selectionStart = start + prefix.length;
        el.selectionEnd = end + prefix.length;
      } else {
        el.selectionStart = el.selectionEnd = start + prefix.length;
      }
      el.focus();
    }, 0);
  }, []);

  const insertMention = useCallback((username: string) => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const text = el.value;
    const before = text.slice(0, cursor);
    const lastAt = before.lastIndexOf('@');
    if (lastAt === -1) return;
    const after = text.slice(cursor);
    const newContent = text.slice(0, lastAt) + `@${username} ` + after;
    setContent(newContent);
    setMentionQuery(null);
    setMentionIndex(0);
    // Restore cursor position after React re-render
    setTimeout(() => {
      const newPos = lastAt + username.length + 2; // @username + space
      el.selectionStart = el.selectionEnd = newPos;
      el.focus();
    }, 0);
  }, []);

  const handleSend = async () => {
    const text = content.trim();
    if ((!text && files.length === 0) || sending || slowmodeCooldown > 0) return;
    setSending(true);
    setSendError(null);
    const savedContent = content;
    try {
      let msg;
      const msgContent = text || (files.length > 0 ? '\u200B' : '');
      if (!msgContent) return;
      if (isDm) {
        if (!isE2EEReady()) {
          throw new Error('Encryption keys not loaded. Please log out and log in again.');
        }
        const keys = getLocalKeys();
        if (!keys) {
          throw new Error('Encryption keys not available. Please log out and log in again.');
        }
        const otherIds = dmMemberIds ?? (recipientUserId ? [recipientUserId] : []);
        const memberIds = currentUserId ? [...new Set([currentUserId, ...otherIds])] : otherIds;
        const getMemberIds = async () => memberIds;
        const encrypted = await encryptChannelMessage(channelId, keys, msgContent, getMemberIds, true);
        if (!encrypted) {
          throw new Error('Could not encrypt message. The recipient may need to log in first to set up encryption keys.');
        }
        msg = await sendDmMessage(channelId, encrypted.encryptedContent, replyTo?.id, encrypted.nonce);
      } else {
        msg = await sendMessage(channelId, msgContent, replyTo?.id);
      }
      // Optimistic: add message to store immediately (dedup handles WS duplicate)
      if (msg) addMessage(channelId, msg);
      setContent('');
      onCancelReply?.();
      // Reset textarea height
      if (inputRef.current) inputRef.current.style.height = 'auto';

      // Start slowmode cooldown
      if (slowmodeSeconds && slowmodeSeconds > 0) {
        setSlowmodeCooldown(slowmodeSeconds);
        if (slowmodeTimerRef.current) clearInterval(slowmodeTimerRef.current);
        slowmodeTimerRef.current = setInterval(() => {
          setSlowmodeCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(slowmodeTimerRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }

      // Upload attachments if any
      if (files.length > 0 && msg?.id) {
        setUploading(true);
        for (const file of files) {
          try {
            if (isDm) {
              await api.uploadDmAttachment(channelId, msg.id, file);
            } else {
              await api.uploadAttachment(channelId, msg.id, file);
            }
          } catch {
            setSendError(`Failed to upload: ${file.name}`);
            if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
            sendErrorTimerRef.current = setTimeout(() => setSendError(null), 4000);
          }
        }
        setFiles([]);
        setUploading(false);
        // Re-fetch to show attachments
        fetchMessages(channelId, isDm);
      }
    } catch (e) {
      // Restore content so the user doesn't lose their message
      setContent(savedContent);
      setSendError((e as Error).message || 'Failed to send message');
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
      sendErrorTimerRef.current = setTimeout(() => setSendError(null), 4000);
    }
    finally { setSending(false); }
    if (!isMobilePlatform()) inputRef.current?.focus();
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length > 0) {
      setSendError(`File too large (max ${MAX_FILE_SIZE_MB} MB): ${oversized.map((f) => f.name).join(', ')}`);
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
      sendErrorTimerRef.current = setTimeout(() => setSendError(null), 5000);
    }
    const valid = selected.filter((f) => f.size <= MAX_FILE_SIZE);
    if (valid.length > 0) setFiles((prev) => [...prev, ...valid]);
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle emoji autocomplete navigation
    if (emojiQuery !== null && emojiMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setEmojiIndex((prev) => (prev + 1) % emojiMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setEmojiIndex((prev) => (prev - 1 + emojiMatches.length) % emojiMatches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        insertEmoji(emojiMatches[emojiIndex].emoji);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setEmojiQuery(null);
        return;
      }
    }
    // Handle mention navigation
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionMatches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        insertMention(mentionMatches[mentionIndex].username);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    // Formatting shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      insertFormatting('**', '**');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      insertFormatting('*', '*');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (val: string) => {
    setContent(val);
    // Check for mention and emoji context after state update
    if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    mentionTimerRef.current = setTimeout(() => {
      const ctx = getMentionContext();
      if (ctx) {
        setMentionQuery(ctx.query);
        setMentionIndex(0);
      } else {
        setMentionQuery(null);
      }
      // Check emoji context
      const emojiCtx = getEmojiContext();
      if (emojiCtx) {
        setEmojiQuery(emojiCtx.query);
        setEmojiIndex(0);
      } else {
        setEmojiQuery(null);
      }
    }, 0);
    const now = Date.now();
    if (now - lastTypingRef.current > 3000) {
      lastTypingRef.current = now;
      wsClient.sendTyping(channelId);
    }
  };

  // Disabled state: no permission to send
  if (canSend === false) {
    return (
      <div className="px-4 py-3 shrink-0">
        <div className="flex items-center bg-surface border border-divider rounded-lg px-4 py-3 opacity-60">
          <span className="text-text-tertiary text-sm">
            {isAnnouncement
              ? 'This is an announcement channel'
              : 'You do not have permission to send messages in this channel'}
          </span>
        </div>
      </div>
    );
  }

  // canSend === undefined means permissions are still loading (server channels only).
  // Don't show a skeleton — just render the real input. DMs never set canSend so it's always undefined there.

  if (isMobilePlatform()) {
    return (
      <div className="shrink-0 relative">
        {/* Mention autocomplete (mobile) */}
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <div role="listbox" className="absolute bottom-full left-3 right-3 mb-1 bg-surface border border-divider rounded-xl shadow-float py-1 max-h-50 overflow-y-auto z-50">
            <div className="px-3 py-1 text-2xs text-text-tertiary uppercase tracking-wider">Members</div>
            {mentionMatches.map((u, i) => (
              <button
                key={u.id}
                role="option"
                aria-selected={i === mentionIndex}
                onClick={() => insertMention(u.username)}
                className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${i === mentionIndex ? 'bg-accent-muted text-text-primary' : 'text-text-secondary hover:bg-hover'
                  }`}
              >
                <span className="text-accent font-medium">@</span>
                <span>{u.username}</span>
              </button>
            ))}
          </div>
        )}

        {/* Emoji shortcode autocomplete (mobile) */}
        {emojiQuery !== null && emojiMatches.length > 0 && (
          <div role="listbox" className="absolute bottom-full left-3 right-3 mb-1 bg-surface border border-divider rounded-xl shadow-float py-1 max-h-70 overflow-y-auto z-50">
            <div className="px-3 py-1 text-2xs text-text-tertiary uppercase tracking-wider">Emoji matching :{emojiQuery}</div>
            {emojiMatches.map((entry, i) => (
              <button
                key={entry.name}
                role="option"
                aria-selected={i === emojiIndex}
                onClick={() => insertEmoji(entry.emoji)}
                className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${i === emojiIndex ? 'bg-accent-muted text-text-primary' : 'text-text-secondary hover:bg-hover'
                  }`}
              >
                <img src={emojiToImgUrl(entry.emoji)} alt={entry.emoji} className="w-5 h-5" loading="lazy" draggable={false} />
                <span className="text-text-tertiary">:{entry.name}:</span>
              </button>
            ))}
          </div>
        )}


        {/* Reply bar (mobile) */}
        {replyTo && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-surface/50 border-l-2 border-accent mb-1 mx-3">
            <Reply className="size-3.5 text-text-tertiary shrink-0" />
            <span className="text-xs text-text-tertiary">Replying to</span>
            <span className="text-xs text-text-primary font-medium">{replyAuthor?.username ?? 'Unknown'}</span>
            <span className="text-xs text-text-tertiary truncate flex-1">{replyTo.content}</span>
            <button onClick={onCancelReply} className="text-text-tertiary hover:text-text-primary shrink-0" aria-label="Cancel reply">
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* File preview (mobile) */}
        {files.length > 0 && (
          <div className="flex gap-2 flex-wrap px-3 pb-1">
            {files.map((file, i) => (
              <div key={i} className="flex items-center gap-2 bg-surface border border-divider rounded-lg px-3 py-2 text-sm">
                <Paperclip className="size-4 text-text-tertiary shrink-0" />
                <span className="text-text-primary truncate max-w-37.5">{file.name}</span>
                <button onClick={() => removeFile(i)} className="text-text-tertiary hover:text-danger" aria-label={`Remove ${file.name}`}>
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Status area */}
        {(slowmodeCooldown > 0 || sendError || uploading) && (
          <div className="flex items-center px-3 pb-1">
            {slowmodeCooldown > 0 ? (
              <div className="text-xs text-warning flex items-center gap-1"><Clock className="size-3" /> Slowmode: {slowmodeCooldown}s</div>
            ) : sendError ? (
              <div className="text-xs text-danger">{sendError}</div>
            ) : uploading ? (
              <div className="text-xs text-text-tertiary">Uploading files...</div>
            ) : null}
          </div>
        )}

        {canAttach && (
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        )}

        {/* Mobile input bar — Pencil design: bg-sidebar, gap-2.5, px-3 py-2.5 */}
        <div className="flex items-center gap-2.5 bg-sidebar px-3 py-2.5">
          {canAttach && (
            <button onClick={() => fileInputRef.current?.click()} className="text-text-tertiary shrink-0" title="Attach file" aria-label="Attach file">
              <Plus className="size-5.5" />
            </button>
          )}

          <div className="flex items-center gap-2 rounded-full bg-bg border border-divider focus-within:border-border-accent transition-colors px-3.5 py-2.5 flex-1">
            <div className="relative flex flex-1 self-center">
              {content && (
                <div
                  ref={overlayRef}
                  className="absolute inset-0 text-text-primary text-sm whitespace-pre-wrap wrap-break-word overflow-hidden pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: renderInputEmojis(content) }}
                />
              )}
              <textarea
                ref={inputRef}
                value={content}
                onChange={(e) => handleInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setShowEmoji(false)}
                placeholder="Type a message..."
                rows={1}
                className="input-reset relative w-full bg-transparent text-transparent caret-text-accent text-sm resize-none max-h-30 placeholder:text-text-tertiary selection:bg-accent/30"
                style={{ height: 'auto', minHeight: '20px' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                }}
                onScroll={(e) => {
                  if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
              />
            </div>

            <div ref={mobileEmojiRef} className="relative shrink-0">
              <button
                ref={mobileEmojiBtnRef}
                onClick={() => {
                  if (!showEmoji && mobileEmojiBtnRef.current) {
                    const r = mobileEmojiBtnRef.current.getBoundingClientRect();
                    setEmojiPos({ top: r.top, left: r.left + r.width / 2 });
                  }
                  setShowEmoji(!showEmoji);
                }}
                className="text-text-tertiary"
                title="Emoji"
                aria-label="Emoji"
              >
                <Smile className="size-5" />
              </button>
              {showEmoji && emojiPos && (
                <EmojiPickerPopup
                  position={emojiPos}
                  onSelect={(emoji) => { setContent((prev) => prev + emoji); inputRef.current?.focus(); }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>
          </div>

          <button
            onClick={handleSend}
            disabled={(!content.trim() && files.length === 0) || sending || slowmodeCooldown > 0}
            className="size-9 rounded-full bg-accent flex items-center justify-center disabled:opacity-50 shrink-0"
            aria-label="Send message"
          >
            <Send className="size-4 text-bg" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 shrink-0 relative">
      {/* Mention autocomplete */}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-4 right-4 mb-1 bg-surface border border-divider rounded-xl shadow-float py-1 max-h-50 overflow-y-auto z-50">
          <div className="px-3 py-1 text-2xs text-text-tertiary uppercase tracking-wider">Members</div>
          {mentionMatches.map((u, i) => (
            <button
              key={u.id}
              role="option"
              aria-selected={i === mentionIndex}
              onClick={() => insertMention(u.username)}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${i === mentionIndex ? 'bg-accent-muted text-text-primary' : 'text-text-secondary hover:bg-hover'
                }`}
            >
              <span className="text-accent font-medium">@</span>
              <span>{u.username}</span>
            </button>
          ))}
        </div>
      )}

      {/* Emoji shortcode autocomplete */}
      {emojiQuery !== null && emojiMatches.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-4 right-4 mb-1 bg-surface border border-divider rounded-xl shadow-float py-1 max-h-70 overflow-y-auto z-50">
          <div className="px-3 py-1 text-2xs text-text-tertiary uppercase tracking-wider">Emoji matching :{emojiQuery}</div>
          {emojiMatches.map((entry, i) => (
            <button
              key={entry.name}
              role="option"
              aria-selected={i === emojiIndex}
              onClick={() => insertEmoji(entry.emoji)}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${i === emojiIndex ? 'bg-accent-muted text-text-primary' : 'text-text-secondary hover:bg-hover'
                }`}
            >
              <img src={emojiToImgUrl(entry.emoji)} alt={entry.emoji} className="w-5 h-5" loading="lazy" draggable={false} />
              <span className="text-text-tertiary">:{entry.name}:</span>
            </button>
          ))}
        </div>
      )}

      {/* Reply bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-surface/50 border-l-2 border-accent rounded-t-lg mb-1">
          <Reply className="size-3.5 text-text-tertiary shrink-0" />
          <span className="text-xs text-text-tertiary">Replying to</span>
          <span className="text-xs text-text-primary font-medium">{replyAuthor?.username ?? 'Unknown'}</span>
          <span className="text-xs text-text-tertiary truncate flex-1">{replyTo.content}</span>
          <button onClick={onCancelReply} className="text-text-tertiary hover:text-text-primary shrink-0" aria-label="Cancel reply">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* File preview bar */}
      {files.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToParentElement]}
          onDragEnd={(event) => {
            const { active, over } = event;
            if (over && active.id !== over.id) {
              const oldIndex = fileIds.indexOf(active.id as string);
              const newIndex = fileIds.indexOf(over.id as string);
              setFiles((prev) => arrayMove(prev, oldIndex, newIndex));
            }
          }}
        >
          <SortableContext items={fileIds} strategy={rectSortingStrategy}>
            <div className="flex gap-2 flex-wrap">
              {files.map((file, i) => (
                <SortableFileChip key={fileIds[i]} file={file} id={fileIds[i]} index={i} onRemove={removeFile} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Status area — only takes space when content is shown */}
      <div className="flex items-center min-h-0">
        {slowmodeCooldown > 0 ? (
          <div className="text-xs text-warning flex items-center gap-1">
            <Clock className="size-3" />
            Slowmode: {slowmodeCooldown}s remaining
          </div>
        ) : sendError ? (
          <div className="text-xs text-danger">{sendError}</div>
        ) : uploading ? (
          <div className="text-xs text-text-tertiary">Uploading files...</div>
        ) : null}
      </div>

      {canAttach && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      )}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3 rounded-xl bg-surface border border-divider focus-within:border-border-accent transition-colors px-4 py-3 flex-1 h-12">
          {canAttach && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-text-tertiary hover:text-text-primary shrink-0"
              title="Attach file"
              aria-label="Attach file"
            >
              <Plus className="size-5" />
            </button>
          )}

          <div className="relative flex flex-1 self-center">
            {/* Emoji image overlay — shows rendered content with pretty emoji images */}
            {content && (
              <div
                ref={overlayRef}
                className="absolute inset-0 text-text-primary text-sm whitespace-pre-wrap wrap-break-word overflow-hidden pointer-events-none"
                dangerouslySetInnerHTML={{ __html: renderInputEmojis(content) }}
              />
            )}
            <textarea
              ref={inputRef}
              value={content}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => setShowEmoji(false)}
              placeholder="Type a message..."
              rows={1}
              className="input-reset relative w-full bg-transparent text-transparent caret-text-accent text-sm resize-none max-h-30 placeholder:text-text-tertiary selection:bg-accent/30"
              style={{ height: 'auto', minHeight: '24px' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
              onScroll={(e) => {
                if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
            />
          </div>

          <div ref={textFormatRef} className="flex items-center relative shrink-0">
            <button
              onClick={() => setShowTextFormat(!showTextFormat)}
              className="text-text-tertiary hover:text-text-primary"
              title="Formatting"
              aria-label="Formatting"
            >
              <Type className="size-5" />
            </button>
            {showTextFormat && (
              <>
                {/* Formatting toolbar */}
                <div className="absolute bottom-full right-0 mb-2 z-50">
                  <div
                    className="flex justify-self-end-safe items-center gap-0.5 mb-1 px-1 py-0.5 rounded-lg bg-surface/50 border border-divider/50 w-fit">
                    <button onClick={() => { insertFormatting('**', '**'); setShowTextFormat(false); }} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-hover transition-colors" title="Bold (Ctrl+B)">
                      <span className="text-xs font-bold w-5 h-5 flex items-center justify-center">B</span>
                    </button>
                    <button onClick={() => { insertFormatting('*', '*'); setShowTextFormat(false); }} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-hover transition-colors" title="Italic (Ctrl+I)">
                      <span className="text-xs italic w-5 h-5 flex items-center justify-center">I</span>
                    </button>
                    <button onClick={() => { insertFormatting('~~', '~~'); setShowTextFormat(false); }} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-hover transition-colors" title="Strikethrough">
                      <span className="text-xs line-through w-5 h-5 flex items-center justify-center">S</span>
                    </button>
                    <div className="w-px h-4 bg-divider/50 mx-0.5" />
                    <button onClick={() => { insertFormatting('`', '`'); setShowTextFormat(false); }} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-hover transition-colors" title="Inline Code">
                      <span className="text-xs font-mono w-5 h-5 flex items-center justify-center">&lt;/&gt;</span>
                    </button>
                    <button onClick={() => { insertFormatting('```\n', '\n```'); setShowTextFormat(false); }} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-hover transition-colors" title="Code Block">
                      <span className="text-2xs font-mono w-5 h-5 flex items-center justify-center">[/]</span>
                    </button>
                    <div className="w-px h-4 bg-divider/50 mx-0.5" />
                    <button onClick={() => { insertFormatting('> ', ''); setShowTextFormat(false); }} className="p-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-hover transition-colors" title="Quote">
                      <span className="text-xs w-5 h-5 flex items-center justify-center">"</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div ref={desktopEmojiRef} className="flex items-center relative shrink-0">
            <button
              ref={desktopEmojiBtnRef}
              onClick={() => {
                if (!showEmoji && desktopEmojiBtnRef.current) {
                  const r = desktopEmojiBtnRef.current.getBoundingClientRect();
                  setEmojiPos({ top: r.top, left: r.left + r.width / 2 });
                }
                setShowEmoji(!showEmoji);
              }}
              className="text-text-tertiary hover:text-text-primary"
              title="Emoji"
              aria-label="Emoji"
            >
              <Smile className="size-5" />
            </button>
            {showEmoji && emojiPos && (
              <EmojiPickerPopup
                position={emojiPos}
                onSelect={(emoji) => { setContent((prev) => prev + emoji); inputRef.current?.focus(); }}
                onClose={() => setShowEmoji(false)}
              />
            )}
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={(!content.trim() && files.length === 0) || sending || slowmodeCooldown > 0}
          className="size-10 rounded-full bg-accent flex items-center justify-center disabled:opacity-50 shrink-0"
          title={slowmodeCooldown > 0 ? `Slowmode: ${slowmodeCooldown}s` : undefined}
          aria-label="Send message"
        >
          <Send className="size-4.5 text-bg" />
        </button>
      </div>
    </div>
  );
}

/** Render input text with Unicode emojis replaced by CDN images */
function renderInputEmojis(text: string): string {
  if (!text) return '';
  // Escape HTML entities
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Newlines to <br>
  html = html.replace(/\n/g, '<br>');
  // Unicode emojis → img tags
  html = renderUnicodeEmojis(html, 20);
  // Sanitize to prevent XSS via dangerouslySetInnerHTML
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['img', 'br'],
    ALLOWED_ATTR: ['src', 'alt', 'class', 'style', 'loading', 'draggable'],
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
