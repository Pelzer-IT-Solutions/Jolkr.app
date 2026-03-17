import { useEffect, useState, memo } from 'react';
import { MessageSquare } from 'lucide-react';
import EmptyState from './ui/EmptyState';
import type { Thread } from '../api/types';
import * as api from '../api/client';
import { useMessagesStore } from '../stores/messages';

export interface ThreadListPanelProps {
  channelId: string;
  onOpenThread: (threadId: string) => void;
}

function ThreadListPanelInner({ channelId, onOpenThread }: ThreadListPanelProps) {
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
    <div className="flex-1 overflow-y-auto min-h-0">
      {/* Archived toggle */}
      <div className="px-4 pt-3 pb-1 flex items-center">
        <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-divider"
          />
          Show archived
        </label>
      </div>

      <div className="p-3">
        {loading && (
          <div className="text-center text-text-tertiary text-sm py-8">Loading...</div>
        )}
        {!loading && error && (
          <div className="text-center text-danger/70 text-sm py-8">Failed to load threads</div>
        )}
        {!loading && !error && threads.length === 0 && (
          <EmptyState icon={<MessageSquare className="size-8" />} title="No threads yet." />
        )}
        {threads.map((thread) => (
          <button
            key={thread.id}
            onClick={() => onOpenThread(thread.id)}
            className="w-full text-left mb-2 p-3 bg-panel rounded-xl border border-divider hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-text-tertiary shrink-0" />
              <span className="text-sm font-medium text-text-primary truncate flex-1">
                {thread.name ?? 'Thread'}
              </span>
              {thread.is_archived && (
                <span className="text-2xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                  Archived
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-text-tertiary">
              <span>{thread.message_count} {thread.message_count === 1 ? 'reply' : 'replies'}</span>
              <span>Last activity {formatRelativeTime(thread.updated_at)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
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
