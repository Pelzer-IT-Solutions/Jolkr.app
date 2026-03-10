import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import * as api from '../../api/client';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface JoinServerDialogProps {
  onClose: () => void;
}

export default function JoinServerDialog({ onClose }: JoinServerDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { fetchServers } = useServersStore();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const handleJoin = async () => {
    if (!code.trim()) {
      setError('Invite code is required');
      return;
    }
    setLoading(true);
    try {
      const invite = await api.useInvite(code.trim());
      await fetchServers();
      onClose();
      navigate(`/servers/${invite.server_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-8 w-[440px] max-w-[90vw] animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-4">Join a Server</h3>
        {error && <div className="bg-error/10 text-error text-sm p-2 rounded-lg mb-3">{error}</div>}

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Invite Code</label>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter an invite code"
          className="w-full mt-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        />

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={handleJoin}
            disabled={loading}
            className="btn-primary px-5 py-2.5 text-sm rounded-lg disabled:opacity-50"
          >
            {loading ? 'Joining...' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
