import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import * as api from '../api/client';

export default function InviteAccept() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (loading || !code) return;

    if (!user) {
      // Save invite code and redirect to login
      sessionStorage.setItem('jolkr_pending_invite', code);
      navigate('/login', { replace: true });
      return;
    }

    // User is logged in — accept invite
    setJoining(true);
    api.useInvite(code)
      .then(async (invite) => {
        await useServersStore.getState().fetchServers();
        navigate(`/servers/${invite.server_id}`, { replace: true });
      })
      .catch((e) => {
        setError((e as Error).message || 'Invalid or expired invite');
        setJoining(false);
      });
  }, [code, user, loading, navigate]);

  if (loading || joining) {
    return (
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="text-text-tertiary">Joining server...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-bg gap-4">
        <div className="text-danger text-lg">{error}</div>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="px-4 py-2 btn-primary rounded-lg text-sm"
        >
          Go Home
        </button>
      </div>
    );
  }

  return null;
}
