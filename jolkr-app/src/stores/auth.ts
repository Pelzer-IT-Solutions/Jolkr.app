import { create } from 'zustand';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { resetE2EE } from '../services/e2ee';
import { useLocaleStore } from './locale';
import { resetAllStores } from './reset';
import { useUsersStore } from './users';
import { useVoiceStore } from './voice';
import type { MeProfile, User, UpdateMeBody } from '../api/types';

/**
 * Subset of `User` carried by `UserUpdate` WS events. Each field is optional;
 * the backend omits fields it didn't touch via `skip_serializing_if`.
 */
type UserPatch = Partial<Pick<User,
  'status' | 'display_name' | 'avatar_url' | 'bio' | 'banner_color'
  | 'show_read_receipts' | 'dm_filter' | 'allow_friend_requests' | 'preferred_language'
>>;

interface AuthState {
  user: MeProfile | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  loadUser: () => Promise<void>;
  updateProfile: (body: UpdateMeBody) => Promise<void>;
  applyUserUpdate: (data: UserPatch) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  error: null,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { user } = await api.login(email, password);
      set({ user, loading: false });
      useUsersStore.getState().upsertUser(user);
      useLocaleStore.getState().applyMeProfile(user.preferred_language);
      wsClient.connect();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
      throw e;
    }
  },

  register: async (email, username, password) => {
    set({ loading: true, error: null });
    try {
      const { user } = await api.register(email, username, password);
      set({ user, loading: false });
      useUsersStore.getState().upsertUser(user);
      useLocaleStore.getState().applyMeProfile(user.preferred_language);
      if (user.email_verified) {
        wsClient.connect();
      }
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
      useUsersStore.getState().upsertUser(user);
      useLocaleStore.getState().applyMeProfile(user.preferred_language);
      if (user.email_verified) {
        wsClient.connect();
      }
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
    useUsersStore.getState().upsertUser(user);
    useLocaleStore.getState().applyMeProfile(user.preferred_language);
  },

  applyUserUpdate: (data) => {
    set((state) => {
      if (!state.user) return state;
      // Each field is spread only when present so we don't overwrite existing
      // values with `undefined` for fields the server omitted from this patch.
      return {
        user: {
          ...state.user,
          ...(data.status !== undefined && { status: data.status }),
          ...(data.display_name !== undefined && { display_name: data.display_name }),
          ...(data.avatar_url !== undefined && { avatar_url: data.avatar_url }),
          ...(data.bio !== undefined && { bio: data.bio }),
          ...(data.banner_color !== undefined && { banner_color: data.banner_color }),
          ...(data.show_read_receipts !== undefined && { show_read_receipts: data.show_read_receipts }),
          ...(data.dm_filter !== undefined && { dm_filter: data.dm_filter }),
          ...(data.allow_friend_requests !== undefined && { allow_friend_requests: data.allow_friend_requests }),
          ...(data.preferred_language !== undefined && { preferred_language: data.preferred_language }),
        },
      };
    });
  },

  logout: async () => {
    // Leave voice channel before disconnecting
    try { await useVoiceStore.getState().leaveChannel(); } catch { /* ignore */ }
    wsClient.disconnect();
    try { await api.clearTokens(); } catch (e) { console.warn('clearTokens failed:', e); }
    resetE2EE().catch(console.warn);
    // Reset all stores to prevent stale data on re-login
    resetAllStores();
    set({ user: null, loading: false, error: null });
  },
}));

// Sync profile updates from other sessions
wsClient.on((event) => {
  if (event.op === 'UserUpdate') {
    // Only apply when the update is for the currently logged-in user — the
    // event is also fanned out to mutual server/DM members for THEIR caches,
    // and we must NOT overwrite the local user with a different user's data.
    const me = useAuthStore.getState().user;
    if (me && event.d.user_id === me.id) {
      useAuthStore.getState().applyUserUpdate(event.d);
      // Mirror the cross-device locale sync — when another session of the
      // same user changes language, this one flips too. Self-only field
      // (peer events strip it), so this never fires for other users.
      if (event.d.preferred_language !== undefined) {
        useLocaleStore.getState().applyMeProfile(event.d.preferred_language);
      }
    }
  } else if (event.op === 'EmailVerified') {
    // Backend confirmed verification — refresh the user object so
    // /verify-email's email_verified guard navigates to the app.
    useAuthStore.getState().loadUser().catch((e) => {
      console.warn('loadUser after EmailVerified failed:', e);
    });
  }
});
