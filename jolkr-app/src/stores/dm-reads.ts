import { create } from 'zustand';
import { wsClient } from '../api/ws';

interface DmReadsState {
  // dmId -> userId -> lastReadMessageId
  readStates: Record<string, Record<string, string>>;
  setReadState: (dmId: string, userId: string, messageId: string) => void;
  reset: () => void;
}

export const useDmReadsStore = create<DmReadsState>((set, get) => ({
  readStates: {},
  setReadState: (dmId, userId, messageId) => {
    const current = get().readStates;
    set({
      readStates: {
        ...current,
        [dmId]: { ...(current[dmId] ?? {}), [userId]: messageId },
      },
    });
  },

  reset: () => {
    set({ readStates: {} });
  },
}));

// Wire up WS events
wsClient.on((op, d) => {
  if (op === 'DmMessagesRead') {
    const dmId = d.dm_id as string;
    const userId = d.user_id as string;
    const messageId = d.message_id as string;
    if (dmId && userId && messageId) {
      useDmReadsStore.getState().setReadState(dmId, userId, messageId);
    }
  }
});
