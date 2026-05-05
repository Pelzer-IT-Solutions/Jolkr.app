import { describe, it, expect, beforeEach, vi } from 'vitest'

// `unread.ts` wires WS events at import time and depends on the auth and
// messages stores for `setActiveChannel`'s lastSeen tracking. Mock the WS
// + auth modules so the import is side-effect-free; the messages store is
// mocked module-shaped so we can drive `messages` directly per test.
vi.mock('../api/ws', () => ({ wsClient: { on: vi.fn() } }))
vi.mock('./auth', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'me' } }),
  },
}))

const messagesState: { messages: Record<string, Array<{ id: string }>> } = { messages: {} }
vi.mock('./messages', () => ({
  useMessagesStore: {
    getState: () => messagesState,
  },
}))

const { useUnreadStore } = await import('./unread')

beforeEach(() => {
  useUnreadStore.getState().reset()
  messagesState.messages = {}
  // `reset` removes the localStorage key, but leftovers from a previous
  // test file could still be there; clear once for determinism.
  localStorage.clear()
})

describe('useUnreadStore.increment', () => {
  it('increments the count for a non-active channel', () => {
    useUnreadStore.getState().increment('c1')
    useUnreadStore.getState().increment('c1')
    expect(useUnreadStore.getState().counts['c1']).toBe(2)
  })

  it('does NOT increment the active channel (caller is already viewing it)', () => {
    useUnreadStore.getState().setActiveChannel('c1')
    useUnreadStore.getState().increment('c1')
    expect(useUnreadStore.getState().counts['c1']).toBeUndefined()
  })

  it('keeps separate counts per channel', () => {
    useUnreadStore.getState().increment('c1')
    useUnreadStore.getState().increment('c2')
    useUnreadStore.getState().increment('c2')
    expect(useUnreadStore.getState().counts['c1']).toBe(1)
    expect(useUnreadStore.getState().counts['c2']).toBe(2)
  })
})

describe('useUnreadStore.markRead', () => {
  it('removes the count entry for a previously-unread channel', () => {
    useUnreadStore.getState().increment('c1')
    useUnreadStore.getState().markRead('c1')
    expect(useUnreadStore.getState().counts['c1']).toBeUndefined()
  })

  it('is a no-op when the channel is already read', () => {
    useUnreadStore.getState().markRead('c-never-incremented')
    expect(useUnreadStore.getState().counts).toEqual({})
  })
})

describe('useUnreadStore.setActiveChannel', () => {
  it('marks the new active channel as read', () => {
    useUnreadStore.getState().increment('c1')
    useUnreadStore.getState().setActiveChannel('c1')
    expect(useUnreadStore.getState().counts['c1']).toBeUndefined()
    expect(useUnreadStore.getState().activeChannel).toBe('c1')
  })

  it('saves lastSeen for the previous channel before switching', () => {
    messagesState.messages = { c1: [{ id: 'msgA' }, { id: 'msgB' }] }
    useUnreadStore.getState().setActiveChannel('c1')
    useUnreadStore.getState().setActiveChannel('c2')
    expect(useUnreadStore.getState().lastSeenMessageId['c1']).toBe('msgB')
  })

  it('persists lastSeen to localStorage on channel switch', () => {
    messagesState.messages = { c1: [{ id: 'msgA' }] }
    useUnreadStore.getState().setActiveChannel('c1')
    useUnreadStore.getState().setActiveChannel(null)
    const stored = JSON.parse(localStorage.getItem('jolkr_last_seen') ?? '{}')
    expect(stored['c1']).toBe('msgA')
  })

  it('does not write lastSeen when leaving an empty channel', () => {
    useUnreadStore.getState().setActiveChannel('c1')
    useUnreadStore.getState().setActiveChannel('c2')
    expect(useUnreadStore.getState().lastSeenMessageId['c1']).toBeUndefined()
  })
})

describe('useUnreadStore.getTotalForChannels', () => {
  it('sums unread across the listed channels', () => {
    useUnreadStore.getState().increment('c1')
    useUnreadStore.getState().increment('c1')
    useUnreadStore.getState().increment('c2')
    useUnreadStore.getState().increment('c3')
    expect(useUnreadStore.getState().getTotalForChannels(['c1', 'c2'])).toBe(3)
  })

  it('returns 0 when none of the channels have unread', () => {
    expect(useUnreadStore.getState().getTotalForChannels(['x', 'y'])).toBe(0)
  })

  it('treats unknown channel ids as zero', () => {
    useUnreadStore.getState().increment('c1')
    expect(useUnreadStore.getState().getTotalForChannels(['c1', 'unknown'])).toBe(1)
  })
})

describe('useUnreadStore.markServerRead', () => {
  it('clears unread for every listed channel id', () => {
    useUnreadStore.getState().increment('a')
    useUnreadStore.getState().increment('b')
    useUnreadStore.getState().increment('c')
    useUnreadStore.getState().markServerRead(['a', 'b'])
    expect(useUnreadStore.getState().counts['a']).toBeUndefined()
    expect(useUnreadStore.getState().counts['b']).toBeUndefined()
    expect(useUnreadStore.getState().counts['c']).toBe(1)
  })
})

describe('useUnreadStore.reset', () => {
  it('clears counts, activeChannel, and lastSeenMessageId', () => {
    messagesState.messages = { c1: [{ id: 'm' }] }
    useUnreadStore.getState().increment('c2')
    useUnreadStore.getState().setActiveChannel('c1')
    useUnreadStore.getState().setActiveChannel(null) // captures lastSeen for c1
    useUnreadStore.getState().reset()
    const s = useUnreadStore.getState()
    expect(s.counts).toEqual({})
    expect(s.activeChannel).toBeNull()
    expect(s.lastSeenMessageId).toEqual({})
  })

  it('removes the lastSeen localStorage entry', () => {
    localStorage.setItem('jolkr_last_seen', '{"c1":"x"}')
    useUnreadStore.getState().reset()
    expect(localStorage.getItem('jolkr_last_seen')).toBeNull()
  })
})
