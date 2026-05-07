import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import * as api from '../api/client';
import Button from '../components/ui/Button';
import { useT } from '../hooks/useT';
import s from './InviteAccept.module.css';
import { STORAGE_KEYS } from '../utils/storageKeys';

export default function InviteAccept() {
  const { t } = useT();
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
      sessionStorage.setItem(STORAGE_KEYS.PENDING_INVITE, code);
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
        setError((e as Error).message || t('inviteAccept.errorGeneric'));
        setJoining(false);
      });
  }, [code, user, loading, navigate, t]);

  if (loading || joining) {
    return (
      <div className={s.page}>
        <div className={s.message}>{t('inviteAccept.joining')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={s.errorPage}>
        <div className={s.errorMessage}>{error}</div>
        <Button onClick={() => navigate('/', { replace: true })}>
          {t('common.goHome')}
        </Button>
      </div>
    );
  }

  return null;
}
