import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronDown, Check, CircleCheck } from 'lucide-react';
import * as api from '../../../api/client';
import type { Server, AuditLogEntry, User } from '../../../api/types';
import Avatar from '../../Avatar';

export interface AuditLogTabProps {
  server: Server;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  member_kick: 'Kicked member',
  member_ban: 'Banned member',
  member_unban: 'Unbanned member',
  channel_create: 'Created channel',
  channel_delete: 'Deleted channel',
  role_create: 'Created role',
  role_update: 'Updated role',
  role_delete: 'Deleted role',
};

const AUDIT_PAGE_SIZE = 25;

export default function AuditLogTab({ server }: AuditLogTabProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState('');
  const fetchedIdsRef = useRef(new Set<string>());

  const fetchUsers = useCallback((newEntries: AuditLogEntry[]) => {
    const ids = new Set<string>();
    for (const e of newEntries) {
      ids.add(e.user_id);
      if (e.target_id && e.target_type === 'user') ids.add(e.target_id);
    }
    ids.forEach((id) => {
      if (!fetchedIdsRef.current.has(id)) {
        fetchedIdsRef.current.add(id);
        api.getUser(id).then((u) => {
          setUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      }
    });
  }, []);

  const loadEntries = useCallback(async (before?: string) => {
    const params: { action?: string; limit?: number; before?: string } = {
      limit: AUDIT_PAGE_SIZE,
    };
    if (actionFilter) params.action = actionFilter;
    if (before) params.before = before;

    const data = await api.getAuditLog(server.id, params);
    setHasMore(data.length >= AUDIT_PAGE_SIZE);
    fetchUsers(data);
    return data;
  }, [server.id, actionFilter, fetchUsers]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setEntries([]);
    fetchedIdsRef.current.clear();
    loadEntries().then((data) => {
      if (!cancelled) setEntries(data);
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadEntries]);

  const handleLoadMore = async () => {
    if (entries.length === 0) return;
    setLoadingMore(true);
    setError('');
    try {
      const lastEntry = entries[entries.length - 1];
      const data = await loadEntries(lastEntry.id);
      setEntries((prev) => [...prev, ...data]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const formatTimestamp = (ts: string) => {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filterLabel = actionFilter ? (AUDIT_ACTION_LABELS[actionFilter] ?? actionFilter) : 'All actions';

  return (
    <div className="flex flex-col gap-5 min-h-full">
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded-lg">{error}</div>}

      {/* Filter label */}
      <div className="text-xs font-semibold text-text-muted tracking-wider uppercase shrink-0">Filter by action</div>

      {/* Filter dropdown */}
      <div className="relative shrink-0">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className="w-full rounded-lg bg-bg border border-divider px-3.5 py-2.5 flex justify-between items-center"
        >
          <span className="text-sm text-text-primary">{filterLabel}</span>
          <ChevronDown className="size-4 text-text-muted" />
        </button>
        {filterOpen && (
          <>
            <div className="fixed inset-0 z-60" onClick={() => setFilterOpen(false)} />
            <div className="absolute top-full left-0 right-0 mt-1 z-70 bg-surface border border-divider rounded-lg shadow-popup py-1 max-h-60 overflow-y-auto">
              <button
                onClick={() => { setActionFilter(''); setFilterOpen(false); }}
                className="w-full px-3.5 py-2 text-left text-sm flex items-center justify-between hover:bg-bg-hover"
              >
                <span className={actionFilter === '' ? 'text-text-primary' : 'text-text-secondary'}>All actions</span>
                {actionFilter === '' && <Check className="size-4 text-online" />}
              </button>
              {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => { setActionFilter(value); setFilterOpen(false); }}
                  className="w-full px-3.5 py-2 text-left text-sm flex items-center justify-between hover:bg-bg-hover"
                >
                  <span className={actionFilter === value ? 'text-text-primary' : 'text-text-secondary'}>{label}</span>
                  {actionFilter === value && <Check className="size-4 text-online" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Loading audit log...</div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No audit log entries found.</div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          {entries.map((entry) => {
            const user = users[entry.user_id];
            const targetUser = entry.target_id && entry.target_type === 'user' ? users[entry.target_id] : null;
            const actionLabel = AUDIT_ACTION_LABELS[entry.action_type] ?? entry.action_type;
            const targetDisplay = targetUser
              ? targetUser.username
              : entry.target_id
                ? entry.target_id.slice(0, 8)
                : null;

            return (
              <div key={entry.id} className="py-3 gap-3 flex items-center border-b border-border-subtle">
                <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={32} userId={entry.user_id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 text-sm">
                    <span className="font-medium text-text-primary">{user?.username ?? entry.user_id.slice(0, 8)}</span>
                    <span className="text-text-secondary">{actionLabel}</span>
                    {targetDisplay && (
                      <span className="font-medium text-text-primary">{targetDisplay}</span>
                    )}
                  </div>
                  {entry.reason && (
                    <div className="text-text-muted text-xs mt-0.5">Reason: {entry.reason}</div>
                  )}
                  <div className="text-text-muted text-xs mt-0.5">
                    {formatTimestamp(entry.created_at)}
                  </div>
                </div>
                <CircleCheck className="size-4 text-success shrink-0" />
              </div>
            );
          })}

          {hasMore && (
            <div className="mt-3 text-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm text-primary hover:text-primary-hover disabled:opacity-50"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
