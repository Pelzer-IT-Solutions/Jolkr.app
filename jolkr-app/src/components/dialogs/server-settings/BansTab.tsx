import { useEffect, useState } from 'react';
import SearchInput from '../../ui/SearchInput';
import EmptyState from '../../ui/EmptyState';
import { ShieldCheck } from 'lucide-react';
import * as api from '../../../api/client';
import type { Server, Ban, User } from '../../../api/types';
import Avatar from '../../Avatar';

export interface BansTabProps {
  server: Server;
}

export default function BansTab({ server }: BansTabProps) {
  const [bans, setBans] = useState<Ban[]>([]);
  const [banUsers, setBanUsers] = useState<Record<string, User>>({});
  const [loading, setLoading] = useState(true);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

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

  const filteredBans = bans.filter((ban) => {
    if (!search.trim()) return true;
    const user = banUsers[ban.user_id];
    const name = user?.username ?? '';
    return name.toLowerCase().includes(search.toLowerCase()) || (ban.reason ?? '').toLowerCase().includes(search.toLowerCase());
  });

  if (loading) {
    return <div className="text-text-tertiary text-sm py-4">Loading bans...</div>;
  }

  return (
    <div>
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

      {/* Search */}
      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search bans..."
        className="mb-3"
      />

      {filteredBans.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="size-8" />} title={search ? 'No bans matching search.' : 'No banned users.'} />
      ) : (
        <div className="space-y-0">
          {filteredBans.map((ban) => {
            const user = banUsers[ban.user_id];
            const bannedByUser = ban.banned_by ? banUsers[ban.banned_by] : null;
            return (
              <div key={ban.id} className="px-1 py-3 flex items-center gap-3 border-b border-border-subtle">
                <Avatar url={user?.avatar_url} name={user?.username ?? '?'} size={32} userId={ban.user_id} />
                <div className="flex-1 min-w-0">
                  <div className="text-text-primary text-sm font-medium truncate">
                    {user?.username ?? ban.user_id.slice(0, 8)}
                  </div>
                  <div className="text-text-tertiary text-xs">
                    {ban.reason && <span className="text-text-secondary">{ban.reason} — </span>}
                    Banned by {bannedByUser?.username ?? 'unknown'} on{' '}
                    {new Date(ban.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleUnban(ban.user_id)}
                  disabled={unbanning === ban.user_id}
                  className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary bg-hover hover:bg-active rounded shrink-0 disabled:opacity-50"
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
