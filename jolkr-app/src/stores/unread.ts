import { create } from 'zustand';
import { wsClient } from '../api/ws';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { useAuthStore } from './auth';
import { useMessagesStore } from './messages';

function persistLastSeen(data: Record<string, string>) {
  try { localStorage.setItem(STORAGE_KEYS.LAST_SEEN, JSON.stringify(data)); }
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
  /** Mark all channels for a server as read */
  markServerRead: (channelIds: string[]) => void;
  reset: () => void;
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
  counts: {},
  activeChannel: null,
  lastSeenMessageId: (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_SEEN) ?? '{}');
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

  markServerRead: (channelIds) => {
    const counts = { ...get().counts };
    for (const id of channelIds) delete counts[id];
    set({ counts });
  },

  reset: () => {
    set({ counts: {}, activeChannel: null, lastSeenMessageId: {} });
    localStorage.removeItem(STORAGE_KEYS.LAST_SEEN);
  },
}));

// Wire up WebSocket — increment unread when new message arrives in non-active channel
wsClient.on((event) => {
  const currentUserId = useAuthStore.getState().user?.id;

  switch (event.op) {
    case 'MessageCreate': {
      const msg = event.d.message as { channel_id?: string; dm_channel_id?: string; author_id?: string };
      // Normalize: DM messages have dm_channel_id instead of channel_id
      const channelId = msg.channel_id ?? msg.dm_channel_id;
      if (!channelId) return;
      // Don't count own messages as unread
      if (msg.author_id === currentUserId) return;
      useUnreadStore.getState().increment(channelId);
      break;
    }
    // Sync read state across sessions: when current user reads on another device
    case 'DmMessagesRead': {
      if (event.d.user_id === currentUserId) {
        useUnreadStore.getState().markRead(event.d.dm_id);
      }
      break;
    }
    case 'ChannelMessagesRead': {
      if (event.d.user_id === currentUserId) {
        useUnreadStore.getState().markRead(event.d.channel_id);
      }
      break;
    }
    case 'ServerMessagesRead': {
      if (event.d.user_id === currentUserId) {
        // Clear all counts — this event is only sent to the user who triggered it
        useUnreadStore.setState({ counts: {} });
      }
      break;
    }
  }
});
