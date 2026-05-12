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
 * Subset of `User` carried by `UserUpdate` WS events. Each field is both
 * optional (BE omits untouched fields via `skip_serializing_if`) AND nullable
 * (BE may explicitly null out fields like `status`).
 */
type Nullable<T> = { [K in keyof T]?: T[K] | null };
type UserPatch = Nullable<Pick<User,
  'status' | 'display_name' | 'avatar_url' | 'bio' | 'banner_color'
  | 'show_read_receipts' | 'dm_filter' | 'allow_friend_requests' | 'preferred_language'
>>;

interface AuthState {
  user: MeProfile | null;
  isLoading: boolean;
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
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await api.login(email, password);
      set({ user, isLoading: false });
      useUsersStore.getState().upsertUser(user);
      useLocaleStore.getState().applyMeProfile(user.preferred_language);
      wsClient.connect();
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message });
      throw e;
    }
  },

  register: async (email, username, password) => {
    set({ isLoading: true, error: null });
    try {
      const { user } = await api.register(email, username, password);
      set({ user, isLoading: false });
      useUsersStore.getState().upsertUser(user);
      useLocaleStore.getState().applyMeProfile(user.preferred_language);
      if (user.email_verified) {
        wsClient.connect();
      }
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message });
      throw e;
    }
  },

  loadUser: async () => {
    const token = api.getAccessToken();
    if (!token) return;
    set({ isLoading: true });
    try {
      const user = await api.getMe();
      set({ user, isLoading: false });
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
      set({ user: null, isLoading: false });
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
      // Spread only when present; boolean fields drop `null` (BE never sends
      // null for those) so the merged user keeps non-nullable booleans.
      return {
        user: {
          ...state.user,
          ...(data.status !== undefined && { status: data.status }),
          ...(data.display_name !== undefined && { display_name: data.display_name }),
          ...(data.avatar_url !== undefined && { avatar_url: data.avatar_url }),
          ...(data.bio !== undefined && { bio: data.bio }),
          ...(data.banner_color !== undefined && { banner_color: data.banner_color }),
          ...(data.show_read_receipts != null && { show_read_receipts: data.show_read_receipts }),
          ...(data.dm_filter !== undefined && { dm_filter: data.dm_filter }),
          ...(data.allow_friend_requests != null && { allow_friend_requests: data.allow_friend_requests }),
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
    set({ user: null, isLoading: false, error: null });
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
      // BE wires `dm_filter` as a plain string; the FE union narrows it.
      // Cast on this boundary — runtime values are validated upstream.
      useAuthStore.getState().applyUserUpdate(event.d as UserPatch);
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
