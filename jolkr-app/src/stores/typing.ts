import { create } from 'zustand'
import { useShallow } from 'zustand/shallow'
import { wsClient } from '../api/ws'
import { useUsersStore } from './users'

interface TypingEntry {
  timeoutId: ReturnType<typeof setTimeout>
}

interface TypingState {
  /** channelId → Record<userId, TypingEntry> */
  typing: Record<string, Record<string, TypingEntry>>
  setTyping: (channelId: string, userId: string) => void
  clearTyping: (channelId: string, userId: string) => void
  reset: () => void
}

const TYPING_TIMEOUT = 5000

export const useTypingStore = create<TypingState>((set, get) => ({
  typing: {},

  setTyping: (channelId, userId) => {
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
          [userId]: { timeoutId },
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

/**
 * Return display names of users currently typing in a channel (excluding self).
 *
 * The WS event only carries `user_id` — names are resolved against the
 * shared users cache (fed by member fetches, DM-user lookups, friendship
 * loads, and `UserUpdate` WS events) so we don't pay a DB roundtrip per
 * keystroke and the indicator works equally well in servers and DMs. If a
 * user can't be resolved we fall back to a generic label rather than
 * leaking the raw uuid.
 */
export function useTypingUsers(channelId: string, ownUserId: string | undefined): string[] {
  const typingUserIds = useTypingStore(useShallow(state => {
    const channelTyping = state.typing[channelId]
    if (!channelTyping) return []
    return Object.keys(channelTyping).filter(uid => uid !== ownUserId)
  }))

  return useUsersStore(useShallow(state => {
    if (typingUserIds.length === 0) return []
    return typingUserIds.map(uid => {
      const u = state.byId[uid]
      return u?.display_name?.trim() || u?.username || 'Someone'
    })
  }))
}

// Wire WS listener — receive typing events from other users
wsClient.on((event) => {
  if (event.op === 'TypingStart') {
    const { channel_id, user_id } = event.d
    if (channel_id && user_id) {
      useTypingStore.getState().setTyping(channel_id, user_id)
    }
  }
})
