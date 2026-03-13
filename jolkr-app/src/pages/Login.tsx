import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import * as api from '../api/client';
import { deriveE2EESeed } from '../crypto/e2ee';
import { initE2EE } from '../services/e2ee';

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

      // Init E2EE with deterministic keys derived from password
      const seed = await deriveE2EESeed(password);
      let deviceId = localStorage.getItem('jolkr_e2ee_device_id');
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('jolkr_e2ee_device_id', deviceId);
      }
      initE2EE(deviceId, seed).catch(console.warn);

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
      <div className="bg-surface rounded-3xl p-8 w-105 max-w-[90vw] border border-divider shadow-popup animate-modal-scale">
        <div className="flex justify-center mb-6">
          <div className="size-14 rounded-2xl bg-accent-muted flex items-center justify-center">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Jolkr" className="w-8 h-8" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-text-primary text-center mb-1.5">Welcome back!</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">We're so excited to see you again!</p>

        {error && <div role="alert" className="bg-error/10 text-error text-sm p-3 rounded-lg border border-error/20 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Email <span className="text-error">*</span>
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              inputMode="email"
              className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Password <span className="text-error">*</span>
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full mt-1 px-4 py-3 bg-bg border border-divider rounded-lg text-text-primary text-sm"
            />
            <Link to="/forgot-password" className="text-primary hover:underline text-xs mt-1 inline-block">
              Forgot your password?
            </Link>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 btn-primary text-sm rounded-lg"
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
