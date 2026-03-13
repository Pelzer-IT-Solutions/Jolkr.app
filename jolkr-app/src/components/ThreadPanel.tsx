import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Archive, X, Send } from 'lucide-react';
import type { Message, User, Thread } from '../api/types';
import { useMessagesStore } from '../stores/messages';
import * as api from '../api/client';
import MessageTile from './MessageTile';
import MessageContent from './MessageContent';
import Avatar from './Avatar';

export interface ThreadPanelProps {
  threadId: string;
  channelId: string;
  onClose: () => void;
}

export default function ThreadPanel({ threadId, channelId, onClose }: ThreadPanelProps) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [starterMessage, setStarterMessage] = useState<Message | null>(null);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [users, setUsers] = useState<Record<string, User>>({});
  const fetchedIdsRef = useRef(new Set<string>());
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const threadMessages = useMessagesStore((s) => s.threadMessages[threadId]);
  const isLoading = useMessagesStore((s) => s.threadLoading[threadId]);
  const isLoadingOlder = useMessagesStore((s) => s.threadLoadingOlder[threadId]);
  const canLoadMore = useMessagesStore((s) => s.threadHasMore[threadId]);
  const fetchThreadMessages = useMessagesStore((s) => s.fetchThreadMessages);
  const fetchOlderThreadMessages = useMessagesStore((s) => s.fetchOlderThreadMessages);
  const sendThreadMessage = useMessagesStore((s) => s.sendThreadMessage);
  const clearThreadMessages = useMessagesStore((s) => s.clearThreadMessages);

  const msgs = threadMessages ?? [];

  // Fetch thread info + messages on mount / thread change
  useEffect(() => {
    let stale = false;
    setThread(null);
    setStarterMessage(null);
    prevLenRef.current = 0;
    fetchedIdsRef.current = new Set();
    setThreadError(false);
    api.getThread(threadId).then((t) => { if (!stale) setThread(t); }).catch(() => { if (!stale) setThreadError(true); });
    fetchThreadMessages(threadId);
    return () => {
      stale = true;
      clearThreadMessages(threadId);
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
    };
  }, [threadId, fetchThreadMessages, clearThreadMessages]);

  // Fetch starter message from channel store (updates reactively)
  const channelMessages = useMessagesStore((s) => s.messages[channelId]);
  useEffect(() => {
    if (!thread?.starter_msg_id) return;
    const starter = channelMessages?.find((m) => m.id === thread.starter_msg_id);
    if (starter) setStarterMessage(starter);
  }, [thread?.starter_msg_id, channelMessages]);

  // Fetch user info for authors
  useEffect(() => {
    const allMsgs = starterMessage ? [starterMessage, ...msgs] : msgs;
    const uniqueIds = [...new Set(allMsgs.map((m) => m.author_id))];
    uniqueIds.forEach((id) => {
      if (!fetchedIdsRef.current.has(id)) {
        fetchedIdsRef.current.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {
          fetchedIdsRef.current.delete(id);
        });
      }
    });
  }, [msgs, starterMessage]);

  // Auto-scroll near bottom
  useEffect(() => {
    if (msgs.length > prevLenRef.current) {
      const el = containerRef.current;
      if (el) {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom < 150) {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      } else {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevLenRef.current = msgs.length;
  }, [msgs.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || !canLoadMore) return;
    if (!isLoadingOlder && el.scrollTop < 100) {
      fetchOlderThreadMessages(threadId);
    }
  };

  const handleSend = async () => {
    const text = content.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const savedContent = content;
    try {
      await sendThreadMessage(threadId, text, replyTo?.id);
      setContent('');
      setReplyTo(null);
      if (inputRef.current) inputRef.current.style.height = 'auto';
    } catch (e) {
      setContent(savedContent);
      setSendError((e as Error).message || 'Failed to send message');
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
      sendErrorTimerRef.current = setTimeout(() => setSendError(null), 4000);
    } finally {
      setSending(false);
    }
    inputRef.current?.focus();
  };

  const handleArchive = async () => {
    if (!thread) return;
    try {
      const updated = await api.updateThread(threadId, { is_archived: !thread.is_archived });
      setThread(updated);
    } catch (e) {
      setSendError((e as Error).message || 'Failed to update thread');
      if (sendErrorTimerRef.current) clearTimeout(sendErrorTimerRef.current);
      sendErrorTimerRef.current = setTimeout(() => setSendError(null), 4000);
    }
  };

  const isCompact = (i: number) => {
    if (i === 0) return false;
    const prev = msgs[i - 1];
    const curr = msgs[i];
    if (prev.author_id !== curr.author_id) return false;
    if (curr.reply_to_id) return false;
    const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff < 5 * 60 * 1000;
  };

  const getReplyData = (msg: Message) => {
    if (!msg.reply_to_id) return {};
    // Search in thread messages first, then channel messages
    const replyMessage = msgs.find((m) => m.id === msg.reply_to_id)
      ?? (channelMessages ?? []).find((m) => m.id === msg.reply_to_id);
    const replyAuthor = replyMessage ? users[replyMessage.author_id] : undefined;
    return { replyMessage, replyAuthor };
  };

  const threadName = thread?.name ?? 'Thread';

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-0 z-50 w-full max-w-100 h-full bg-sidebar border-l border-divider flex flex-col shadow-popup">
        {/* Header */}
        <div className="px-5 py-3 flex items-center gap-2 border-b border-divider shrink-0">
          <MessageSquare className="w-5 h-5 text-text-tertiary shrink-0" />
          <h3 className="text-text-primary font-semibold text-sm flex-1 truncate">{threadName}</h3>
          {thread && (
            <button
              onClick={handleArchive}
              className="text-text-tertiary hover:text-text-primary"
              title={thread.is_archived ? 'Unarchive Thread' : 'Archive Thread'}
              aria-label={thread.is_archived ? 'Unarchive Thread' : 'Archive Thread'}
            >
              <Archive className={`w-4 h-4 ${thread.is_archived ? 'text-yellow-500' : ''}`} />
            </button>
          )}
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary" aria-label="Close thread">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message area */}
        <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}>
          {/* Starter message */}
          {starterMessage && (
            <div className="px-4 py-3 border-b border-divider bg-panel">
              <div className="flex items-center gap-2 mb-1">
                <Avatar url={users[starterMessage.author_id]?.avatar_url} name={users[starterMessage.author_id]?.username ?? '?'} size={24} userId={starterMessage.author_id} />
                <span className="text-sm font-medium text-text-primary">{users[starterMessage.author_id]?.username ?? 'Unknown'}</span>
                <span className="text-xs text-text-tertiary">
                  {new Date(starterMessage.created_at).toLocaleString()}
                </span>
              </div>
              <MessageContent content={starterMessage.content} className="text-sm text-text-primary/90" />
            </div>
          )}

          {/* Thread error */}
          {threadError && !thread && (
            <div className="flex flex-col items-center justify-center py-8 text-text-tertiary text-sm gap-2">
              <span>Failed to load thread</span>
              <button
                onClick={() => { setThreadError(false); api.getThread(threadId).then(setThread).catch(() => setThreadError(true)); }}
                className="text-accent hover:underline text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {/* Thread replies */}
          {isLoading && msgs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-text-tertiary text-sm">
              Loading thread messages...
            </div>
          ) : msgs.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-text-tertiary text-sm">
              No replies yet. Start the conversation!
            </div>
          ) : (
            <div className="py-2">
              {isLoadingOlder && (
                <div className="text-center text-text-tertiary text-sm py-2">Loading older messages...</div>
              )}
              {msgs.map((msg, i) => {
                const { replyMessage, replyAuthor } = getReplyData(msg);
                return (
                  <MessageTile
                    key={msg.id}
                    message={msg}
                    compact={isCompact(i)}
                    author={users[msg.author_id]}
                    onReply={setReplyTo}
                    replyMessage={replyMessage}
                    replyAuthor={replyAuthor}
                    hideThreadButton
                  />
                );
              })}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        {thread?.is_archived ? (
          <div className="px-4 pb-4 pt-2 shrink-0">
            <div className="flex items-center bg-surface border border-divider rounded-lg px-4 py-3 opacity-60">
              <span className="text-text-tertiary text-sm">This thread is archived</span>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 pt-2 shrink-0">
            {replyTo && (
              <div className="flex items-center gap-2 px-4 py-1.5 bg-panel border-l-2 border-accent rounded-t mb-1">
                <span className="text-xs text-text-tertiary">Replying to</span>
                <span className="text-xs text-text-primary font-medium">
                  {users[replyTo.author_id]?.username ?? 'Unknown'}
                </span>
                <span className="text-xs text-text-tertiary truncate flex-1">{replyTo.content}</span>
                <button onClick={() => setReplyTo(null)} className="text-text-tertiary hover:text-text-primary shrink-0" aria-label="Cancel reply">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {sendError && (
              <div className="text-xs text-danger mb-1">{sendError}</div>
            )}
            <div className="flex items-end gap-2 bg-surface border border-divider rounded-xl px-4 py-2">
              <textarea
                ref={inputRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Reply in thread..."
                rows={1}
                className="flex-1 bg-transparent text-text-primary text-sm resize-none max-h-30 py-1 placeholder:text-text-tertiary"
                style={{ height: 'auto', minHeight: '24px' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                }}
              />
              <button
                onClick={handleSend}
                disabled={!content.trim() || sending}
                className="text-accent hover:text-accent-hover disabled:text-text-tertiary py-1"
                aria-label="Send reply"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
