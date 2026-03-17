import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
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

// Module-level caches — persist across channel switches
let userCache: Record<string, User> = {};
let fetchedUserIds = new Set<string>();
let failedUserIds = new Set<string>();
const scrollPositionCache = new Map<string, number>();

export interface MessageListProps {
  channelId: string;
  search?: string;
  searchResults?: Message[] | null;
  searchLoading?: boolean;
  isDm?: boolean;
  hideActions?: boolean;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
}

export default function MessageList({ channelId, search, searchResults, searchLoading, isDm, hideActions, onReply, onOpenThread }: MessageListProps) {
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
  const prevChannelIdRef = useRef(channelId);
  const [users, setUsers] = useState<Record<string, User>>(userCache);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isAtBottomRef = useRef(true);
  const lastSeenMsgId = useUnreadStore((s) => s.lastSeenMessageId[channelId]);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const unreadSepIndex = useMemo(() => {
    if (!lastSeenMsgId) return -1;
    const idx = msgs.findIndex((m) => m.id === lastSeenMsgId);
    if (idx === -1 || idx === msgs.length - 1) return -1;
    const hasOtherMessages = msgs.slice(idx + 1).some((m) => m.author_id !== currentUserId);
    if (!hasOtherMessages) return -1;
    return idx + 1;
  }, [lastSeenMsgId, msgs, currentUserId]);

  // Channel switch: save position, subscribe, fetch, restore
  useEffect(() => {
    const el = containerRef.current;
    if (prevChannelIdRef.current !== channelId && el) {
      scrollPositionCache.set(prevChannelIdRef.current, el.scrollTop);
    }
    prevChannelIdRef.current = channelId;

    fetchMessages(channelId, isDm);
    wsClient.subscribe(channelId);
    return () => {
      if (containerRef.current) {
        scrollPositionCache.set(channelId, containerRef.current.scrollTop);
      }
      wsClient.unsubscribe(channelId);
    };
  }, [channelId, isDm, fetchMessages]);

  // Restore saved scroll position when messages arrive for a cached channel
  useEffect(() => {
    const el = containerRef.current;
    if (!el || msgs.length === 0) return;
    const savedPos = scrollPositionCache.get(channelId);
    if (savedPos !== undefined) {
      el.scrollTop = savedPos;
      scrollPositionCache.delete(channelId);
    }
  }, [msgs.length > 0, channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user info for message authors (uses module-level cache)
  useEffect(() => {
    const uniqueIds = [...new Set(allMsgs.map((m) => m.author_id))];
    uniqueIds.forEach((id) => {
      if (!fetchedUserIds.has(id) && !failedUserIds.has(id)) {
        fetchedUserIds.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => {
            const next = { ...prev, [u.id]: u };
            userCache = next;
            return next;
          });
        }).catch(() => {
          fetchedUserIds.delete(id);
          failedUserIds.add(id);
        });
      }
    });
  }, [allMsgs]);

  // In column-reverse: scrollTop=0 is the bottom, |scrollTop| is distance from bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = Math.abs(el.scrollTop);
    isAtBottomRef.current = distFromBottom < 150;
    setShowScrollBtn(distFromBottom > 300);
    // Load older messages when scrolled near the top (oldest content)
    const distFromTop = el.scrollHeight - el.clientHeight - distFromBottom;
    if (canLoadMore && !isLoadingOlder && distFromTop < 200) {
      fetchOlder(channelId, isDm);
    }
  }, [canLoadMore, isLoadingOlder, channelId, isDm, fetchOlder]);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: 'smooth' });
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

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
      {/* column-reverse: browser natively starts scroll at bottom, no JS hacks needed */}
      <div ref={containerRef} className="flex-1 flex flex-col-reverse overflow-y-auto min-h-0" onScroll={handleScroll}>
        <div className="py-4">
          {((isLoading || searchLoading) && msgs.length === 0) || (notYetFetched && !search && !searchResults) ? (
            <div className="flex items-center justify-center py-20">
              {searchLoading ? (
                <span className="text-text-tertiary">Searching...</span>
              ) : (
                <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
              )}
            </div>
          ) : msgs.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-text-tertiary">
              {search ? 'No messages match your search.' : 'No messages yet. Start the conversation!'}
            </div>
          ) : (
            <>
            {isLoadingOlder && (
              <div className="text-center text-text-tertiary text-sm py-2">Loading older messages...</div>
            )}
            {msgs.map((msg, i) => {
              const { replyMessage, replyAuthor } = getReplyData(msg);
              const hasSep = showDateSep(i);
              return (
                <div key={msg.id}>
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
                    hideActions={hideActions}
                    replyMessage={replyMessage}
                    replyAuthor={replyAuthor}
                  />
                </div>
              );
            })}
            </>
          )}
        </div>
      </div>

      {showScrollBtn && (
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
