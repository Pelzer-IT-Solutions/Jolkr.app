import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useServersStore } from '../stores/servers';
import * as api from '../api/client';
import { deriveE2EESeed } from '../crypto/e2ee';
import { initE2EE } from '../services/e2ee';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

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

      // Init E2EE with deterministic keys derived from password + userId (PBKDF2)
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        const seed = await deriveE2EESeed(password, userId);
        let deviceId = localStorage.getItem('jolkr_e2ee_device_id');
        if (!deviceId) {
          deviceId = crypto.randomUUID();
          localStorage.setItem('jolkr_e2ee_device_id', deviceId);
        }
        initE2EE(deviceId, seed).catch(console.warn);
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
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-3xl p-8 w-105 max-w-[90vw] border border-divider shadow-popup animate-modal-scale">
        <div className="flex justify-center mb-6">
          <div className="size-14 rounded-2xl bg-accent-muted flex items-center justify-center">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="Jolkr" className="w-8 h-8" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-text-primary text-center mb-1.5">Welcome back!</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">We're so excited to see you again!</p>

        {error && <div role="alert" className="bg-danger/10 text-danger text-sm p-3 rounded-lg border border-danger/20 mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="login-email"
            label={<>Email <span className="text-danger">*</span></>}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            inputMode="email"
          />
          <div>
            <Input
              id="login-password"
              label={<>Password <span className="text-danger">*</span></>}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Link to="/forgot-password" className="text-accent hover:underline text-xs mt-1 inline-block">
              Forgot your password?
            </Link>
          </div>
          <Button type="submit" disabled={loading} fullWidth>
            {loading ? 'Logging in...' : 'Log In'}
          </Button>
        </form>

        <p className="text-sm text-text-tertiary mt-4">
          Need an account?{' '}
          <Link to="/register" className="text-accent hover:underline">Register</Link>
        </p>
      </div>
    </div>
  );
}
