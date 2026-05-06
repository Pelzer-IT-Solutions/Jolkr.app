import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { deriveE2EESeed } from '../crypto/e2ee';
import { initE2EE } from '../services/e2ee';
import { resetAuthTheme } from '../utils/resetAuthTheme';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { MIN_PASSWORD_LENGTH } from '../utils/constants';

export default function Register() {
  useEffect(resetAuthTheme, []);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const register = useAuthStore((s) => s.register);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await register(email, username, password);

      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const seed = await deriveE2EESeed(password, userId);
        let deviceId = localStorage.getItem(STORAGE_KEYS.E2EE_DEVICE_ID);
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem(STORAGE_KEYS.E2EE_DEVICE_ID, deviceId);
        }
        initE2EE(deviceId, seed).catch(console.warn);
      }

      navigate('/verify-email');
    } catch { /* error is in store */ }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Jolkr" style={{ width: 32, height: 32 }} />
        </div>
        <h1 style={styles.title}>Create an account</h1>
        <p style={styles.subtitle}>Join Jolkr today</p>

        {error && <div role="alert" id="auth-error" style={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={styles.label}>
            <span style={styles.labelText}>Email <span style={{ color: 'oklch(55% 0.2 25)' }}>*</span></span>
            <input
              type="email"
              name="email"
              autoComplete="email"
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
            <span style={styles.labelText}>Username <span style={{ color: 'oklch(55% 0.2 25)' }}>*</span></span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            <span style={styles.labelText}>Password <span style={{ color: 'oklch(55% 0.2 25)' }}>*</span></span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={styles.input}
            />
          </label>
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Creating...' : 'Continue'}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>Log In</Link>
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
    fontSize: '0.875rem',
    textDecoration: 'none',
  },
  footer: {
    fontSize: '0.875rem',
    color: 'var(--text-default)',
    marginTop: '1rem',
  },
};
