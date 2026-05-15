/**
 * Centralised user cache keyed by `user_id`. Multiple surfaces fetch user
 * data — server members, DM partners, friendships, the auth-store self —
 * and we don't want each consumer to re-hit the network or re-derive a
 * lookup table. This store is a thin index that any feature (chat,
 * typing-indicator, profile-card) can read synchronously.
 *
 * Producers: keep entries fresh by calling `upsertUser`/`upsertUsers` after
 * any fetch that yields a `User` shape. Consumers: read via `getUser` for
 * one-shot reads, or subscribe to the store for reactive UI.
 */

import { create } from 'zustand';
import type { User, MeProfile } from '../api/types';

interface UsersState {
  byId: Record<string, User>;
  upsertUser: (user: User | MeProfile | null | undefined) => void;
  upsertUsers: (users: ReadonlyArray<User | MeProfile | null | undefined>) => void;
  getUser: (id: string) => User | undefined;
  reset: () => void;
}

export const useUsersStore = create<UsersState>((set, get) => ({
  byId: {},

  upsertUser: (user) => {
    if (!user?.id) return;
    set((state) => {
      const existing = state.byId[user.id];
      // Skip the write if nothing meaningful changed — keeps zustand
      // subscribers from re-rendering on identical updates.
      if (existing
        && existing.username === user.username
        && existing.display_name === user.display_name
        && existing.avatar_url === user.avatar_url
      ) {
        return state;
      }
      return { byId: { ...state.byId, [user.id]: user } };
    });
  },

  upsertUsers: (users) => {
    if (!users.length) return;
    set((state) => {
      let changed = false;
      const next = { ...state.byId };
      for (const u of users) {
        if (!u?.id) continue;
        const existing = next[u.id];
        if (existing
          && existing.username === u.username
          && existing.display_name === u.display_name
          && existing.avatar_url === u.avatar_url
        ) continue;
        next[u.id] = u;
        changed = true;
      }
      return changed ? { byId: next } : state;
    });
  },

  getUser: (id) => get().byId[id],

  reset: () => set({ byId: {} }),
}));

