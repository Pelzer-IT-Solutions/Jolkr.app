import { create } from 'zustand';
import * as api from '../api/client';
import { useAuthStore } from './auth';
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

interface ThreadsState {
  threadMessages: Record<string, Message[]>;
  threadLoading: Record<string, boolean>;
  threadLoadingOlder: Record<string, boolean>;
  threadHasMore: Record<string, boolean>;

  // Counter incremented on ThreadCreate/ThreadUpdate WS events — watchers re-fetch thread lists
  threadListVersion: number;

  fetchThreadMessages: (threadId: string) => Promise<void>;
  fetchOlderThreadMessages: (threadId: string) => Promise<void>;
  sendThreadMessage: (threadId: string, content: string, replyToId?: string, nonce?: string) => Promise<Message>;
  addThreadMessage: (threadId: string, message: Message) => void;
  updateThreadMessage: (threadId: string, message: Message) => void;
  removeThreadMessage: (threadId: string, messageId: string) => void;
  /** Update reactions on a message wherever it lives in any thread cache. */
  updateThreadReactionsForMessage: (messageId: string, reactions: Reaction[]) => void;
  clearThreadMessages: (threadId: string) => void;
  bumpThreadListVersion: () => void;
  reset: () => void;
}

export const useThreadsStore = create<ThreadsState>((set, get) => ({
  threadMessages: {},
  threadLoading: {},
  threadLoadingOlder: {},
  threadHasMore: {},
  threadListVersion: 0,

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

  sendThreadMessage: async (threadId, content, replyToId, nonce) => {
    return api.sendThreadMessage(threadId, content, nonce, replyToId);
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

  updateThreadReactionsForMessage: (messageId, reactions) => {
    const threadMsgs = { ...get().threadMessages };
    for (const threadId of Object.keys(threadMsgs)) {
      const arr = threadMsgs[threadId];
      if (arr.some((m) => m.id === messageId)) {
        threadMsgs[threadId] = arr.map((m) =>
          m.id === messageId ? { ...m, reactions } : m,
        );
        set({ threadMessages: threadMsgs });
        return;
      }
    }
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

  bumpThreadListVersion: () => {
    set({ threadListVersion: get().threadListVersion + 1 });
  },

  reset: () => {
    set({
      threadMessages: {},
      threadLoading: {},
      threadLoadingOlder: {},
      threadHasMore: {},
      threadListVersion: 0,
    });
  },
}));
