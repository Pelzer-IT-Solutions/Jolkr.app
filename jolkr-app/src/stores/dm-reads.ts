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
wsClient.on((event) => {
  if (event.op === 'DmMessagesRead') {
    const { dm_id, user_id, message_id } = event.d;
    if (dm_id && user_id && message_id) {
      useDmReadsStore.getState().setReadState(dm_id, user_id, message_id);
    }
  }
});
