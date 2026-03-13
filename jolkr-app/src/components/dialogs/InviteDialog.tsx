import { useEffect, useRef, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { Invite } from '../../api/types';
import * as api from '../../api/client';
import { useToast } from '../Toast';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface InviteDialogProps {
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

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''}`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  return '< 1 hour';
}

export default function InviteDialog({ serverId, onClose }: InviteDialogProps) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [maxAgeSeconds, setMaxAgeSeconds] = useState(0);
  const [maxUses, setMaxUses] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    api.getInvites(serverId)
      .then((inv) => { setInvites(inv); setFetchError(false); })
      .catch((e) => { console.warn('Failed to fetch invites:', e); setFetchError(true); });
  }, [serverId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    } finally {
      setLoading(false);
    }
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="bg-sidebar rounded-3xl border border-divider shadow-popup w-140 h-130 max-w-[90vw] max-h-[85vh] flex flex-col animate-modal-scale"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <h3 className="text-lg font-bold text-text-primary">Server Invites</h3>
          <button onClick={onClose} aria-label="Close" className="size-5 text-text-muted hover:text-text-primary">
            <X className="size-5" />
          </button>
        </div>

        {/* Create section */}
        <div className="px-6 pb-4 flex flex-col gap-3 border-b border-divider shrink-0">
          {actionError && <div className="bg-error/10 text-error text-sm p-2 rounded-lg">{actionError}</div>}

          <div className="flex gap-2.5">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Expire After</label>
              <select
                value={maxAgeSeconds}
                onChange={(e) => setMaxAgeSeconds(Number(e.target.value))}
                className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary"
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="w-35 shrink-0 flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Max Uses</label>
              <select
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
                className="w-full rounded-lg bg-bg border border-divider px-4 py-3 text-sm text-text-primary"
              >
                {MAX_USES_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? 'Creating...' : 'Create Invite'}
          </button>
        </div>

        {/* Invite list */}
        <div className="flex-1 overflow-y-auto px-6 py-3 flex flex-col min-h-0">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider shrink-0">
            Invites — {invites.length}
          </div>

          {fetchError && invites.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-error text-sm">Failed to load invites</div>
          ) : invites.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No invites yet</div>
          ) : (
            <div className="flex-1 min-h-0">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-2.5 py-3 border-b border-divider">
                  <button
                    onClick={() => handleCopy(inv.code)}
                    className="text-sm font-medium text-primary hover:text-primary-hover truncate text-left"
                    title="Click to copy"
                  >
                    {copied === inv.code ? 'Copied!' : getInviteUrl(inv.code)}
                  </button>
                  <div className="flex items-center gap-4 justify-end flex-1 shrink-0">
                    <span className="text-sm text-text-muted whitespace-nowrap">
                      {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ''} uses
                    </span>
                    {inv.expires_at && (
                      <span className="text-sm text-text-muted whitespace-nowrap">
                        {formatExpiry(inv.expires_at)}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(inv.id)}
                      disabled={deletingId === inv.id}
                      className="text-error hover:text-error/80 disabled:opacity-50 shrink-0"
                      aria-label="Delete invite"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Close row */}
        <div className="flex justify-end px-6 py-3 shrink-0">
          <button onClick={onClose} className="text-sm font-medium text-text-muted hover:text-text-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
