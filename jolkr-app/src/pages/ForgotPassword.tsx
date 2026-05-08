import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as api from '../api/client';
import { resetAuthTheme } from '../utils/resetAuthTheme';
import { MIN_PASSWORD_LENGTH } from '../utils/constants';
import { useT } from '../hooks/useT';

const s: Record<string, React.CSSProperties> = {
  page: { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-default)' },
  card: { background: 'var(--surface-raised)', borderRadius: '1.25rem', padding: '2rem', width: '26rem', maxWidth: '90vw', border: '1px solid var(--border-muted)', boxShadow: 'var(--shadow-elevation-large)' },
  title: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-shout)', textAlign: 'center', marginBottom: '0.375rem' },
  subtitle: { color: 'var(--text-default)', textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.875rem' },
  error: { background: 'oklch(55% 0.2 25 / 0.1)', color: 'oklch(55% 0.2 25)', fontSize: '0.875rem', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid oklch(55% 0.2 25 / 0.2)', marginBottom: '1rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.375rem' },
  labelText: { fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-strong)', textTransform: 'uppercase' as const, letterSpacing: '0.02em' },
  input: { background: 'var(--surface-field)', border: '1px solid var(--border-muted)', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', fontSize: '0.875rem', color: 'var(--text-default)', outline: 'none', width: '100%', boxSizing: 'border-box' as const },
  button: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.625rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', width: '100%', marginTop: '0.5rem' },
  link: { color: 'var(--accent)', fontSize: '0.875rem', textDecoration: 'none' },
  footer: { fontSize: '0.875rem', color: 'var(--text-default)', marginTop: '1rem' },
  hint: { fontSize: '0.75rem', color: 'var(--success-default, var(--text-faint))', marginTop: '0.25rem' },
  hintError: { fontSize: '0.75rem', color: 'var(--text-faint)', marginTop: '0.25rem' },
};

export default function ForgotPassword() {
  useEffect(resetAuthTheme, []);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  if (token) return <ResetPasswordForm token={token} />;
  return <RequestResetForm />;
}

function RequestResetForm() {
  const { t, tx } = useT();
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
      setError((err as Error).message || t('auth.forgot.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#9993;</div>
          <h1 style={s.title}>{t('auth.forgot.checkEmailTitle')}</h1>
          <p style={s.subtitle}>
            {tx('auth.forgot.checkEmailBody', { email: <strong>{email}</strong> })}
          </p>
          <Link to="/login" style={{ ...s.button, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {t('auth.forgot.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>{t('auth.forgot.title')}</h1>
        <p style={s.subtitle}>{t('auth.forgot.subtitle')}</p>
        {error && <div role="alert" id="auth-error" style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={s.label}>
            <span style={s.labelText}>{t('auth.shared.emailLabel')} <span style={{ color: 'oklch(55% 0.2 25)' }}>{t('common.required')}</span></span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              inputMode="email"
              placeholder={t('auth.forgot.emailPlaceholder')}
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={s.input}
            />
          </label>
          <button type="submit" disabled={loading} style={s.button}>{loading ? t('auth.forgot.submitting') : t('auth.forgot.submit')}</button>
        </form>
        <p style={s.footer}>{t('auth.forgot.rememberPassword')} <Link to="/login" style={s.link}>{t('auth.forgot.login')}</Link></p>
      </div>
    </div>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useT();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const passwordOk = newPassword.length >= MIN_PASSWORD_LENGTH;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError(t('auth.reset.passwordsMismatch')); return; }
    if (!passwordOk) { setError(t('auth.reset.passwordTooShort', { min: MIN_PASSWORD_LENGTH })); return; }
    setLoading(true);
    setError(null);
    try {
      await api.resetPasswordConfirm(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message || t('auth.reset.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#10003;</div>
          <h1 style={s.title}>{t('auth.reset.successTitle')}</h1>
          <p style={s.subtitle}>{t('auth.reset.successBody')}</p>
          <Link to="/login" style={{ ...s.button, display: 'block', textAlign: 'center', textDecoration: 'none' }}>{t('auth.reset.goToLogin')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>{t('auth.reset.title')}</h1>
        <p style={s.subtitle}>{t('auth.reset.subtitle')}</p>
        {error && <div role="alert" id="auth-error" style={s.error}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <label style={s.label}>
            <span style={s.labelText}>{t('auth.reset.newPasswordLabel')} <span style={{ color: 'oklch(55% 0.2 25)' }}>{t('common.required')}</span></span>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoFocus
              placeholder={t('auth.reset.newPasswordPlaceholder', { min: MIN_PASSWORD_LENGTH })}
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={s.input}
            />
            {newPassword.length > 0 && (
              <span style={passwordOk ? s.hint : s.hintError}>
                {passwordOk ? '✓ ' : ''}{t('auth.reset.newPasswordHint', { min: MIN_PASSWORD_LENGTH })}
              </span>
            )}
          </label>
          <label style={s.label}>
            <span style={s.labelText}>{t('auth.reset.confirmPasswordLabel')} <span style={{ color: 'oklch(55% 0.2 25)' }}>{t('common.required')}</span></span>
            <input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              placeholder={t('auth.reset.confirmPasswordPlaceholder')}
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-error' : undefined}
              style={s.input}
            />
          </label>
          <button type="submit" disabled={loading} style={s.button}>{loading ? t('auth.reset.submitting') : t('auth.reset.submit')}</button>
        </form>
        <p style={s.footer}><Link to="/login" style={s.link}>{t('auth.forgot.backToLogin')}</Link></p>
      </div>
    </div>
  );
}
