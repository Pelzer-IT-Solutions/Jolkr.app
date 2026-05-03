import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/ws', () => ({ wsClient: { on: vi.fn() } }))

const { usePresenceStore } = await import('./presence')

beforeEach(() => {
  usePresenceStore.getState().clearAll()
})

describe('usePresenceStore.setStatus', () => {
  it('records a new status for a user', () => {
    usePresenceStore.getState().setStatus('u1', 'online')
    expect(usePresenceStore.getState().statuses['u1']).toBe('online')
  })

  it('updates an existing status', () => {
    usePresenceStore.getState().setStatus('u1', 'online')
    usePresenceStore.getState().setStatus('u1', 'dnd')
    expect(usePresenceStore.getState().statuses['u1']).toBe('dnd')
  })

  it('skips the set call when the status is unchanged (referential equality)', () => {
    usePresenceStore.getState().setStatus('u1', 'online')
    const before = usePresenceStore.getState().statuses
    usePresenceStore.getState().setStatus('u1', 'online')
    const after = usePresenceStore.getState().statuses
    expect(before).toBe(after)
  })
})

describe('usePresenceStore.setBulk', () => {
  it('merges multiple statuses in a single update', () => {
    usePresenceStore.getState().setBulk({ u1: 'online', u2: 'idle', u3: 'dnd' })
    expect(usePresenceStore.getState().statuses).toEqual({ u1: 'online', u2: 'idle', u3: 'dnd' })
  })

  it('preserves existing statuses for users not in the bulk payload', () => {
    usePresenceStore.getState().setStatus('u1', 'online')
    usePresenceStore.getState().setBulk({ u2: 'idle' })
    expect(usePresenceStore.getState().statuses['u1']).toBe('online')
    expect(usePresenceStore.getState().statuses['u2']).toBe('idle')
  })

  it('skips the set call when nothing actually changed (referential equality)', () => {
    usePresenceStore.getState().setBulk({ u1: 'online', u2: 'dnd' })
    const before = usePresenceStore.getState().statuses
    usePresenceStore.getState().setBulk({ u1: 'online', u2: 'dnd' })
    const after = usePresenceStore.getState().statuses
    expect(before).toBe(after)
  })
})

describe('usePresenceStore.clearAll', () => {
  it('drops every recorded status', () => {
    usePresenceStore.getState().setBulk({ u1: 'online', u2: 'idle' })
    usePresenceStore.getState().clearAll()
    expect(usePresenceStore.getState().statuses).toEqual({})
  })
})
