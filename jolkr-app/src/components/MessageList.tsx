import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMessagesStore } from '../stores/messages';
import { usePresenceStore } from '../stores/presence';
import { useAuthStore } from '../stores/auth';
import { useUnreadStore } from '../stores/unread';
import { wsClient } from '../api/ws';
import * as api from '../api/client';
import type { Message, User } from '../api/types';
import MessageTile from './MessageTile';

const EMPTY_MSGS: Message[] = [];
const EMPTY_TYPING: string[] = [];

export interface MessageListProps {
  channelId: string;
  search?: string;
  searchResults?: Message[] | null;
  searchLoading?: boolean;
  isDm?: boolean;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
}

export default function MessageList({ channelId, search, searchResults, searchLoading, isDm, onReply, onOpenThread }: MessageListProps) {
  const fetchMessages = useMessagesStore((s) => s.fetchMessages);
  const fetchOlder = useMessagesStore((s) => s.fetchOlder);
  const channelMessages = useMessagesStore((s) => s.messages[channelId]);
  const isLoading = useMessagesStore((s) => s.loading[channelId]);
  const isLoadingOlder = useMessagesStore((s) => s.loadingOlder[channelId]);
  const canLoadMore = useMessagesStore((s) => s.hasMore[channelId]);
  const typingUsers = usePresenceStore((s) => s.typing[channelId]) ?? EMPTY_TYPING;
  const currentUser = useAuthStore((s) => s.user);
  const notYetFetched = channelMessages === undefined;
  const allMsgs = channelMessages ?? EMPTY_MSGS;
  const msgs = searchResults
    ? searchResults
    : search
      ? allMsgs.filter((m) => m.content.toLowerCase().includes(search.toLowerCase()))
      : allMsgs;
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const [users, setUsers] = useState<Record<string, User>>({});
  const fetchedIdsRef = useRef(new Set<string>());
  const failedIdsRef = useRef(new Set<string>());
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const lastSeenMsgId = useUnreadStore((s) => s.lastSeenMessageId[channelId]);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const unreadSepIndex = useMemo(() => {
    if (!lastSeenMsgId) return -1;
    const idx = msgs.findIndex((m) => m.id === lastSeenMsgId);
    if (idx === -1 || idx === msgs.length - 1) return -1;
    // Don't show separator if all messages after it are from the current user
    const hasOtherMessages = msgs.slice(idx + 1).some((m) => m.author_id !== currentUserId);
    if (!hasOtherMessages) return -1;
    return idx + 1;
  }, [lastSeenMsgId, msgs, currentUserId]);

  // Virtualizer — use message IDs as item keys so stale measurements from
  // a previous channel are never reused (different messages = different keys).
  const virtualizer = useVirtualizer({
    count: msgs.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 60,
    overscan: 10,
    getItemKey: (index) => msgs[index]?.id ?? index,
  });

  useEffect(() => {
    prevLenRef.current = 0;
    initialScrollDoneRef.current = false;
    fetchedIdsRef.current.clear();
    failedIdsRef.current.clear();
    // Reset scroll position to prevent old channel's offset leaking into new channel
    containerRef.current?.scrollTo(0, 0);
    fetchMessages(channelId, isDm);
    wsClient.subscribe(channelId);
    return () => { wsClient.unsubscribe(channelId); };
  }, [channelId, isDm, fetchMessages]);

  // Fetch user info for message authors
  useEffect(() => {
    const uniqueIds = [...new Set(allMsgs.map((m) => m.author_id))];
    uniqueIds.forEach((id) => {
      if (!fetchedIdsRef.current.has(id) && !failedIdsRef.current.has(id)) {
        fetchedIdsRef.current.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {
          fetchedIdsRef.current.delete(id);
          failedIdsRef.current.add(id);
        });
      }
    });
  }, [allMsgs]);

  // Reset new message count on channel switch
  useEffect(() => {
    setNewMsgCount(0);
  }, [channelId]);

  // Auto-scroll logic — use raw DOM scroll to guarantee true bottom
  useEffect(() => {
    const added = allMsgs.length - prevLenRef.current;
    if (added > 0) {
      const el = containerRef.current;
      const wasInitialLoad = prevLenRef.current === 0;
      if (wasInitialLoad) {
        // Keep scrolling to bottom until container height stabilizes.
        let lastHeight = 0;
        let settled = 0;
        const keepScrolling = () => {
          if (!el) { initialScrollDoneRef.current = true; return; }
          el.scrollTop = el.scrollHeight;
          if (el.scrollHeight === lastHeight) {
            settled++;
          } else {
            settled = 0;
            lastHeight = el.scrollHeight;
          }
          if (settled < 20) {
            requestAnimationFrame(keepScrolling);
          } else {
            initialScrollDoneRef.current = true;
          }
        };
        requestAnimationFrame(keepScrolling);
      } else if (isAtBottomRef.current && el) {
        // New message while at bottom — scroll with stabilization
        let lastHeight = 0;
        let settled = 0;
        const keepScrolling = () => {
          if (!el) return;
          el.scrollTop = el.scrollHeight;
          if (el.scrollHeight === lastHeight) {
            settled++;
          } else {
            settled = 0;
            lastHeight = el.scrollHeight;
          }
          if (settled < 8) requestAnimationFrame(keepScrolling);
        };
        requestAnimationFrame(keepScrolling);
      } else if (!isAtBottomRef.current && initialScrollDoneRef.current) {
        // Scrolled up — show "new messages" indicator
        setNewMsgCount((c) => c + added);
      }
    }
    prevLenRef.current = allMsgs.length;
  }, [allMsgs.length, msgs.length, virtualizer, channelId]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distFromBottom < 150;
    setShowScrollBtn(distFromBottom > 300);
    if (distFromBottom < 150) setNewMsgCount(0);
    if (canLoadMore && !isLoadingOlder && el.scrollTop < 100) {
      fetchOlder(channelId, isDm);
    }
  }, [canLoadMore, isLoadingOlder, channelId, isDm, fetchOlder]);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewMsgCount(0);
  };

  const isCompact = (i: number) => {
    if (i === 0) return false;
    if (i === unreadSepIndex) return false;
    const prev = msgs[i - 1];
    const curr = msgs[i];
    if (prev.author_id !== curr.author_id) return false;
    if (curr.reply_to_id) return false;
    const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff < 5 * 60 * 1000;
  };

  const getReplyData = (msg: Message) => {
    if (!msg.reply_to_id) return {};
    const replyMessage = allMsgs.find((m) => m.id === msg.reply_to_id);
    const replyAuthor = replyMessage ? users[replyMessage.author_id] : undefined;
    return { replyMessage, replyAuthor };
  };

  const showDateSep = (i: number) => {
    if (i === 0) return true;
    return new Date(msgs[i - 1].created_at).toDateString() !== new Date(msgs[i].created_at).toDateString();
  };

  const otherTyping = typingUsers.filter((id) => id !== currentUser?.id);

  return (
    <div className="flex flex-col h-full relative min-h-0">
      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}>
        {((isLoading || searchLoading) && msgs.length === 0) || (notYetFetched && !search && !searchResults) ? (
          <div className="flex items-center justify-center h-full">
            {searchLoading ? (
              <span className="text-text-tertiary">Searching...</span>
            ) : (
              <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
            )}
          </div>
        ) : msgs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-tertiary">
            {search ? 'No messages match your search.' : 'No messages yet. Start the conversation!'}
          </div>
        ) : (
          <div className="min-h-full flex flex-col justify-end">
          <div
            className="py-4 relative"
            style={{ height: virtualizer.getTotalSize(), width: '100%' }}
          >
            {isLoadingOlder && (
              <div className="text-center text-text-tertiary text-sm py-2 absolute top-0 left-0 right-0 z-10">Loading older messages...</div>
            )}
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const i = virtualRow.index;
              const msg = msgs[i];
              const { replyMessage, replyAuthor } = getReplyData(msg);
              const hasSep = showDateSep(i);
              return (
                <div
                  key={msg.id}
                  data-index={i}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {hasSep && (
                    <div className="flex items-center gap-3 px-4 py-2">
                      <div className="flex-1 h-px bg-border-subtle" />
                      <span className="text-xs font-medium text-text-tertiary">
                        {new Date(msg.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      <div className="flex-1 h-px bg-border-subtle" />
                    </div>
                  )}
                  {i === unreadSepIndex && (
                    <div className="flex items-center gap-3 px-4 my-3">
                      <div className="flex-1 h-px bg-danger" />
                      <span className="text-xs text-danger font-semibold">NEW</span>
                      <div className="flex-1 h-px bg-danger" />
                    </div>
                  )}
                  <MessageTile
                    message={msg}
                    compact={!hasSep && isCompact(i)}
                    author={users[msg.author_id]}
                    isDm={isDm}
                    channelId={channelId}
                    onReply={onReply}
                    onOpenThread={onOpenThread}
                    replyMessage={replyMessage}
                    replyAuthor={replyAuthor}
                  />
                </div>
              );
            })}
          </div>
          </div>
        )}
      </div>

      {newMsgCount > 0 && showScrollBtn && (
        <button
          onClick={scrollToBottom}
          aria-live="polite"
          className="absolute bottom-16 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-accent hover:bg-accent/80 text-white text-sm font-medium rounded-full shadow-lg transition-colors z-10 flex items-center gap-2"
        >
          <ArrowDown className="w-4 h-4" />
          {newMsgCount === 1 ? '1 new message' : `${newMsgCount} new messages`}
        </button>
      )}

      {showScrollBtn && newMsgCount === 0 && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 right-4 size-10 bg-surface border border-divider rounded-full flex items-center justify-center shadow-elevated hover:bg-hover transition-colors z-10"
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="w-4 h-4 text-text-secondary" />
        </button>
      )}

      <div aria-live="polite" aria-atomic="true" className={`px-4 text-xs text-text-tertiary shrink-0 transition-all duration-150 overflow-hidden ${otherTyping.length > 0 ? 'h-6 opacity-100' : 'h-0 opacity-0 pointer-events-none'}`}>
        {otherTyping.length > 0 && (
          <>
            <span className="inline-flex gap-0.5 mr-1">
              <span className="animate-typing-dot" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-typing-dot" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-typing-dot" style={{ animationDelay: '300ms' }}>.</span>
            </span>
            {(() => {
              const names = otherTyping.map((id) => users[id]?.username ?? 'Someone');
              if (names.length === 1) return `${names[0]} is typing...`;
              if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
              return `${names[0]} and ${names.length - 1} others are typing...`;
            })()}
          </>
        )}
      </div>
    </div>
  );
}
