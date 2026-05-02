import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Navigate } from 'react-router-dom';
import * as api from '../api/client';
import { useAuthStore } from '../stores/auth';
import { resetAuthTheme } from '../utils/resetAuthTheme';

const s: Record<string, React.CSSProperties> = {
  page: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-default)' },
  card: { background: 'var(--surface-raised)', borderRadius: '1.25rem', padding: '2rem', width: '26rem', maxWidth: '90vw', border: '1px solid var(--border-muted)', boxShadow: 'var(--shadow-elevation-large)', textAlign: 'center' as const },
  title: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-shout)', textAlign: 'center' as const, marginBottom: '0.375rem' },
  subtitle: { color: 'var(--text-default)', textAlign: 'center' as const, marginBottom: '1.5rem', fontSize: '0.875rem' },
  button: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.625rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: '0.5rem' },
  success: { background: 'oklch(55% 0.15 145 / 0.1)', color: 'oklch(55% 0.15 145)', fontSize: '0.875rem', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid oklch(55% 0.15 145 / 0.2)', marginBottom: '1rem' },
  error: { background: 'oklch(55% 0.2 25 / 0.1)', color: 'oklch(55% 0.2 25)', fontSize: '0.875rem', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid oklch(55% 0.2 25 / 0.2)', marginBottom: '1rem' },
  link: { color: 'var(--accent)', fontSize: '0.875rem', textDecoration: 'none', cursor: 'pointer', background: 'none', border: 'none', padding: 0 },
};

export default function VerifyEmail() {
  useEffect(resetAuthTheme, []);
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // Already verified and no token to process → go to app
  if (user?.email_verified && !token) return <Navigate to="/" replace />;

  if (token) return <ConfirmVerification token={token} />;
  return <PendingVerification />;
}

function ConfirmVerification({ token }: { token: string }) {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const loadUser = useAuthStore((s) => s.loadUser);

  useEffect(() => {
    api.verifyEmail(token)
      .then(() => {
        setStatus('success');
        loadUser();
      })
      .catch((e) => {
        setStatus('error');
        setError((e as Error).message || 'Verification failed');
      });
  }, [token, loadUser]);

  return (
    <div style={s.page}>
      <div style={s.card}>
        {status === 'loading' && (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#8987;</div>
            <h1 style={s.title}>Verifying your email...</h1>
          </>
        )}
        {status === 'success' && (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#10003;</div>
            <h1 style={s.title}>Email Verified!</h1>
            <p style={s.subtitle}>Your email has been verified. You can now use Jolkr.</p>
            <button style={s.button} onClick={() => navigate('/')}>
              Go to Jolkr
            </button>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#10007;</div>
            <h1 style={s.title}>Verification Failed</h1>
            <div style={s.error}>{error}</div>
            <p style={s.subtitle}>The link may have expired. Try requesting a new one.</p>
            <button style={s.button} onClick={() => navigate('/verify-email')}>
              Request New Link
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PendingVerification() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleResend = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.resendVerification();
      setSent(true);
    } catch (e) {
      setError((e as Error).message || 'Failed to resend');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#9993;</div>
        <h1 style={s.title}>Verify your email</h1>
        <p style={s.subtitle}>
          We sent a verification link to{' '}
          <strong>{user?.email || 'your email'}</strong>.
          <br />
          Check your inbox and click the link to continue.
        </p>

        {error && <div style={s.error}>{error}</div>}
        {sent && <div style={s.success}>Verification email sent! Check your inbox.</div>}

        <button
          style={s.button}
          onClick={handleResend}
          disabled={loading || sent}
        >
          {loading ? 'Sending...' : sent ? 'Email Sent' : 'Resend Verification Email'}
        </button>

        <div style={{ marginTop: '1.5rem' }}>
          <button style={s.link} onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
