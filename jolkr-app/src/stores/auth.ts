import { create } from 'zustand';
import type { User } from '../api/types';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { resetE2EE } from '../services/e2ee';
import { stopNotifications } from '../services/notifications';
import { usePresenceStore } from './presence';
import { useServersStore } from './servers';
import { useMessagesStore } from './messages';
import { useUnreadStore } from './unread';
import { useVoiceStore } from './voice';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  loadUser: () => Promise<void>;
  updateProfile: (body: { username?: string; display_name?: string; bio?: string; avatar_url?: string; status?: string | null }) => Promise<void>;
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

  logout: async () => {
    // Leave voice channel before disconnecting
    try { await useVoiceStore.getState().leaveChannel(); } catch { /* ignore */ }
    wsClient.disconnect();
    stopNotifications();
    try { await api.clearTokens(); } catch (e) { console.warn('clearTokens failed:', e); }
    resetE2EE().catch(console.warn);
    // Reset all stores to prevent stale data on re-login
    usePresenceStore.getState().clearAll();
    useServersStore.setState({ servers: [], channels: {}, members: {}, categories: {}, roles: {}, permissions: {}, channelPermissions: {}, emojis: {}, loading: false });
    useMessagesStore.setState({ messages: {}, loading: {}, loadingOlder: {}, hasMore: {}, threadMessages: {}, threadLoading: {}, threadLoadingOlder: {}, threadHasMore: {}, threadListVersion: 0 });
    useUnreadStore.setState({ counts: {}, activeChannel: null, lastSeenMessageId: {} });
    localStorage.removeItem('jolkr_last_seen');
    set({ user: null, loading: false, error: null });
  },
}));
