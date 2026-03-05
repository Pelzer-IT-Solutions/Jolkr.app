import { create } from 'zustand';
import { wsClient } from '../api/ws';
import { useAuthStore } from './auth';

interface UnreadState {
  /** channelId → unread count */
  counts: Record<string, number>;
  /** The channel the user is currently viewing */
  activeChannel: string | null;
  /** Increment unread for a channel */
  increment: (channelId: string) => void;
  /** Mark a channel as read (reset count to 0) */
  markRead: (channelId: string) => void;
  /** Set the active channel (marks it as read too) */
  setActiveChannel: (channelId: string | null) => void;
  /** Get total unread across specific channels */
  getTotalForChannels: (channelIds: string[]) => number;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  counts: {},
  activeChannel: null,

  increment: (channelId) => {
    // Don't increment if user is currently viewing this channel
    if (get().activeChannel === channelId) return;
    set((state) => ({
      counts: { ...state.counts, [channelId]: (state.counts[channelId] ?? 0) + 1 },
    }));
  },

  markRead: (channelId) => {
    const current = get().counts;
    if (!current[channelId]) return; // already 0 or undefined
    const next = { ...current };
    delete next[channelId];
    set({ counts: next });
  },

  setActiveChannel: (channelId) => {
    set({ activeChannel: channelId });
    if (channelId) {
      get().markRead(channelId);
    }
  },

  getTotalForChannels: (channelIds) => {
    const counts = get().counts;
    return channelIds.reduce((sum, id) => sum + (counts[id] ?? 0), 0);
  },
}));

// Wire up WebSocket — increment unread when new message arrives in non-active channel
wsClient.on((op, d) => {
  if (op === 'MessageCreate') {
    const raw = d.message as Record<string, unknown>;
    // Normalize: DM messages have dm_channel_id instead of channel_id
    const channelId = (raw?.channel_id ?? raw?.dm_channel_id) as string | undefined;
    if (!channelId) return;
    // Don't count own messages as unread
    const currentUserId = useAuthStore.getState().user?.id;
    if ((raw?.author_id as string) === currentUserId) return;
    useUnreadStore.getState().increment(channelId);
  }
});
