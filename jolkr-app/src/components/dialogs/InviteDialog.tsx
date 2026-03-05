import { useEffect, useState } from 'react';
import type { Invite } from '../../api/types';
import * as api from '../../api/client';
import { useToast } from '../Toast';

interface Props {
  serverId: string;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 43200, label: '12 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '7 days' },
];

const MAX_USES_OPTIONS = [
  { value: 0, label: 'No limit' },
  { value: 1, label: '1 use' },
  { value: 5, label: '5 uses' },
  { value: 10, label: '10 uses' },
  { value: 25, label: '25 uses' },
  { value: 50, label: '50 uses' },
  { value: 100, label: '100 uses' },
];

export default function InviteDialog({ serverId, onClose }: Props) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [maxAgeSeconds, setMaxAgeSeconds] = useState(0);
  const [maxUses, setMaxUses] = useState(0);

  useEffect(() => {
    api.getInvites(serverId)
      .then((inv) => { setInvites(inv); setFetchError(false); })
      .catch((e) => { console.warn('Failed to fetch invites:', e); setFetchError(true); });
  }, [serverId]);

  const handleCreate = async () => {
    setLoading(true);
    setActionError('');
    try {
      const body: { max_uses?: number; max_age_seconds?: number } = {};
      if (maxUses > 0) body.max_uses = maxUses;
      if (maxAgeSeconds > 0) body.max_age_seconds = maxAgeSeconds;
      const invite = await api.createInvite(serverId, Object.keys(body).length > 0 ? body : undefined);
      setInvites((prev) => [invite, ...prev]);
    } catch (e) {
      setActionError((e as Error).message || 'Failed to create invite');
    }
    finally { setLoading(false); }
  };

  const toast = useToast((s) => s.show);

  const getInviteUrl = (code: string) => {
    const origin = window.location.origin;
    const base = window.location.pathname.startsWith('/app') ? '/app' : '';
    return `${origin}${base}/invite/${code}`;
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(getInviteUrl(code));
      setCopied(code);
      toast('Invite link copied!', 'success');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard API may fail when page is not focused
    }
  };

  const handleDelete = async (inviteId: string) => {
    setDeletingId(inviteId);
    try {
      await api.deleteInvite(serverId, inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (e) {
      console.warn('Failed to delete invite:', e);
      setActionError((e as Error).message || 'Failed to delete invite');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-surface rounded-lg p-6 w-[500px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-4">Server Invites</h3>

        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Expire After</label>
            <select
              value={maxAgeSeconds}
              onChange={(e) => setMaxAgeSeconds(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Max Uses</label>
            <select
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            >
              {MAX_USES_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {actionError && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{actionError}</div>}

        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded mb-4 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Invite'}
        </button>

        <div className="max-h-[300px] overflow-y-auto space-y-2">
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center gap-2 bg-input rounded px-3 py-2">
              <code className="flex-1 text-sm text-text-primary font-mono">{inv.code}</code>
              <div className="flex flex-col items-end shrink-0">
                <span className="text-[11px] text-text-muted">
                  {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ''} uses
                </span>
                {inv.expires_at && (
                  <span className="text-[10px] text-text-muted">
                    {new Date(inv.expires_at) > new Date() ? `Expires ${new Date(inv.expires_at).toLocaleDateString()}` : 'Expired'}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleCopy(inv.code)}
                className="text-xs text-primary hover:text-primary-hover"
              >
                {copied === inv.code ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={() => handleDelete(inv.id)}
                disabled={deletingId === inv.id}
                className="text-xs text-error hover:text-error/80 disabled:opacity-50"
              >
                {deletingId === inv.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          ))}
          {fetchError && invites.length === 0 && (
            <div className="text-center text-error text-sm py-4">Failed to load invites</div>
          )}
          {!fetchError && invites.length === 0 && (
            <div className="text-center text-text-muted text-sm py-4">No invites yet</div>
          )}
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
