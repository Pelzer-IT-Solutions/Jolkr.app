import { create } from 'zustand';
import { wsClient } from '../api/ws';
import { useAuthStore } from './auth';
import { useMessagesStore } from './messages';

function persistLastSeen(data: Record<string, string>) {
  try { localStorage.setItem('jolkr_last_seen', JSON.stringify(data)); }
  catch { /* quota exceeded */ }
}

interface UnreadState {
  /** channelId → unread count */
  counts: Record<string, number>;
  /** The channel the user is currently viewing */
  activeChannel: string | null;
  /** channelId → last seen message ID (for unread separator) */
  lastSeenMessageId: Record<string, string>;
  /** Increment unread for a channel */
  increment: (channelId: string) => void;
  /** Mark a channel as read (reset count to 0) */
  markRead: (channelId: string) => void;
  /** Set the active channel (marks it as read too) */
  setActiveChannel: (channelId: string | null) => void;
  /** Get total unread across specific channels */
  getTotalForChannels: (channelIds: string[]) => number;
  reset: () => void;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  counts: {},
  activeChannel: null,
  lastSeenMessageId: (() => {
    try {
      return JSON.parse(localStorage.getItem('jolkr_last_seen') ?? '{}');
    } catch { return {}; }
  })(),

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
    const prev = get().activeChannel;
    // Save last seen message ID when leaving a channel
    if (prev) {
      const msgs = useMessagesStore.getState().messages[prev];
      if (msgs?.length) {
        const updated = { ...get().lastSeenMessageId, [prev]: msgs[msgs.length - 1].id };
        set({ lastSeenMessageId: updated });
        persistLastSeen(updated);
      }
    }
    set({ activeChannel: channelId });
    if (channelId) {
      get().markRead(channelId);
    }
  },

  getTotalForChannels: (channelIds) => {
    const counts = get().counts;
    return channelIds.reduce((sum, id) => sum + (counts[id] ?? 0), 0);
  },

  reset: () => {
    set({ counts: {}, activeChannel: null, lastSeenMessageId: {} });
    localStorage.removeItem('jolkr_last_seen');
  },
}));

/** Selector: total unread count across a set of channel IDs */
export const selectTotalUnread = (channelIds: string[]) =>
  (s: { counts: Record<string, number> }) =>
    channelIds.reduce((sum, id) => sum + (s.counts[id] ?? 0), 0);

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
