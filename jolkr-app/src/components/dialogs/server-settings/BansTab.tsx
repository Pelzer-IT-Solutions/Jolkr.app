import { useEffect, useState } from 'react';
import * as api from '../../../api/client';
import type { Server, Ban, User } from '../../../api/types';

export interface BansTabProps {
  server: Server;
}

export default function BansTab({ server }: BansTabProps) {
  const [bans, setBans] = useState<Ban[]>([]);
  const [banUsers, setBanUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.getBans(server.id).then((data) => {
      if (cancelled) return;
      setBans(data);
      // Deduplicate user IDs to fetch
      const userIds = new Set<string>();
      for (const ban of data) {
        userIds.add(ban.user_id);
        if (ban.banned_by) userIds.add(ban.banned_by);
      }
      userIds.forEach((id) => {
        api.getUser(id).then((u) => {
          if (!cancelled) setBanUsers((prev) => ({ ...prev, [u.id]: u }));
        }).catch(() => {});
      });
    }).catch((e) => {
      if (!cancelled) setError((e as Error).message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [server.id]);

  const handleUnban = async (userId: string) => {
    setUnbanning(userId);
    setError('');
    try {
      await api.unbanMember(server.id, userId);
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUnbanning(null);
    }
  };

  if (loading) {
    return <div className="text-text-muted text-sm py-4">Loading bans...</div>;
  }

  return (
    <div>
      {error && <div className="bg-error/10 text-error text-sm p-2 rounded-lg mb-3">{error}</div>}

      {bans.length === 0 ? (
        <div className="text-text-muted text-sm py-4">No banned users.</div>
      ) : (
        <div className="space-y-2">
          {bans.map((ban) => {
            const user = banUsers[ban.user_id];
            const bannedByUser = ban.banned_by ? banUsers[ban.banned_by] : null;
            return (
              <div key={ban.id} className="flex items-center gap-3 p-3 bg-input rounded-lg">
                <div className="w-8 h-8 rounded-full bg-error/20 flex items-center justify-center shrink-0">
                  <span className="text-error text-xs font-bold">
                    {(user?.username ?? '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">
                    {user?.username ?? ban.user_id.slice(0, 8)}
                  </div>
                  <div className="text-text-muted text-xs">
                    {ban.reason && <span className="text-text-secondary">{ban.reason} — </span>}
                    Banned by {bannedByUser?.username ?? 'unknown'} on{' '}
                    {new Date(ban.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleUnban(ban.user_id)}
                  disabled={unbanning === ban.user_id}
                  className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary bg-white/5 hover:bg-white/10 rounded shrink-0 disabled:opacity-50"
                >
                  {unbanning === ban.user_id ? '...' : 'Unban'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
