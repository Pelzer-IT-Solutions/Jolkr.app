import { create } from 'zustand';
import type { Message, Reaction } from '../api/types';
import * as api from '../api/client';
import { wsClient } from '../api/ws';
import { useAuthStore } from './auth';

/** Transform backend reaction format (user_ids) to frontend format (me boolean) */
function transformReactions(msgs: Message[]): Message[] {
  const currentUserId = useAuthStore.getState().user?.id;
  if (!currentUserId) return msgs;
  return msgs.map((m) => {
    if (!m.reactions?.length) return m;
    return {
      ...m,
      reactions: m.reactions.map((r: Reaction & { user_ids?: string[] }) => ({
        emoji: r.emoji,
        count: r.count,
        me: r.user_ids ? r.user_ids.includes(currentUserId) : r.me ?? false,
      })),
    };
  });
}

interface MessagesState {
  messages: Record<string, Message[]>;
  loading: Record<string, boolean>;
  loadingOlder: Record<string, boolean>;
  hasMore: Record<string, boolean>;

  // Thread messages keyed by threadId
  threadMessages: Record<string, Message[]>;
  threadLoading: Record<string, boolean>;
  threadLoadingOlder: Record<string, boolean>;
  threadHasMore: Record<string, boolean>;

  // Counter incremented on ThreadCreate/ThreadUpdate WS events — watchers re-fetch thread lists
  threadListVersion: number;

  fetchMessages: (channelId: string, isDm?: boolean) => Promise<void>;
  fetchOlder: (channelId: string, isDm?: boolean) => Promise<void>;
  sendMessage: (channelId: string, content: string, replyToId?: string) => Promise<Message>;
  sendDmMessage: (dmId: string, content: string | null, replyToId?: string, encryptedContent?: string, nonce?: string) => Promise<Message>;
  editMessage: (messageId: string, channelId: string, content: string, isDm?: boolean) => Promise<void>;
  deleteMessage: (messageId: string, channelId: string, isDm?: boolean) => Promise<void>;
  addMessage: (channelId: string, message: Message) => void;
  updateMessage: (channelId: string, message: Message) => void;
  removeMessage: (channelId: string, messageId: string) => void;
  updateReactions: (channelId: string, messageId: string, reactions: Reaction[]) => void;

  // Thread actions
  fetchThreadMessages: (threadId: string) => Promise<void>;
  fetchOlderThreadMessages: (threadId: string) => Promise<void>;
  sendThreadMessage: (threadId: string, content: string, replyToId?: string) => Promise<Message>;
  addThreadMessage: (threadId: string, message: Message) => void;
  updateThreadMessage: (threadId: string, message: Message) => void;
  removeThreadMessage: (threadId: string, messageId: string) => void;
  clearThreadMessages: (threadId: string) => void;
  reset: () => void;
}

// Map DM message response to Message interface
function normalizeDmMessages(msgs: unknown[], dmId: string): Message[] {
  return (msgs as Array<Record<string, unknown>>).map((m) => ({
    id: m.id as string,
    channel_id: (m.dm_channel_id as string) ?? dmId,
    author_id: m.author_id as string,
    content: (m.content as string) ?? '',
    encrypted_content: (m.encrypted_content as string) ?? null,
    nonce: (m.nonce as string) ?? null,
    created_at: m.created_at as string,
    updated_at: (m.updated_at as string) ?? null,
    is_edited: (m.is_edited as boolean) ?? false,
    is_pinned: false,
    reply_to_id: (m.reply_to_id as string) ?? null,
    attachments: (m.attachments as Message['attachments']) ?? [],
    reactions: (m.reactions as Reaction[]) ?? [],
    embeds: (m.embeds as Message['embeds']) ?? [],
  }));
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
  threadMessages: {},
  threadLoading: {},
  threadLoadingOlder: {},
  threadHasMore: {},
  threadListVersion: 0,

  fetchMessages: async (channelId, isDm) => {
    const hasCached = (get().messages[channelId]?.length ?? 0) > 0;
    if (hasCached) {
      // Ensure loading is explicitly false for cached channels (stale-while-revalidate)
      if (get().loading[channelId]) {
        set({ loading: { ...get().loading, [channelId]: false } });
      }
    } else {
      set({ loading: { ...get().loading, [channelId]: true } });
    }
    try {
      let msgs: Message[];
      if (isDm) {
        const raw = await api.getDmMessages(channelId);
        msgs = normalizeDmMessages(raw, channelId);
      } else {
        msgs = await api.getMessages(channelId);
      }
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
      let msgs: Message[];
      if (isDm) {
        const raw = await api.getDmMessages(channelId, 50, oldest.created_at);
        msgs = normalizeDmMessages(raw, channelId);
      } else {
        msgs = await api.getMessages(channelId, 50, oldest.created_at);
      }
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

  sendMessage: async (channelId, content, replyToId) => {
    return api.sendMessage(channelId, content, undefined, replyToId);
  },

  sendDmMessage: async (dmId, content, replyToId, encryptedContent, nonce) => {
    return api.sendDmMessage(dmId, {
      content: content ?? undefined,
      encrypted_content: encryptedContent,
      nonce,
      reply_to_id: replyToId,
    });
  },

  editMessage: async (messageId, channelId, content, isDm) => {
    if (isDm) {
      const raw = await api.editDmMessage(messageId, content);
      const normalized = normalizeDmMessages([raw], channelId)[0];
      get().updateMessage(channelId, normalized);
    } else {
      const updated = await api.editMessage(messageId, content);
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
    const updatedMessages = {
      ...get().messages,
      [channelId]: current.map((m) =>
        m.id === messageId ? { ...m, reactions } : m,
      ),
    };

    // Also update reactions in threadMessages
    const threadMsgs = { ...get().threadMessages };
    for (const threadId of Object.keys(threadMsgs)) {
      const threadArr = threadMsgs[threadId];
      if (threadArr.some((m) => m.id === messageId)) {
        threadMsgs[threadId] = threadArr.map((m) =>
          m.id === messageId ? { ...m, reactions } : m,
        );
        break;
      }
    }

    set({ messages: updatedMessages, threadMessages: threadMsgs });
  },

  // ── Thread actions ────────────────────────────────────────────────

  fetchThreadMessages: async (threadId) => {
    if (get().threadLoading[threadId]) return;
    set({ threadLoading: { ...get().threadLoading, [threadId]: true } });
    try {
      const msgs = await api.getThreadMessages(threadId);
      const reversed = transformReactions([...msgs].reverse());
      set({
        threadMessages: { ...get().threadMessages, [threadId]: reversed },
        threadLoading: { ...get().threadLoading, [threadId]: false },
        threadHasMore: { ...get().threadHasMore, [threadId]: msgs.length >= 50 },
      });
    } catch {
      set({ threadLoading: { ...get().threadLoading, [threadId]: false } });
    }
  },

  fetchOlderThreadMessages: async (threadId) => {
    if (get().threadLoadingOlder[threadId]) return;
    const current = get().threadMessages[threadId] ?? [];
    if (current.length === 0) return;
    set({ threadLoadingOlder: { ...get().threadLoadingOlder, [threadId]: true } });
    try {
      const oldest = current[0];
      const msgs = await api.getThreadMessages(threadId, 50, oldest.created_at);
      const reversed = transformReactions([...msgs].reverse());
      const fresh = get().threadMessages[threadId] ?? [];
      set({
        threadMessages: { ...get().threadMessages, [threadId]: [...reversed, ...fresh] },
        threadHasMore: { ...get().threadHasMore, [threadId]: msgs.length >= 50 },
        threadLoadingOlder: { ...get().threadLoadingOlder, [threadId]: false },
      });
    } catch {
      set({ threadLoadingOlder: { ...get().threadLoadingOlder, [threadId]: false } });
    }
  },

  sendThreadMessage: async (threadId, content, replyToId) => {
    return api.sendThreadMessage(threadId, content, replyToId);
  },

  addThreadMessage: (threadId, message) => {
    const current = get().threadMessages[threadId] ?? [];
    if (current.some((m) => m.id === message.id)) return;
    set({ threadMessages: { ...get().threadMessages, [threadId]: [...current, message] } });
  },

  updateThreadMessage: (threadId, message) => {
    const current = get().threadMessages[threadId] ?? [];
    set({
      threadMessages: {
        ...get().threadMessages,
        [threadId]: current.map((m) =>
          m.id === message.id
            ? { ...m, ...message, reactions: message.reactions !== undefined ? message.reactions : m.reactions }
            : m,
        ),
      },
    });
  },

  removeThreadMessage: (threadId, messageId) => {
    const current = get().threadMessages[threadId] ?? [];
    set({
      threadMessages: {
        ...get().threadMessages,
        [threadId]: current.filter((m) => m.id !== messageId),
      },
    });
  },

  clearThreadMessages: (threadId) => {
    const { [threadId]: _, ...restMsgs } = get().threadMessages;
    const { [threadId]: _l, ...restLoading } = get().threadLoading;
    const { [threadId]: _lo, ...restLoadingOlder } = get().threadLoadingOlder;
    const { [threadId]: _h, ...restHasMore } = get().threadHasMore;
    set({
      threadMessages: restMsgs,
      threadLoading: restLoading,
      threadLoadingOlder: restLoadingOlder,
      threadHasMore: restHasMore,
    });
  },

  reset: () => {
    set({ messages: {}, loading: {}, loadingOlder: {}, hasMore: {}, threadMessages: {}, threadLoading: {}, threadLoadingOlder: {}, threadHasMore: {}, threadListVersion: 0 });
  },
}));

/** Safely normalize a raw WS message payload into a Message with safe defaults. */
function normalizeWsMessage(raw: Record<string, unknown>): Message | null {
  const channelId = (raw?.channel_id ?? raw?.dm_channel_id) as string | undefined;
  if (!channelId || !raw?.id) return null;
  return {
    id: raw.id as string,
    channel_id: channelId,
    author_id: (raw.author_id as string) ?? '',
    content: (raw.content as string) ?? '',
    encrypted_content: (raw.encrypted_content as string) ?? null,
    nonce: (raw.nonce as string) ?? null,
    created_at: (raw.created_at as string) ?? new Date().toISOString(),
    updated_at: (raw.updated_at as string) ?? null,
    is_edited: (raw.is_edited as boolean) ?? false,
    is_pinned: (raw.is_pinned as boolean) ?? false,
    reply_to_id: (raw.reply_to_id as string) ?? null,
    thread_id: (raw.thread_id as string) ?? null,
    thread_reply_count: (raw.thread_reply_count as number) ?? null,
    attachments: (raw.attachments as Message['attachments']) ?? [],
    reactions: (raw.reactions as Message['reactions']) ?? [],
    embeds: (raw.embeds as Message['embeds']) ?? [],
  };
}

// Wire up WebSocket events
// GatewayEvent uses serde(tag="op", content="d"), so:
//   MessageCreate/Update → d = { message: { id, channel_id, ... } }
//   MessageDelete        → d = { message_id, channel_id }
wsClient.on((op, d) => {
  const store = useMessagesStore.getState();
  switch (op) {
    case 'MessageCreate': {
      const raw = d.message as Record<string, unknown>;
      const msg = normalizeWsMessage(raw);
      if (!msg) break;
      if (msg.thread_id) {
        // Thread message → add to thread store + increment parent's thread_reply_count
        store.addThreadMessage(msg.thread_id, msg);
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
      const raw = d.message as Record<string, unknown>;
      const msg = normalizeWsMessage(raw);
      if (!msg) break;
      if (msg.thread_id) {
        // Update in thread store
        store.updateThreadMessage(msg.thread_id, msg);
      }
      // Also update in channel store (starter messages live there)
      store.updateMessage(msg.channel_id, msg);
      break;
    }
    case 'MessageDelete': {
      const channelId = (d.channel_id ?? d.dm_channel_id) as string | undefined;
      const messageId = d.message_id as string | undefined;
      if (!channelId || !messageId) break;
      // Remove from channel messages
      store.removeMessage(channelId, messageId);
      // Also check thread stores and remove from any matching thread
      const threadMsgs = store.threadMessages;
      for (const threadId of Object.keys(threadMsgs)) {
        if (threadMsgs[threadId].some((m) => m.id === messageId)) {
          store.removeThreadMessage(threadId, messageId);
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
      // Increment version counter so ThreadListPanel re-fetches
      useMessagesStore.setState({ threadListVersion: store.threadListVersion + 1 });
      break;
    }
    case 'ReactionUpdate': {
      const channelId = d.channel_id as string;
      const messageId = d.message_id as string;
      const rawReactions = d.reactions as Array<{ emoji: string; count: number; user_ids?: string[] }>;
      if (!channelId || !messageId || !rawReactions) break;
      const currentUserId = useAuthStore.getState().user?.id;
      const reactions = rawReactions.map((r) => ({
        emoji: r.emoji,
        count: r.count,
        me: currentUserId ? (r.user_ids?.includes(currentUserId) ?? false) : false,
      }));
      store.updateReactions(channelId, messageId, reactions);
      break;
    }
    case 'PollUpdate': {
      const poll = d.poll as unknown as Message['poll'];
      const messageId = d.message_id as string;
      const channelId = d.channel_id as string;
      if (!poll || !messageId || !channelId) break;
      // Update the message's poll data in the store
      const msgs = store.messages[channelId];
      if (msgs) {
        useMessagesStore.setState({
          messages: {
            ...store.messages,
            [channelId]: msgs.map((m) =>
              m.id === messageId ? { ...m, poll } : m
            ),
          },
        });
      }
      break;
    }
  }
});
