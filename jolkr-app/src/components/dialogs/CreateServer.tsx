import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';

interface Props {
  onClose: () => void;
}

export default function CreateServerDialog({ onClose }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { createServer } = useServersStore();
  const navigate = useNavigate();

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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="bg-surface rounded-lg p-6 w-[440px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-4">Create a Server</h3>
        {error && <div className="bg-error/10 text-error text-sm p-2 rounded mb-3">{error}</div>}

        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Server Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Awesome Server"
          className="w-full mt-1 mb-4 px-3 py-2 bg-input rounded text-text-primary text-sm"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />

        <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">Description (Optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's your server about?"
          className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm resize-none"
          rows={2}
        />

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
