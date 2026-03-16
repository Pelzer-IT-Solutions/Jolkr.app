import { useEffect, useState, useRef, memo } from 'react';
import { X } from 'lucide-react';
import type { Message, User } from '../api/types';
import * as api from '../api/client';
import Avatar from './Avatar';
import MessageContent from './MessageContent';

export interface PinnedMessagesPanelProps {
  channelId: string;
  onClose: () => void;
  isDm?: boolean;
}

function PinnedMessagesPanelInner({ channelId, onClose, isDm }: PinnedMessagesPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const userCache = useRef<Record<string, User>>({});
  const [users, setUsers] = useState<Record<string, User>>({});

  useEffect(() => {
    setLoading(true);
    (isDm ? api.getDmPinnedMessages(channelId) : api.getPinnedMessages(channelId))
      .then(async (msgs) => {
        setMessages(msgs);
        // Fetch authors
        const ids = [...new Set(msgs.map((m) => m.author_id))];
        const toFetch = ids.filter((id) => !userCache.current[id]);
        const fetched = await Promise.allSettled(toFetch.map((id) => api.getUser(id)));
        fetched.forEach((r, i) => {
          if (r.status === 'fulfilled') userCache.current[toFetch[i]] = r.value;
        });
        setUsers({ ...userCache.current });
      })
      .catch((e) => {
        console.warn('Failed to load pinned messages:', e);
        setMessages([]);
        setFetchError(true);
      })
      .finally(() => setLoading(false));
  }, [channelId]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-0 z-50 w-90 h-full bg-sidebar border-l border-divider flex flex-col shadow-popup">
        <div className="px-5 py-3 flex items-center justify-between border-b border-divider shrink-0">
          <h3 className="text-text-primary font-semibold text-sm">Pinned Messages</h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary" aria-label="Close pinned messages">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {loading && (
            <div className="text-center text-text-tertiary text-sm py-8">Loading...</div>
          )}
          {!loading && fetchError && (
            <div className="text-center text-danger text-sm py-8">Failed to load pinned messages</div>
          )}
          {!loading && !fetchError && messages.length === 0 && (
            <div className="text-center text-text-tertiary text-sm py-8">No pinned messages yet.</div>
          )}
          {messages.map((msg) => {
            const author = users[msg.author_id];
            const time = new Date(msg.created_at);
            return (
              <div key={msg.id} className="mb-3 p-3 bg-panel rounded-xl border border-divider">
                <div className="flex items-center gap-2 mb-1">
                  <Avatar url={author?.avatar_url} name={author?.username ?? '?'} size={20} userId={msg.author_id} />
                  <span className="text-sm font-medium text-text-primary">{author?.username ?? 'Unknown'}</span>
                  <span className="text-xs text-text-tertiary">
                    {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <MessageContent content={msg.content} className="text-sm text-text-primary/90" />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const PinnedMessagesPanel = memo(PinnedMessagesPanelInner);
export default PinnedMessagesPanel;
