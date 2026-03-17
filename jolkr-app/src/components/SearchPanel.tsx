import { useCallback, useEffect, useRef, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import SidePanel from './SidePanel';
import EmptyState from './ui/EmptyState';
import Avatar from './Avatar';
import MessageContent from './MessageContent';
import type { Message, User } from '../api/types';
import * as api from '../api/client';
import { useMessagesStore } from '../stores/messages';

export interface SearchPanelProps {
  channelId: string;
  isDm?: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

export default function SearchPanel({ channelId, isDm, onClose, onJumpToMessage }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<Record<string, User>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const fetchedIds = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch user info for search result authors
  useEffect(() => {
    if (!results) return;
    const ids = [...new Set(results.map((m) => m.author_id))];
    ids.forEach((id) => {
      if (!fetchedIds.current.has(id)) {
        fetchedIds.current.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {
          fetchedIds.current.delete(id);
        });
      }
    });
  }, [results]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      if (isDm) {
        // Client-side search for DMs (E2EE)
        const allMessages = useMessagesStore.getState().messages[channelId] ?? [];
        const q = value.trim().toLowerCase();
        const filtered = allMessages.filter((m) =>
          m.content?.toLowerCase().includes(q),
        );
        setResults(filtered);
        setLoading(false);
      } else {
        // Server-side search for channels
        const filterRegex = /(?:from|has|before|after):\S+/g;
        const filters = value.match(filterRegex) ?? [];
        const textQuery = value.replace(filterRegex, '').trim();

        const params: { q?: string; from?: string; has?: string; before?: string; after?: string } = {};
        if (textQuery) params.q = textQuery;
        for (const f of filters) {
          const [key, val] = f.split(':');
          if (key === 'from') params.from = val;
          else if (key === 'has') params.has = val;
          else if (key === 'before') params.before = new Date(val).toISOString();
          else if (key === 'after') params.after = new Date(val).toISOString();
        }

        const hasFilters = params.from || params.has || params.before || params.after;
        const searchFn = hasFilters
          ? api.searchMessagesAdvanced(channelId, params)
          : api.searchMessages(channelId, value.trim());

        searchFn
          .then((msgs) => setResults(msgs.reverse()))
          .catch(() => setResults(null))
          .finally(() => setLoading(false));
      }
    }, 300);
  }, [channelId, isDm]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <SidePanel title="Search" onClose={onClose}>
      <div className="flex-1 flex flex-col min-h-0">
        {/* Search input */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && !query) onClose(); }}
            placeholder={isDm ? 'Search messages...' : 'Search... (from:user has:file before:date)'}
            className="w-full px-3 py-2 bg-bg border border-divider rounded-lg text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent"
          />
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {loading && (
            <div className="text-center text-text-tertiary text-sm py-8">Searching...</div>
          )}
          {!loading && results !== null && results.length === 0 && (
            <EmptyState icon={<SearchIcon className="size-8" />} title="No messages match your search." />
          )}
          {!loading && results === null && query.trim().length < 2 && (
            <div className="text-center text-text-tertiary text-sm py-8">
              Type at least 2 characters to search
            </div>
          )}
          {results?.map((msg) => {
            const author = users[msg.author_id];
            const time = new Date(msg.created_at);
            return (
              <button
                key={msg.id}
                onClick={() => onJumpToMessage(msg.id)}
                className="w-full text-left mb-3 p-3 bg-panel rounded-xl border border-divider hover:border-accent/50 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Avatar url={author?.avatar_url} name={author?.username ?? '?'} size={20} userId={msg.author_id} />
                  <span className="text-sm font-medium text-text-primary">{author?.username ?? 'Unknown'}</span>
                  <span className="text-xs text-text-tertiary">
                    {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <MessageContent content={msg.content} className="text-sm text-text-primary/90 line-clamp-3" />
              </button>
            );
          })}
        </div>
      </div>
    </SidePanel>
  );
}
