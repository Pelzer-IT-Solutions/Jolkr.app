import { create } from 'zustand';
import type { User } from '../api/types';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { resetE2EE } from '../services/e2ee';
import { stopNotifications } from '../services/notifications';
import { useVoiceStore } from './voice';
import { resetAllStores } from './reset';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  loadUser: () => Promise<void>;
  updateProfile: (body: { username?: string; display_name?: string; bio?: string; avatar_url?: string; status?: string | null; show_read_receipts?: boolean }) => Promise<void>;
  _applyUserUpdate: (data: Record<string, unknown>) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      await api.login(email, password);
      const user = await api.getMe();
      set({ user, loading: false });
      wsClient.connect();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  register: async (email, username, password) => {
    set({ loading: true, error: null });
    try {
      await api.register(email, username, password);
      const user = await api.getMe();
      set({ user, loading: false });
      wsClient.connect();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  loadUser: async () => {
    const token = api.getAccessToken();
    if (!token) return;
    set({ loading: true });
    try {
      const user = await api.getMe();
      set({ user, loading: false });
      wsClient.connect();
    } catch (e) {
      // Only clear tokens on auth errors (401/403), not transient network errors
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) {
        await api.clearTokens();
      }
      set({ user: null, loading: false });
    }
  },

  updateProfile: async (body) => {
    const user = await api.updateMe(body);
    set({ user });
  },

  _applyUserUpdate: (data: Record<string, unknown>) => {
    set((state) => {
      if (!state.user) return state;
      return {
        user: {
          ...state.user,
          ...(data.status !== undefined && { status: data.status as string | undefined }),
          ...(data.display_name !== undefined && { display_name: data.display_name as string | undefined }),
          ...(data.avatar_url !== undefined && { avatar_url: data.avatar_url as string | undefined }),
          ...(data.bio !== undefined && { bio: data.bio as string | undefined }),
        },
      };
    });
  },

  logout: async () => {
    // Leave voice channel before disconnecting
    try { await useVoiceStore.getState().leaveChannel(); } catch { /* ignore */ }
    wsClient.disconnect();
    stopNotifications();
    try { await api.clearTokens(); } catch (e) { console.warn('clearTokens failed:', e); }
    resetE2EE().catch(console.warn);
    // Reset all stores to prevent stale data on re-login
    resetAllStores();
    set({ user: null, loading: false, error: null });
  },
}));

// Sync profile updates from other sessions
wsClient.on((op, d) => {
  if (op === 'UserUpdate') {
    useAuthStore.getState()._applyUserUpdate(d as Record<string, unknown>);
  }
});
