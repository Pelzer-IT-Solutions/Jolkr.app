import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import * as api from '../api/client';

export default function Login() {
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
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-lg p-8 w-[420px] max-w-[90vw]">
        <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Welcome back!</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">We're so excited to see you again!</p>

        {error && <div className="bg-error/10 text-error text-sm p-3 rounded mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Email <span className="text-error">*</span>
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Password <span className="text-error">*</span>
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            />
            <Link to="/forgot-password" className="text-primary hover:underline text-xs mt-1 inline-block">
              Forgot your password?
            </Link>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary hover:bg-primary-hover text-white rounded font-medium text-sm disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="text-sm text-text-muted mt-4">
          Need an account?{' '}
          <Link to="/register" className="text-primary hover:underline">Register</Link>
        </p>
      </div>
    </div>
  );
}
