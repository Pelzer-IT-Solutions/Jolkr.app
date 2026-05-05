import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `typing.ts` calls `wsClient.on(...)` at module load to wire WS events into
// the store. Mock the module so the side-effect is a no-op during tests —
// otherwise importing the store would crash on the un-initialised real WS.
vi.mock('../api/ws', () => ({
  wsClient: { on: vi.fn() },
}))

const { useTypingStore } = await import('./typing')

beforeEach(() => {
  useTypingStore.getState().reset()
  vi.useFakeTimers()
})

afterEach(() => {
  // Drain any pending auto-clear timer that might fire across tests.
  useTypingStore.getState().reset()
  vi.useRealTimers()
})

describe('useTypingStore.setTyping', () => {
  it('adds a typing entry under the given channel + user', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    const channelTyping = useTypingStore.getState().typing['c1']
    expect(channelTyping?.['u1']?.username).toBe('alice')
  })

  it('replaces the previous timeout when the same user keeps typing', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    const firstId = useTypingStore.getState().typing['c1']?.['u1']?.timeoutId
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    const secondId = useTypingStore.getState().typing['c1']?.['u1']?.timeoutId
    expect(firstId).not.toBe(secondId)
  })

  it('auto-clears the entry after the 5s timeout fires', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    expect(useTypingStore.getState().typing['c1']?.['u1']).toBeDefined()
    vi.advanceTimersByTime(5000)
    expect(useTypingStore.getState().typing['c1']?.['u1']).toBeUndefined()
  })

  it('keeps separate state for different channels', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    useTypingStore.getState().setTyping('c2', 'u1', 'alice')
    const t = useTypingStore.getState().typing
    expect(t['c1']?.['u1']).toBeDefined()
    expect(t['c2']?.['u1']).toBeDefined()
    expect(t['c1']?.['u1']).not.toBe(t['c2']?.['u1'])
  })
})

describe('useTypingStore.clearTyping', () => {
  it('removes the entry and cancels its timeout', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    useTypingStore.getState().clearTyping('c1', 'u1')
    expect(useTypingStore.getState().typing['c1']?.['u1']).toBeUndefined()
  })

  it('is a no-op for an unknown user', () => {
    useTypingStore.getState().clearTyping('c1', 'ghost')
    expect(useTypingStore.getState().typing['c1']?.['ghost']).toBeUndefined()
  })

  it('does not affect other users in the same channel', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    useTypingStore.getState().setTyping('c1', 'u2', 'bob')
    useTypingStore.getState().clearTyping('c1', 'u1')
    expect(useTypingStore.getState().typing['c1']?.['u1']).toBeUndefined()
    expect(useTypingStore.getState().typing['c1']?.['u2']?.username).toBe('bob')
  })
})

describe('useTypingStore.reset', () => {
  it('drops all entries across all channels', () => {
    useTypingStore.getState().setTyping('c1', 'u1', 'alice')
    useTypingStore.getState().setTyping('c2', 'u9', 'eve')
    useTypingStore.getState().reset()
    expect(useTypingStore.getState().typing).toEqual({})
  })
})
