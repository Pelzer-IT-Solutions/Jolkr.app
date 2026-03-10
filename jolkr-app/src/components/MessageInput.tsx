import { useRef, useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import DOMPurify from 'dompurify';
import type { Message, User } from '../api/types';
import { useMessagesStore } from '../stores/messages';
import { wsClient } from '../api/ws';
import * as api from '../api/client';
import { isE2EEReady, encryptDmMessage } from '../services/e2ee';
import { searchEmojis, emojiToImgUrl, renderUnicodeEmojis } from '../utils/emoji';
import { isMobile as isMobilePlatform } from '../platform/detect';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));

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
      className="flex items-center gap-2 bg-input rounded-lg px-3 py-2 text-sm"
    >
      <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className="text-text-primary truncate max-w-[150px]">{file.name}</span>
      <span className="text-text-muted text-[11px]">({formatFileSize(file.size)})</span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-text-muted hover:text-error"
        aria-label={`Remove ${file.name}`}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function MessageInput({ channelId, isDm, recipientUserId, replyTo, replyAuthor, onCancelReply, mentionableUsers = [], canSend, canAttach = true, slowmodeSeconds, droppedFiles }: MessageInputProps) {
  const [inputFocused, setInputFocused] = useState(false);
  const [content, setContent] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
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
  const emojiJustToggledRef = useRef(false);
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

  const sendMessage = useMessagesStore((s) => s.sendMessage);
  const sendDmMessage = useMessagesStore((s) => s.sendDmMessage);
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
      if (isDm && isE2EEReady() && recipientUserId) {
        const encrypted = await encryptDmMessage(recipientUserId, msgContent);
        if (encrypted) {
          msg = await sendDmMessage(channelId, msgContent, replyTo?.id, encrypted.encryptedContent, encrypted.nonce);
        } else {
          msg = await sendDmMessage(channelId, msgContent, replyTo?.id);
        }
      } else if (isDm) {
        msg = await sendDmMessage(channelId, msgContent, replyTo?.id);
      } else {
        msg = await sendMessage(channelId, msgContent, replyTo?.id);
      }
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
      <div className="px-4 pb-5 shrink-0">
        <div className="h-6" />
        <div className="flex items-center bg-input rounded-lg px-4 py-3 opacity-60">
          <span className="text-text-muted text-sm">You do not have permission to send messages in this channel</span>
        </div>
      </div>
    );
  }

  // canSend === undefined means permissions are still loading (server channels only).
  // Don't show a skeleton — just render the real input. DMs never set canSend so it's always undefined there.

  return (
    <div className="px-4 pb-5 shrink-0 relative">
      {/* Mention autocomplete */}
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-4 right-4 mb-1 bg-surface border border-divider rounded-xl shadow-float py-1 max-h-[200px] overflow-y-auto z-50">
          <div className="px-3 py-1 text-[10px] text-text-muted uppercase tracking-wider">Members</div>
          {mentionMatches.map((u, i) => (
            <button
              key={u.id}
              role="option"
              aria-selected={i === mentionIndex}
              onClick={() => insertMention(u.username)}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                i === mentionIndex ? 'bg-primary/20 text-text-primary' : 'text-text-secondary hover:bg-white/5'
              }`}
            >
              <span className="text-primary font-medium">@</span>
              <span>{u.username}</span>
            </button>
          ))}
        </div>
      )}

      {/* Emoji shortcode autocomplete */}
      {emojiQuery !== null && emojiMatches.length > 0 && (
        <div role="listbox" className="absolute bottom-full left-4 right-4 mb-1 bg-surface border border-divider rounded-xl shadow-float py-1 max-h-[280px] overflow-y-auto z-50">
          <div className="px-3 py-1 text-[10px] text-text-muted uppercase tracking-wider">Emoji matching :{emojiQuery}</div>
          {emojiMatches.map((entry, i) => (
            <button
              key={entry.name}
              role="option"
              aria-selected={i === emojiIndex}
              onClick={() => insertEmoji(entry.emoji)}
              className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 ${
                i === emojiIndex ? 'bg-primary/20 text-text-primary' : 'text-text-secondary hover:bg-white/5'
              }`}
            >
              <img src={emojiToImgUrl(entry.emoji)} alt={entry.emoji} className="w-5 h-5" loading="lazy" draggable={false} />
              <span className="text-text-muted">:{entry.name}:</span>
            </button>
          ))}
        </div>
      )}

      {showEmoji && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowEmoji(false)} />
          <div className="absolute bottom-full left-4 mb-2 z-50">
            <Suspense fallback={<div className="w-[350px] h-[400px] bg-surface rounded-lg flex items-center justify-center text-text-muted text-sm">Loading...</div>}>
              <LazyEmojiPicker
                theme={(localStorage.getItem('jolkr_theme') === 'light' ? 'light' : 'dark') as never}
                onEmojiClick={(emoji: { emoji: string }) => {
                  setContent((prev) => prev + emoji.emoji);
                  inputRef.current?.focus();
                }}
                width={350}
                height={400}
              />
            </Suspense>
          </div>
        </>
      )}

      {/* Reply bar */}
      {replyTo && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-surface/50 border-l-2 border-primary rounded-t-lg mb-1">
          <svg className="w-3.5 h-3.5 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
          <span className="text-xs text-text-muted">Replying to</span>
          <span className="text-xs text-text-primary font-medium">{replyAuthor?.username ?? 'Unknown'}</span>
          <span className="text-xs text-text-muted truncate flex-1">{replyTo.content}</span>
          <button onClick={onCancelReply} className="text-text-muted hover:text-text-primary shrink-0" aria-label="Cancel reply">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
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
          <div className="text-[11px] text-warning flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Slowmode: {slowmodeCooldown}s remaining
          </div>
        ) : sendError ? (
          <div className="text-[11px] text-error">{sendError}</div>
        ) : uploading ? (
          <div className="text-[11px] text-text-muted">Uploading files...</div>
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

      {/* Formatting toolbar */}
      <div className="flex items-center gap-0.5 mb-1 px-1 py-0.5 rounded-lg bg-surface/50 border border-divider/50 w-fit">
        <button onClick={() => insertFormatting('**', '**')} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/[0.08] transition-colors" title="Bold (Ctrl+B)">
          <span className="text-xs font-bold w-5 h-5 flex items-center justify-center">B</span>
        </button>
        <button onClick={() => insertFormatting('*', '*')} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/[0.08] transition-colors" title="Italic (Ctrl+I)">
          <span className="text-xs italic w-5 h-5 flex items-center justify-center">I</span>
        </button>
        <button onClick={() => insertFormatting('~~', '~~')} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/[0.08] transition-colors" title="Strikethrough">
          <span className="text-xs line-through w-5 h-5 flex items-center justify-center">S</span>
        </button>
        <div className="w-px h-4 bg-divider/50 mx-0.5" />
        <button onClick={() => insertFormatting('`', '`')} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/[0.08] transition-colors" title="Inline Code">
          <span className="text-xs font-mono w-5 h-5 flex items-center justify-center">&lt;/&gt;</span>
        </button>
        <button onClick={() => insertFormatting('```\n', '\n```')} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/[0.08] transition-colors" title="Code Block">
          <span className="text-[10px] font-mono w-5 h-5 flex items-center justify-center">[/]</span>
        </button>
        <div className="w-px h-4 bg-divider/50 mx-0.5" />
        <button onClick={() => insertFormatting('> ', '')} className="p-1.5 text-text-muted hover:text-text-primary rounded-md hover:bg-white/[0.08] transition-colors" title="Quote">
          <span className="text-xs w-5 h-5 flex items-center justify-center">"</span>
        </button>
      </div>

      <div className={`input-container flex items-center gap-2 bg-input rounded-xl px-4 py-2.5 border border-divider transition-all ${inputFocused ? 'border-primary/50 shadow-[0_0_0_3px_rgba(124,107,245,0.15)]' : 'hover:border-divider/80'}`} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}>
        {canAttach && (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-text-muted hover:text-text-primary py-1"
            title="Attach file"
            aria-label="Attach file"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}

        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { emojiJustToggledRef.current = true; setShowEmoji(!showEmoji); setTimeout(() => { emojiJustToggledRef.current = false; }, 100); }}
          className="text-text-muted hover:text-text-primary py-1"
          title="Emoji"
          aria-label="Emoji"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        <div className="relative flex flex-1 self-center">
          {/* Emoji image overlay — shows rendered content with pretty emoji images */}
          {content && (
            <div
              ref={overlayRef}
              className="absolute inset-0 text-text-primary text-sm py-1 whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
              dangerouslySetInnerHTML={{ __html: renderInputEmojis(content) }}
            />
          )}
          <textarea
            ref={inputRef}
            value={content}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => { if (!emojiJustToggledRef.current) setShowEmoji(false); }}
            placeholder="Type a message..."
            rows={1}
            className="relative w-full bg-transparent text-transparent caret-text-primary text-sm resize-none max-h-[120px] py-1 placeholder:text-text-muted selection:bg-primary/30"
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

        <button
          onClick={handleSend}
          disabled={(!content.trim() && files.length === 0) || sending || slowmodeCooldown > 0}
          className="text-primary hover:text-primary-hover disabled:text-text-muted py-1"
          title={slowmodeCooldown > 0 ? `Slowmode: ${slowmodeCooldown}s` : undefined}
          aria-label="Send message"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
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
