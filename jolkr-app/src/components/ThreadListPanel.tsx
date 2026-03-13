import { useEffect, useState, memo } from 'react';
import { X, MessageSquare } from 'lucide-react';
import type { Thread } from '../api/types';
import * as api from '../api/client';
import { useMessagesStore } from '../stores/messages';

export interface ThreadListPanelProps {
  channelId: string;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}

function ThreadListPanelInner({ channelId, onClose, onOpenThread }: ThreadListPanelProps) {
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
      <div className="absolute right-0 top-0 z-50 w-full max-w-90 h-full bg-sidebar border-l border-divider flex flex-col shadow-popup">
        <div className="px-5 py-3 flex items-center justify-between border-b border-divider shrink-0">
          <h3 className="text-text-primary font-semibold text-sm">Threads</h3>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-divider"
              />
              Archived
            </label>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close threads">
              <X className="w-5 h-5" />
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
              className="w-full text-left mb-2 p-3 bg-bg-tertiary rounded-xl border border-divider hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-text-muted shrink-0" />
                <span className="text-sm font-medium text-text-primary truncate flex-1">
                  {thread.name ?? 'Thread'}
                </span>
                {thread.is_archived && (
                  <span className="text-2xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                    Archived
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
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

const ThreadListPanel = memo(ThreadListPanelInner);
export default ThreadListPanel;

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
