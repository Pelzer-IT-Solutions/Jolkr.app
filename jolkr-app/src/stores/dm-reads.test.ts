import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../api/ws', () => ({ wsClient: { on: vi.fn() } }))

const { useDmReadsStore } = await import('./dm-reads')

beforeEach(() => {
  useDmReadsStore.getState().reset()
})

describe('useDmReadsStore.setReadState', () => {
  it('records the lastReadMessageId for a (dm, user) tuple', () => {
    useDmReadsStore.getState().setReadState('d1', 'u1', 'm-100')
    expect(useDmReadsStore.getState().readStates['d1']?.['u1']).toBe('m-100')
  })

  it('updates an existing entry without losing siblings in the same dm', () => {
    useDmReadsStore.getState().setReadState('d1', 'u1', 'm-1')
    useDmReadsStore.getState().setReadState('d1', 'u2', 'm-2')
    useDmReadsStore.getState().setReadState('d1', 'u1', 'm-9')
    expect(useDmReadsStore.getState().readStates['d1']).toEqual({ u1: 'm-9', u2: 'm-2' })
  })

  it('keeps separate per-dm maps', () => {
    useDmReadsStore.getState().setReadState('d1', 'u1', 'm-1')
    useDmReadsStore.getState().setReadState('d2', 'u1', 'm-2')
    expect(useDmReadsStore.getState().readStates['d1']?.['u1']).toBe('m-1')
    expect(useDmReadsStore.getState().readStates['d2']?.['u1']).toBe('m-2')
  })
})

describe('useDmReadsStore.reset', () => {
  it('drops every recorded read-state', () => {
    useDmReadsStore.getState().setReadState('d1', 'u1', 'm-1')
    useDmReadsStore.getState().setReadState('d2', 'u9', 'm-9')
    useDmReadsStore.getState().reset()
    expect(useDmReadsStore.getState().readStates).toEqual({})
  })
})
