import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as api from '../api/client';
import { deriveE2EESeed } from '../crypto/e2ee';
import { useT } from '../hooks/useT';
import { initE2EE } from '../services/e2ee';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import { useToast } from '../stores/toast';
import { resetAuthTheme } from '../utils/resetAuthTheme';
import { STORAGE_KEYS } from '../utils/storageKeys';

export function Login() {
  useEffect(resetAuthTheme, []);
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useAuthStore((s) => s.login);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const fetchServers = useServersStore((s) => s.fetchServers);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);

      // Init E2EE with deterministic keys derived from password + userId (PBKDF2)
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const seed = await deriveE2EESeed(password, userId);
        let deviceId = localStorage.getItem(STORAGE_KEYS.E2EE_DEVICE_ID);
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem(STORAGE_KEYS.E2EE_DEVICE_ID, deviceId);
        }
        await initE2EE(deviceId, seed).catch(console.warn);
      }

      // Handle pending deep-link invite
      const pendingInvite = sessionStorage.getItem(STORAGE_KEYS.PENDING_INVITE);
      if (pendingInvite) {
        sessionStorage.removeItem(STORAGE_KEYS.PENDING_INVITE);
        try {
          const invite = await api.useInvite(pendingInvite);
          await fetchServers();
          navigate(`/servers/${invite.server_id}`);
          return;
        } catch { /* invite expired or invalid, proceed normally */ }
      }

      // Handle pending deep-link friend add (jolkr://add/<userId> when not logged in)
      const pendingAdd = sessionStorage.getItem(STORAGE_KEYS.PENDING_ADD_FRIEND);
      if (pendingAdd) {
        sessionStorage.removeItem(STORAGE_KEYS.PENDING_ADD_FRIEND);
        // Best-effort — but surface failures as a toast so the user knows the
        // friend-add (already friends, blocked, expired user) didn't land.
        api.sendFriendRequest(pendingAdd).catch((e) => {
          const msg = e instanceof Error ? e.message : t('toast.friendRequestNotSent');
          useToast.getState().show(msg, 'error');
        });
      }

      navigate('/');
    } catch { /* error is in store */ }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Jolkr" style={{ width: 32, height: 32 }} />
        </div>
        <h1 style={styles.title}>{t('auth.login.title')}</h1>
        <p style={styles.subtitle}>{t('auth.login.subtitle')}</p>

        {error && <div role="alert" id="auth-error" style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('auth.shared.emailLabel')} <span style={{ color: 'var(--text-shout, #f85149)' }}>{t('common.required')}</span></span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              inputMode="email"
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>{t('auth.shared.passwordLabel')} <span style={{ color: 'var(--text-shout, #f85149)' }}>{t('common.required')}</span></span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={styles.input}
            />
            <Link to="/forgot-password" style={styles.link}>{t('auth.login.forgotPassword')}</Link>
          </label>
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? t('auth.login.submitting') : t('auth.login.submit')}
          </button>
        </form>

        <p style={styles.footer}>
          {t('auth.login.needAccount')}{' '}
          <Link to="/register" style={styles.link}>{t('auth.login.register')}</Link>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-default)',
  },
  card: {
    background: 'var(--surface-raised)',
    borderRadius: '1.25rem',
    padding: '2rem',
    width: '26rem',
    maxWidth: '90vw',
    border: '1px solid var(--border-muted)',
    boxShadow: 'var(--shadow-elevation-large)',
  },
  iconWrap: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '1.5rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--text-shout)',
    textAlign: 'center',
    marginBottom: '0.375rem',
  },
  subtitle: {
    color: 'var(--text-default)',
    textAlign: 'center',
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
  },
  error: {
    background: 'oklch(55% 0.2 25 / 0.1)',
    color: 'oklch(55% 0.2 25)',
    fontSize: '0.875rem',
    padding: '0.75rem',
    borderRadius: '0.5rem',
    border: '1px solid oklch(55% 0.2 25 / 0.2)',
    marginBottom: '1rem',
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  },
  labelText: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--text-strong)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.02em',
  },
  input: {
    background: 'var(--surface-field)',
    border: '1px solid var(--border-muted)',
    borderRadius: '0.5rem',
    padding: '0.625rem 0.75rem',
    fontSize: '0.875rem',
    color: 'var(--text-default)',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  button: {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
    border: 'none',
    borderRadius: '0.5rem',
    padding: '0.625rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    marginTop: '0.5rem',
  },
  link: {
    color: 'var(--accent)',
    fontSize: '0.75rem',
    textDecoration: 'none',
    marginTop: '0.25rem',
  },
  footer: {
    fontSize: '0.875rem',
    color: 'var(--text-default)',
    marginTop: '1rem',
  },
};
