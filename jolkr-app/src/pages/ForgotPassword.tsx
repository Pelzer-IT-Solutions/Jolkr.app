import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as api from '../api/client';

const s: Record<string, React.CSSProperties> = {
  page: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-default)' },
  card: { background: 'var(--surface-raised)', borderRadius: '1.25rem', padding: '2rem', width: '26rem', maxWidth: '90vw', border: '1px solid var(--border-muted)', boxShadow: 'var(--shadow-elevation-large)' },
  title: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-shout)', textAlign: 'center', marginBottom: '0.375rem' },
  subtitle: { color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.875rem' },
  error: { background: 'oklch(55% 0.2 25 / 0.1)', color: 'oklch(55% 0.2 25)', fontSize: '0.875rem', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid oklch(55% 0.2 25 / 0.2)', marginBottom: '1rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.375rem' },
  labelText: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-strong)', textTransform: 'uppercase' as const, letterSpacing: '0.02em' },
  input: { background: 'var(--surface-field)', border: '1px solid var(--border-muted)', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', fontSize: '0.875rem', color: 'var(--text-default)', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  button: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.625rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: '0.5rem' },
  link: { color: 'var(--accent)', fontSize: '0.875rem', textDecoration: 'none' },
  footer: { fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '1rem' },
};

export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  if (token) return <ResetPasswordForm token={token} />;
  return <RequestResetForm />;
}

function RequestResetForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.forgotPassword(email);
      setSubmitted(true);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#9993;</div>
          <h1 style={s.title}>Check your email</h1>
          <p style={s.subtitle}>
            If an account exists for <strong>{email}</strong>, we've sent a password reset link.
          </p>
          <Link to="/login" style={{ ...s.button, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Forgot your password?</h1>
        <p style={s.subtitle}>Enter your email and we'll send you a reset link.</p>
        {error && <div style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={s.label}>
            <span style={s.labelText}>Email <span style={{ color: 'oklch(55% 0.2 25)' }}>*</span></span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus inputMode="email" placeholder="you@example.com" style={s.input} />
          </label>
          <button type="submit" disabled={loading} style={s.button}>{loading ? 'Sending...' : 'Send Reset Link'}</button>
        </form>
        <p style={s.footer}>Remember your password? <Link to="/login" style={s.link}>Log In</Link></p>
      </div>
    </div>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.resetPasswordConfirm(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#10003;</div>
          <h1 style={s.title}>Password Reset Successful</h1>
          <p style={s.subtitle}>You can now log in with your new password.</p>
          <Link to="/login" style={{ ...s.button, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Go to Login</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Set New Password</h1>
        <p style={s.subtitle}>Enter your new password below.</p>
        {error && <div style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={s.label}>
            <span style={s.labelText}>New Password <span style={{ color: 'oklch(55% 0.2 25)' }}>*</span></span>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} autoFocus placeholder="Min. 8 characters" style={s.input} />
          </label>
          <label style={s.label}>
            <span style={s.labelText}>Confirm Password <span style={{ color: 'oklch(55% 0.2 25)' }}>*</span></span>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} placeholder="Repeat your new password" style={s.input} />
          </label>
          <button type="submit" disabled={loading} style={s.button}>{loading ? 'Resetting...' : 'Reset Password'}</button>
        </form>
        <p style={s.footer}><Link to="/login" style={s.link}>Back to Login</Link></p>
      </div>
    </div>
  );
}
