import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

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
    <Modal open onClose={onClose} className="p-8 w-110 max-w-[90vw]">
      <h3 className="text-text-primary text-lg font-semibold mb-4">Create a Server</h3>
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

      <div className="mb-4">
        <Input
          label="Server Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Awesome Server"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
      </div>

      <label className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Description (Optional)</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What's your server about?"
        className="w-full mt-1.5 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm resize-none"
        rows={2}
      />

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        <Button onClick={handleCreate} disabled={loading}>
          {loading ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
}
