import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface CreateServerDialogProps {
  onClose: () => void;
}

export default function CreateServerDialog({ onClose }: CreateServerDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { createServer } = useServersStore();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }
    setLoading(true);
    try {
      const server = await createServer(name.trim(), description.trim() || undefined);
      onClose();
      navigate(`/servers/${server.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-2xl border border-divider shadow-popup p-8 w-[440px] max-w-[90vw] animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create a Server</h3>
        {error && <div className="bg-error/10 text-error text-sm p-2 rounded-lg mb-3">{error}</div>}

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Server Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Awesome Server"
          className="w-full mt-1 mb-4 px-3 py-2 bg-input rounded-lg text-text-primary text-sm"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />

        <label className="text-xs font-bold text-text-secondary uppercase tracking-wider">Description (Optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's your server about?"
          className="w-full mt-1 px-3 py-2 bg-input rounded-lg text-text-primary text-sm resize-none"
          rows={2}
        />

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="btn-primary px-5 py-2.5 text-sm rounded-lg disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
