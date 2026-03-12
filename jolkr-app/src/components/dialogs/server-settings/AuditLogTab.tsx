import { useEffect, useRef, useState, useCallback } from 'react';
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

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded-lg mb-3">{error}</div>}

      {/* Filter */}
      <div className="mb-3">
        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Filter by action</label>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="w-full mt-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm"
        >
          <option value="">All actions</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm py-4">Loading audit log...</div>
      ) : entries.length === 0 ? (
        <div className="text-text-muted text-sm py-4">No audit log entries found.</div>
      ) : (
        <>
          <div className="space-y-1">
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
                <div key={entry.id} className="flex items-start gap-3 p-2 rounded hover:bg-white/5">
                  <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={32} userId={entry.user_id} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary">
                      <span className="font-medium">{user?.username ?? entry.user_id.slice(0, 8)}</span>
                      {' '}
                      <span className="text-text-secondary">{actionLabel}</span>
                      {targetDisplay && (
                        <>
                          {' '}
                          <span className="font-medium">{targetDisplay}</span>
                        </>
                      )}
                    </div>
                    {entry.reason && (
                      <div className="text-text-muted text-xs mt-0.5">Reason: {entry.reason}</div>
                    )}
                    <div className="text-text-muted text-xs mt-0.5">
                      {formatTimestamp(entry.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

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
        </>
      )}
    </div>
  );
}
