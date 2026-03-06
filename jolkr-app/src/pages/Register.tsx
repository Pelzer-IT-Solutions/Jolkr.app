import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { deriveE2EESeed } from '../crypto/e2ee';
import { initE2EE } from '../services/e2ee';

export default function Register() {
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

      // Init E2EE with deterministic keys derived from password
      const seed = await deriveE2EESeed(password);
      let deviceId = localStorage.getItem('jolkr_e2ee_device_id');
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('jolkr_e2ee_device_id', deviceId);
      }
      initE2EE(deviceId, seed).catch(console.warn);

      navigate('/');
    } catch { /* error is in store */ }
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="bg-surface rounded-lg p-8 w-[420px] max-w-[90vw]">
        <h1 className="text-2xl font-bold text-text-primary text-center mb-2">Create an account</h1>
        <p className="text-text-secondary text-center mb-6 text-sm">Join Jolkr today</p>

        {error && <div className="bg-error/10 text-error text-sm p-3 rounded mb-4">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="register-email" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Email <span className="text-error">*</span>
            </label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            />
          </div>
          <div>
            <label htmlFor="register-username" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Username <span className="text-error">*</span>
            </label>
            <input
              id="register-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            />
          </div>
          <div>
            <label htmlFor="register-password" className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">
              Password <span className="text-error">*</span>
            </label>
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full mt-1 px-3 py-2 bg-input rounded text-text-primary text-sm"
            />
            <div className={`mt-1.5 flex items-center gap-2 transition-opacity duration-150 ${password.length > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <div className="flex-1 flex gap-1">
                  {[1, 2, 3, 4].map((i) => {
                    const strength = (password.length >= 6 ? 1 : 0) + (password.length >= 8 ? 1 : 0) + (/[A-Z]/.test(password) && /[a-z]/.test(password) ? 1 : 0) + (/\d/.test(password) || /[^a-zA-Z0-9]/.test(password) ? 1 : 0);
                    const color = strength >= i ? (strength <= 1 ? 'bg-error' : strength <= 2 ? 'bg-yellow-500' : strength <= 3 ? 'bg-primary' : 'bg-green-500') : 'bg-input';
                    return <div key={i} className={`h-1 flex-1 rounded-full ${color}`} />;
                  })}
                </div>
                <span className="text-[10px] text-text-muted">
                  {password.length < 6 ? 'Too short' : (() => { const s = (password.length >= 8 ? 1 : 0) + (/[A-Z]/.test(password) && /[a-z]/.test(password) ? 1 : 0) + (/\d/.test(password) || /[^a-zA-Z0-9]/.test(password) ? 1 : 0); return s <= 0 ? 'Weak' : s <= 1 ? 'Fair' : s <= 2 ? 'Good' : 'Strong'; })()}
                </span>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary hover:bg-primary-hover text-white rounded font-medium text-sm disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Continue'}
          </button>
        </form>

        <p className="text-sm text-text-muted mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline">Log In</Link>
        </p>
      </div>
    </div>
  );
}
