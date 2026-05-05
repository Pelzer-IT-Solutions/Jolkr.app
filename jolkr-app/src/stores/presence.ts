import { create } from 'zustand';
import { wsClient } from '../api/ws';

interface PresenceState {
  statuses: Record<string, string>; // userId -> 'online' | 'idle' | 'dnd' | 'offline'
  setStatus: (userId: string, status: string) => void;
  setBulk: (statuses: Record<string, string>) => void;
  clearAll: () => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
  statuses: {},

  setStatus: (userId, status) => {
    if (get().statuses[userId] === status) return;
    set({ statuses: { ...get().statuses, [userId]: status } });
  },

  setBulk: (incoming) => {
    const current = get().statuses;
    let changed = false;
    for (const [uid, s] of Object.entries(incoming)) {
      if (current[uid] !== s) { changed = true; break; }
    }
    if (!changed) return;
    set({ statuses: { ...current, ...incoming } });
  },

  clearAll: () => {
    set({ statuses: {} });
  },
}));

// Wire up WebSocket events — only presence, typing is handled by useTypingStore
wsClient.on((event) => {
  if (event.op === 'PresenceUpdate' && event.d.user_id && event.d.status) {
    const status = event.d.status === 'invisible' ? 'offline' : event.d.status;
    usePresenceStore.getState().setStatus(event.d.user_id, status);
  }
});
