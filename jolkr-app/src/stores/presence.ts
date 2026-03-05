import { create } from 'zustand';
import { wsClient } from '../api/ws';

interface PresenceState {
  statuses: Record<string, string>; // userId -> 'online' | 'idle' | 'dnd' | 'offline'
  typing: Record<string, string[]>; // channelId -> userId[]
  setStatus: (userId: string, status: string) => void;
  setBulk: (statuses: Record<string, string>) => void;
  addTyping: (channelId: string, userId: string) => void;
  removeTyping: (channelId: string, userId: string) => void;
  getTypingUsers: (channelId: string) => string[];
  clearAll: () => void;
}

const typingTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const usePresenceStore = create<PresenceState>((set, get) => ({
  statuses: {},
  typing: {},

  setStatus: (userId, status) => {
    set({ statuses: { ...get().statuses, [userId]: status } });
  },

  setBulk: (statuses) => {
    set({ statuses: { ...get().statuses, ...statuses } });
  },

  addTyping: (channelId, userId) => {
    const current = get().typing[channelId] ?? [];
    if (current.includes(userId)) return; // already typing, skip re-render
    set({ typing: { ...get().typing, [channelId]: [...current, userId] } });

    // auto-remove after 8s
    const key = `${channelId}:${userId}`;
    if (typingTimers[key]) clearTimeout(typingTimers[key]);
    typingTimers[key] = setTimeout(() => {
      get().removeTyping(channelId, userId);
      delete typingTimers[key];
    }, 8000);
  },

  removeTyping: (channelId, userId) => {
    const current = get().typing[channelId];
    if (!current || !current.includes(userId)) return;
    set({ typing: { ...get().typing, [channelId]: current.filter((id) => id !== userId) } });
  },

  getTypingUsers: (channelId) => {
    return get().typing[channelId] ?? [];
  },

  clearAll: () => {
    for (const key of Object.keys(typingTimers)) {
      clearTimeout(typingTimers[key]);
      delete typingTimers[key];
    }
    set({ statuses: {}, typing: {} });
  },
}));

// Wire up WebSocket events
wsClient.on((op, d) => {
  const store = usePresenceStore.getState();
  switch (op) {
    case 'PresenceUpdate':
      if (d.user_id && d.status) store.setStatus(d.user_id as string, d.status as string);
      break;
    case 'TypingStart':
      if (d.channel_id && d.user_id) store.addTyping(d.channel_id as string, d.user_id as string);
      break;
  }
});
