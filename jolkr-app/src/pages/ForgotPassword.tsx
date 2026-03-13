import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import * as api from '../api/client';

export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  // If there's a token in the URL, show the "set new password" form
  if (token) {
    return <ResetPasswordForm token={token} />;
  }

  // Otherwise show the "enter your email" form
  return <RequestResetForm />;
}

/** Step 1: User enters their email to request a reset link */
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
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="bg-surface rounded-3xl p-8 w-105 max-w-[90vw] text-center border border-divider shadow-popup animate-modal-scale">
          <div className="text-4xl mb-4">&#9993;</div>
          <h1 className="text-3xl font-bold text-text-primary mb-2">Check your email</h1>
          <p className="text-text-secondary text-sm mb-6">
            If an account exists for <strong>{email}</strong>, we've sent a password reset link.
            Check your inbox (and spam folder).
          </p>
          <Link
            to="/login"
            className="inline-block w-full py-3 btn-primary text-sm rounded-lg text-center"
          >
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-3xl p-8 w-105 max-w-[90vw] border border-divider shadow-popup animate-modal-scale">
        <h1 className="text-3xl font-bold text-text-primary text-center mb-2">Forgot your password?</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">
          Enter your email address and we'll send you a link to reset your password.
        </p>

        {error && <div role="alert" className="bg-danger/10 text-danger text-sm p-3 rounded-lg border border-danger/20 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
              Email <span className="text-danger">*</span>
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="you@example.com"
              inputMode="email"
              className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 btn-primary text-sm rounded-lg"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>

        <p className="text-sm text-text-tertiary mt-4">
          Remember your password?{' '}
          <Link to="/login" className="text-accent hover:underline">Log In</Link>
        </p>
      </div>
    </div>
  );
}

/** Step 2: User clicks the reset link and sets a new password */
function ResetPasswordForm({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
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
      <div className="h-full flex items-center justify-center bg-bg">
        <div className="bg-surface rounded-3xl p-8 w-105 max-w-[90vw] text-center border border-divider shadow-popup animate-modal-scale">
          <div className="text-4xl mb-4">&#10003;</div>
          <h1 className="text-3xl font-bold text-text-primary mb-2">Password Reset Successful</h1>
          <p className="text-text-secondary text-sm mb-6">
            Your password has been updated. You can now log in with your new password.
          </p>
          <Link
            to="/login"
            className="inline-block w-full py-3 btn-primary text-sm rounded-lg text-center"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-3xl p-8 w-105 max-w-[90vw] border border-divider shadow-popup animate-modal-scale">
        <h1 className="text-3xl font-bold text-text-primary text-center mb-2">Set New Password</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">
          Enter your new password below.
        </p>

        {error && <div role="alert" className="bg-danger/10 text-danger text-sm p-3 rounded-lg border border-danger/20 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-password" className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
              New Password <span className="text-danger">*</span>
            </label>
            <input
              id="reset-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
              placeholder="Min. 8 characters"
              className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
            />
          </div>
          <div>
            <label htmlFor="reset-confirm" className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
              Confirm Password <span className="text-danger">*</span>
            </label>
            <input
              id="reset-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              placeholder="Repeat your new password"
              className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 btn-primary text-sm rounded-lg"
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>

        <p className="text-sm text-text-tertiary mt-4">
          <Link to="/login" className="text-accent hover:underline">Back to Login</Link>
        </p>
      </div>
    </div>
  );
}
