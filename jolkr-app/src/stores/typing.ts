import { create } from 'zustand'
import { useShallow } from 'zustand/shallow'
import { wsClient } from '../api/ws'
import { useServersStore } from './servers'
import { displayName } from '../utils/format'

interface TypingEntry {
  username: string
  timeoutId: ReturnType<typeof setTimeout>
}

interface TypingState {
  /** channelId → Record<userId, TypingEntry> */
  typing: Record<string, Record<string, TypingEntry>>
  setTyping: (channelId: string, userId: string, username: string) => void
  clearTyping: (channelId: string, userId: string) => void
  reset: () => void
}

const TYPING_TIMEOUT = 5000

export const useTypingStore = create<TypingState>((set, get) => ({
  typing: {},

  setTyping: (channelId, userId, username) => {
    const current = get().typing[channelId]?.[userId]
    if (current) clearTimeout(current.timeoutId)

    const timeoutId = setTimeout(() => {
      get().clearTyping(channelId, userId)
    }, TYPING_TIMEOUT)

    set(state => ({
      typing: {
        ...state.typing,
        [channelId]: {
          ...state.typing[channelId],
          [userId]: { username, timeoutId },
        },
      },
    }))
  },

  clearTyping: (channelId, userId) => {
    set(state => {
      const channelTyping = { ...state.typing[channelId] }
      if (channelTyping[userId]) {
        clearTimeout(channelTyping[userId].timeoutId)
        delete channelTyping[userId]
      }
      return {
        typing: {
          ...state.typing,
          [channelId]: channelTyping,
        },
      }
    })
  },

  reset: () => {
    const { typing } = get()
    for (const channel of Object.values(typing))
      for (const entry of Object.values(channel))
        clearTimeout(entry.timeoutId)
    set({ typing: {} })
  },
}))

/** Get array of usernames currently typing in a channel (excluding own userId) */
export function useTypingUsers(channelId: string, ownUserId: string | undefined): string[] {
  return useTypingStore(useShallow(state => {
    const channelTyping = state.typing[channelId]
    if (!channelTyping) return []
    return Object.entries(channelTyping)
      .filter(([uid]) => uid !== ownUserId)
      .map(([, entry]) => entry.username)
  }))
}

function lookupUserName(userId: string): string {
  const members = useServersStore.getState().members
  for (const list of Object.values(members)) {
    const m = list.find(x => x.user_id === userId)
    if (m?.user) return displayName(m.user)
  }
  return 'Someone'
}

// Wire WS listener — receive typing events from other users
wsClient.on((event) => {
  if (event.op === 'TypingStart') {
    const { channel_id, user_id } = event.d
    if (channel_id && user_id) {
      useTypingStore.getState().setTyping(channel_id, user_id, lookupUserName(user_id))
    }
  }
})
