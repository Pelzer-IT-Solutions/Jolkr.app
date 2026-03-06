import { useEffect, useState } from 'react';
import type { Thread } from '../api/types';
import * as api from '../api/client';
import { useMessagesStore } from '../stores/messages';

interface Props {
  channelId: string;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}

export default function ThreadListPanel({ channelId, onClose, onOpenThread }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const threadListVersion = useMessagesStore((s) => s.threadListVersion);

  useEffect(() => {
    setLoading(true);
    api.getThreads(channelId, showArchived)
      .then((t) => { setThreads(t); setError(false); })
      .catch(() => { setThreads([]); setError(true); })
      .finally(() => setLoading(false));
  }, [channelId, showArchived, threadListVersion]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-0 z-50 w-full max-w-[360px] h-full bg-surface border-l border-divider flex flex-col shadow-xl">
        <div className="h-14 px-4 flex items-center justify-between border-b border-divider shrink-0">
          <h3 className="text-text-primary font-semibold text-sm">Threads</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-divider"
              />
              Archived
            </label>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close threads">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {loading && (
            <div className="text-center text-text-muted text-sm py-8">Loading...</div>
          )}
          {!loading && error && (
            <div className="text-center text-error/70 text-sm py-8">Failed to load threads</div>
          )}
          {!loading && !error && threads.length === 0 && (
            <div className="text-center text-text-muted text-sm py-8">No threads yet.</div>
          )}
          {threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => {
                onOpenThread(thread.id);
                onClose();
              }}
              className="w-full text-left mb-2 p-3 bg-background rounded-lg border border-divider hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                <span className="text-sm font-medium text-text-primary truncate flex-1">
                  {thread.name ?? 'Thread'}
                </span>
                {thread.is_archived && (
                  <span className="text-[10px] text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-muted">
                <span>{thread.message_count} {thread.message_count === 1 ? 'reply' : 'replies'}</span>
                <span>Last activity {formatRelativeTime(thread.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
