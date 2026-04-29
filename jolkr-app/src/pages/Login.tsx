import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import * as api from '../api/client';
import { deriveE2EESeed } from '../crypto/e2ee';
import { initE2EE } from '../services/e2ee';
import { resetAuthTheme } from '../utils/resetAuthTheme';

export default function Login() {
  useEffect(resetAuthTheme, []);
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
        let deviceId = localStorage.getItem('jolkr_e2ee_device_id');
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem('jolkr_e2ee_device_id', deviceId);
        }
        await initE2EE(deviceId, seed).catch(console.warn);
      }

      // Handle pending deep-link invite
      const pendingInvite = sessionStorage.getItem('jolkr_pending_invite');
      if (pendingInvite) {
        sessionStorage.removeItem('jolkr_pending_invite');
        try {
          const invite = await api.useInvite(pendingInvite);
          await fetchServers();
          navigate(`/servers/${invite.server_id}`);
          return;
        } catch { /* invite expired or invalid, proceed normally */ }
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
        <h1 style={styles.title}>Welcome back!</h1>
        <p style={styles.subtitle}>We're so excited to see you again!</p>

        {error && <div style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={styles.label}>
            <span style={styles.labelText}>Email <span style={{ color: 'var(--text-shout, #f85149)' }}>*</span></span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              inputMode="email"
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>Password <span style={{ color: 'var(--text-shout, #f85149)' }}>*</span></span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={styles.input}
            />
            <Link to="/forgot-password" style={styles.link}>Forgot your password?</Link>
          </label>
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p style={styles.footer}>
          Need an account?{' '}
          <Link to="/register" style={styles.link}>Register</Link>
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
    color: 'var(--text-muted)',
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
    color: '#fff',
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
    color: 'var(--text-muted)',
    marginTop: '1rem',
  },
};
