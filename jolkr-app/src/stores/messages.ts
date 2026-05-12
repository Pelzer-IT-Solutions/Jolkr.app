import { create } from 'zustand';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { useAuthStore } from './auth';
import { useThreadsStore } from './threads';
import type { Message, Reaction } from '../api/types';

/** Transform backend reaction format (user_ids) to frontend format (me boolean + user_ids) */
function transformReactions(msgs: Message[]): Message[] {
  const currentUserId = useAuthStore.getState().user?.id;
  return msgs.map((m) => {
    if (!m.reactions?.length) return m;
    return {
      ...m,
      reactions: m.reactions.map((r) => ({
        emoji: r.emoji,
        count: r.count,
        me: currentUserId ? (r.user_ids?.includes(currentUserId) ?? false) : false,
        user_ids: r.user_ids ?? [],
      })),
    };
  });
}

interface MessagesState {
  messages: Record<string, Message[]>;
  loading: Record<string, boolean>;
  loadingOlder: Record<string, boolean>;
  hasMore: Record<string, boolean>;

  fetchMessages: (channelId: string, isDm?: boolean) => Promise<void>;
  fetchOlder: (channelId: string, isDm?: boolean) => Promise<void>;
  sendMessage: (channelId: string, content: string, replyToId?: string, nonce?: string) => Promise<Message>;
  sendDmMessage: (dmId: string, content: string, replyToId?: string, nonce?: string) => Promise<Message>;
  editMessage: (messageId: string, channelId: string, content: string, isDm?: boolean, nonce?: string) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string, isDm?: boolean) => Promise<void>;
  addMessage: (channelId: string, message: Message) => void;
  updateMessage: (channelId: string, message: Message) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  updateReactions: (channelId: string, messageId: string, reactions: Reaction[]) => void;
  reset: () => void;
}

const MAX_CACHED_CHANNELS = 30;

/** Evict oldest channel message caches when exceeding limit */
function evictOldChannels(messages: Record<string, Message[]>, currentChannelId: string): Record<string, Message[]> {
  const keys = Object.keys(messages);
  if (keys.length <= MAX_CACHED_CHANNELS) return messages;
  // Remove oldest entries (first keys), keep current
  const toRemove = keys.filter((k) => k !== currentChannelId).slice(0, keys.length - MAX_CACHED_CHANNELS);
  const result = { ...messages };
  for (const k of toRemove) delete result[k];
  return result;
}

export const useMessagesStore = create<MessagesState>((set, get) => ({
  messages: {},
  loading: {},
  loadingOlder: {},
  hasMore: {},

  fetchMessages: async (channelId, isDm) => {
    const hasCached = (get().messages[channelId]?.length ?? 0) > 0;
    // Show cached messages immediately but always revalidate from server
    if (!hasCached) {
      set({ loading: { ...get().loading, [channelId]: true } });
    }
    try {
      const msgs = isDm
        ? await api.getDmMessages(channelId)
        : await api.getMessages(channelId);
      const reversed = transformReactions([...msgs].reverse());
      const evicted = evictOldChannels({ ...get().messages, [channelId]: reversed }, channelId);
      set({
        messages: evicted,
        loading: { ...get().loading, [channelId]: false },
        hasMore: { ...get().hasMore, [channelId]: msgs.length >= 50 },
      });
    } catch {
      set({ loading: { ...get().loading, [channelId]: false } });
    }
  },

  fetchOlder: async (channelId, isDm) => {
    // Prevent concurrent fetchOlder calls
    if (get().loadingOlder[channelId]) return;
    const current = get().messages[channelId] ?? [];
    if (current.length === 0) return;
    set({ loadingOlder: { ...get().loadingOlder, [channelId]: true } });
    try {
      const oldest = current[0];
      const msgs = isDm
        ? await api.getDmMessages(channelId, 50, oldest.created_at)
        : await api.getMessages(channelId, 50, oldest.created_at);
      const reversed = transformReactions([...msgs].reverse());
      const fresh = get().messages[channelId] ?? [];
      set({
        messages: { ...get().messages, [channelId]: [...reversed, ...fresh] },
        hasMore: { ...get().hasMore, [channelId]: msgs.length >= 50 },
        loadingOlder: { ...get().loadingOlder, [channelId]: false },
      });
    } catch {
      set({ loadingOlder: { ...get().loadingOlder, [channelId]: false } });
    }
  },

  sendMessage: async (channelId, content, replyToId, nonce) => {
    return api.sendMessage(channelId, content, nonce, replyToId);
  },

  sendDmMessage: async (dmId, content, replyToId, nonce) => {
    return api.sendDmMessage(dmId, { content, nonce, reply_to_id: replyToId });
  },

  editMessage: async (messageId, channelId, content, isDm, nonce) => {
    if (isDm) {
      const updated = await api.editDmMessage(messageId, content, nonce);
      get().updateMessage(channelId, updated);
    } else {
      const updated = await api.editMessage(messageId, content, nonce);
      get().updateMessage(channelId, updated);
    }
  },

  deleteMessage: async (messageId, channelId, isDm) => {
    if (isDm) {
      await api.deleteDmMessage(messageId);
    } else {
      await api.deleteMessage(messageId);
    }
    get().removeMessage(channelId, messageId);
  },

  addMessage: (channelId, message) => {
    const current = get().messages[channelId] ?? [];
    if (current.some((m) => m.id === message.id)) return;
    set({ messages: { ...get().messages, [channelId]: [...current, message] } });
  },

  updateMessage: (channelId, message) => {
    const current = get().messages[channelId] ?? [];
    set({
      messages: {
        ...get().messages,
        [channelId]: current.map((m) =>
          m.id === message.id
            ? { ...m, ...message, reactions: message.reactions !== undefined ? message.reactions : m.reactions }
            : m,
        ),
      },
    });
  },

  removeMessage: (channelId, messageId) => {
    const current = get().messages[channelId] ?? [];
    set({
      messages: {
        ...get().messages,
        [channelId]: current.filter((m) => m.id !== messageId),
      },
    });
  },

  updateReactions: (channelId, messageId, reactions) => {
    const current = get().messages[channelId] ?? [];
    set({
      messages: {
        ...get().messages,
        [channelId]: current.map((m) =>
          m.id === messageId ? { ...m, reactions } : m,
        ),
      },
    });
  },

  reset: () => {
    set({ messages: {}, loading: {}, loadingOlder: {}, hasMore: {} });
  },
}));

/**
 * Coerce a raw WS message payload to the shape the UI assumes — every
 * nullable field gets a defined default, every collection becomes a
 * concrete array, and reactions get their `me` flag derived from the
 * authenticated user's id.
 *
 * Trusts the WS-boundary type (api/ws-events.ts → `event.d.message: Message`).
 * Runtime "is this actually a Message?" validation lives where the JSON
 * is parsed (api/ws.ts) — that's the real trust boundary.
 */
function normalizeWsMessage(raw: Message): Message | null {
  if (!raw.channel_id || !raw.id) return null;
  const currentUserId = useAuthStore.getState().user?.id;
  return {
    ...raw,
    content: raw.content ?? '',
    nonce: raw.nonce ?? null,
    created_at: raw.created_at ?? new Date().toISOString(),
    updated_at: raw.updated_at ?? null,
    is_edited: raw.is_edited ?? false,
    is_pinned: raw.is_pinned ?? false,
    reply_to_id: raw.reply_to_id ?? null,
    thread_id: raw.thread_id ?? null,
    thread_reply_count: raw.thread_reply_count ?? null,
    attachments: raw.attachments ?? [],
    embeds: raw.embeds ?? [],
    webhook_id: raw.webhook_id ?? null,
    webhook_name: raw.webhook_name ?? null,
    webhook_avatar: raw.webhook_avatar ?? null,
    reactions: (raw.reactions ?? []).map((r) => ({
      ...r,
      emoji: r.emoji ?? '',
      count: r.count ?? 0,
      user_ids: r.user_ids ?? [],
      me: currentUserId ? (r.user_ids ?? []).includes(currentUserId) : (r.me ?? false),
    })),
  };
}

// Wire up WebSocket events
// GatewayEvent uses serde(tag="op", content="d"), so:
//   MessageCreate/Update → d = { message: { id, channel_id, ... } }
//   MessageDelete        → d = { message_id, channel_id }
wsClient.on((event) => {
  const store = useMessagesStore.getState();
  const threads = useThreadsStore.getState();
  switch (event.op) {
    case 'MessageCreate': {
      const msg = normalizeWsMessage(event.d.message);
      if (!msg) break;
      if (msg.thread_id) {
        // Thread message → add to threads store + increment parent's thread_reply_count
        threads.addThreadMessage(msg.thread_id, msg);
        // Find the starter message in channel messages (the only channel msg with this thread_id)
        const channelMsgs = store.messages[msg.channel_id] ?? [];
        const starter = channelMsgs.find((m) => m.thread_id === msg.thread_id);
        if (starter) {
          store.updateMessage(msg.channel_id, {
            ...starter,
            thread_reply_count: (starter.thread_reply_count ?? 0) + 1,
          });
        }
      } else {
        store.addMessage(msg.channel_id, msg);
      }
      break;
    }
    case 'MessageUpdate': {
      const msg = normalizeWsMessage(event.d.message);
      if (!msg) break;
      if (msg.thread_id) {
        threads.updateThreadMessage(msg.thread_id, msg);
      }
      // Also update in channel store (starter messages live there)
      store.updateMessage(msg.channel_id, msg);
      break;
    }
    case 'MessageDelete': {
      const { channel_id: channelId, message_id: messageId } = event.d;
      if (!channelId || !messageId) break;
      store.removeMessage(channelId, messageId);
      // Also check threads store and remove from any matching thread
      const threadMsgs = threads.threadMessages;
      for (const threadId of Object.keys(threadMsgs)) {
        if (threadMsgs[threadId].some((m) => m.id === messageId)) {
          threads.removeThreadMessage(threadId, messageId);
          // Decrement the starter message's thread_reply_count in channel store
          const channelMsgs = store.messages[channelId] ?? [];
          const starter = channelMsgs.find((m) => m.thread_id === threadId);
          if (starter && (starter.thread_reply_count ?? 0) > 0) {
            store.updateMessage(channelId, {
              ...starter,
              thread_reply_count: (starter.thread_reply_count ?? 0) - 1,
            });
          }
          break;
        }
      }
      break;
    }
    case 'ThreadCreate':
    case 'ThreadUpdate': {
      threads.bumpThreadListVersion();
      break;
    }
    case 'ReactionUpdate': {
      const { channel_id, message_id, reactions: raw } = event.d;
      if (!channel_id || !message_id || !raw) break;
      const currentUserId = useAuthStore.getState().user?.id;
      const reactions = raw.map((r) => ({
        emoji: r.emoji,
        count: r.count,
        me: currentUserId ? (r.user_ids?.includes(currentUserId) ?? false) : false,
        user_ids: r.user_ids ?? [],
      }));
      store.updateReactions(channel_id, message_id, reactions);
      threads.updateThreadReactionsForMessage(message_id, reactions);
      break;
    }
    case 'PollUpdate': {
      const { poll, message_id, channel_id } = event.d;
      if (!poll || !message_id || !channel_id) break;
      // Update the message's poll data in the store
      const msgs = store.messages[channel_id];
      if (msgs) {
        useMessagesStore.setState({
          messages: {
            ...store.messages,
            [channel_id]: msgs.map((m) =>
              m.id === message_id ? { ...m, poll } : m
            ),
          },
        });
      }
      break;
    }
  }
});
