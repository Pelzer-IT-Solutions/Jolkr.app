import { useEffect, useRef, useState } from 'react';
import { useMessagesStore } from '../stores/messages';
import { usePresenceStore } from '../stores/presence';
import { useAuthStore } from '../stores/auth';
import { wsClient } from '../api/ws';
import * as api from '../api/client';
import type { Message, User } from '../api/types';
import MessageTile from './MessageTile';

const EMPTY_MSGS: Message[] = [];
const EMPTY_TYPING: string[] = [];

interface Props {
  channelId: string;
  search?: string;
  searchResults?: Message[] | null;
  searchLoading?: boolean;
  isDm?: boolean;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
}

export default function MessageList({ channelId, search, searchResults, searchLoading, isDm, onReply, onOpenThread }: Props) {
  const fetchMessages = useMessagesStore((s) => s.fetchMessages);
  const fetchOlder = useMessagesStore((s) => s.fetchOlder);
  const channelMessages = useMessagesStore((s) => s.messages[channelId]);
  const isLoading = useMessagesStore((s) => s.loading[channelId]);
  const isLoadingOlder = useMessagesStore((s) => s.loadingOlder[channelId]);
  const canLoadMore = useMessagesStore((s) => s.hasMore[channelId]);
  const typingUsers = usePresenceStore((s) => s.typing[channelId]) ?? EMPTY_TYPING;
  const currentUser = useAuthStore((s) => s.user);
  const allMsgs = channelMessages ?? EMPTY_MSGS;
  // Use server-side search results when available (for non-DM channels), otherwise client-side filter
  const msgs = searchResults
    ? searchResults
    : search
      ? allMsgs.filter((m) => m.content.toLowerCase().includes(search.toLowerCase()))
      : allMsgs;
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);
  const [users, setUsers] = useState<Record<string, User>>({});
  const fetchedIdsRef = useRef(new Set<string>());
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    prevLenRef.current = 0;
    fetchMessages(channelId, isDm);
    wsClient.subscribe(channelId);
    return () => { wsClient.unsubscribe(channelId); };
  }, [channelId, isDm, fetchMessages]);

  // Fetch user info for message authors
  useEffect(() => {
    const uniqueIds = [...new Set(allMsgs.map((m) => m.author_id))];
    uniqueIds.forEach((id) => {
      if (!fetchedIdsRef.current.has(id)) {
        fetchedIdsRef.current.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {
          // Allow retry on failure
          fetchedIdsRef.current.delete(id);
        });
      }
    });
  }, [allMsgs]);

  // Auto-scroll: always on initial load, only near bottom for new messages
  useEffect(() => {
    if (allMsgs.length > prevLenRef.current) {
      const wasInitialLoad = prevLenRef.current === 0;
      if (wasInitialLoad) {
        // Initial load — always scroll to bottom (instant, no animation)
        bottomRef.current?.scrollIntoView();
      } else {
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
    }
    prevLenRef.current = allMsgs.length;
  }, [allMsgs.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 300);
    if (canLoadMore && !isLoadingOlder && el.scrollTop < 100) {
      fetchOlder(channelId, isDm);
    }
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const isCompact = (i: number) => {
    if (i === 0) return false;
    const prev = msgs[i - 1];
    const curr = msgs[i];
    if (prev.author_id !== curr.author_id) return false;
    // Don't compact if this message is a reply
    if (curr.reply_to_id) return false;
    const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff < 5 * 60 * 1000;
  };

  // Lookup reply message and author
  const getReplyData = (msg: Message) => {
    if (!msg.reply_to_id) return {};
    const replyMessage = allMsgs.find((m) => m.id === msg.reply_to_id);
    const replyAuthor = replyMessage ? users[replyMessage.author_id] : undefined;
    return { replyMessage, replyAuthor };
  };

  const otherTyping = typingUsers.filter((id) => id !== currentUser?.id);

  return (
    <div className="flex flex-col h-full relative min-h-0">
      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}>
        {(isLoading || searchLoading) && msgs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted">
            {searchLoading ? 'Searching...' : 'Loading messages...'}
          </div>
        ) : msgs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted">
            {search ? 'No messages match your search.' : 'No messages yet. Start the conversation!'}
          </div>
        ) : (
          <div className="py-4">
            {isLoadingOlder && (
              <div className="text-center text-text-muted text-sm py-2">Loading older messages...</div>
            )}
            {msgs.map((msg, i) => {
              const { replyMessage, replyAuthor } = getReplyData(msg);
              // Date separator between messages from different days
              const showDateSep = i === 0 || (
                new Date(msgs[i - 1].created_at).toDateString() !== new Date(msg.created_at).toDateString()
              );
              return (
                <div key={msg.id}>
                  {showDateSep && (
                    <div className="flex items-center gap-3 px-4 my-3">
                      <div className="flex-1 h-px bg-divider" />
                      <span className="text-[11px] text-text-muted font-medium">
                        {new Date(msg.created_at).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      <div className="flex-1 h-px bg-divider" />
                    </div>
                  )}
                  <MessageTile
                    message={msg}
                    compact={!showDateSep && isCompact(i)}
                    author={users[msg.author_id]}
                    isDm={isDm}
                    onReply={onReply}
                    onOpenThread={onOpenThread}
                    replyMessage={replyMessage}
                    replyAuthor={replyAuthor}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-16 right-4 w-9 h-9 bg-surface border border-divider rounded-full flex items-center justify-center shadow-lg hover:bg-white/10 transition-colors z-10"
          title="Scroll to bottom"
        >
          <svg className="w-4 h-4 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      {otherTyping.length > 0 && (
        <div className="px-4 py-1 text-[11px] text-text-muted shrink-0">
          <span className="inline-flex gap-0.5 mr-1">
            <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
            <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
          </span>
          {(() => {
            const names = otherTyping.map((id) => users[id]?.username ?? 'Someone');
            if (names.length === 1) return `${names[0]} is typing...`;
            if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
            return `${names[0]} and ${names.length - 1} others are typing...`;
          })()}
        </div>
      )}
    </div>
  );
}
