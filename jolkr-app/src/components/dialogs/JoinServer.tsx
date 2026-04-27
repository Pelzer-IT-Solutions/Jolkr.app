import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServersStore } from '../../stores/servers';
import { parseInviteInput } from '../../platform/config';
import * as api from '../../api/client';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

export interface JoinServerDialogProps {
  onClose: () => void;
}

export default function JoinServerDialog({ onClose }: JoinServerDialogProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { fetchServers } = useServersStore();
  const navigate = useNavigate();

  const handleJoin = async () => {
    const parsed = parseInviteInput(code);
    if (!parsed) {
      setError('Invite code is required');
      return;
    }
    setLoading(true);
    try {
      const invite = await api.useInvite(parsed);
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
    <Modal open onClose={onClose} className="p-8 w-110 max-w-[90vw]">
      <h3 className="text-text-primary text-lg font-semibold mb-4">Join a Server</h3>
      {error && <div className="bg-danger/10 text-danger text-sm p-2 rounded-lg mb-3">{error}</div>}

      <Input
        label="Invite Code or Link"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="ABC12345 or https://jolkr.app/app/invite/ABC12345"
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
      />

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        <Button onClick={handleJoin} disabled={loading}>
          {loading ? 'Joining...' : 'Join'}
        </Button>
      </div>
    </Modal>
  );
}
