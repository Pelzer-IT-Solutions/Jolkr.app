import { describe, it, expect, beforeEach } from 'vitest'
import { useToast } from './toast'

beforeEach(() => {
  useToast.getState().clear()
})

describe('useToast.show', () => {
  it('sets the message and defaults kind to info', () => {
    useToast.getState().show('hello')
    const s = useToast.getState()
    expect(s.message).toBe('hello')
    expect(s.kind).toBe('info')
  })

  it('uses 3000ms duration for non-error kinds by default', () => {
    useToast.getState().show('hi', 'info')
    expect(useToast.getState().duration).toBe(3000)
    useToast.getState().show('done', 'success')
    expect(useToast.getState().duration).toBe(3000)
  })

  it('uses 5000ms duration for error toasts by default (longer read window)', () => {
    useToast.getState().show('boom', 'error')
    expect(useToast.getState().duration).toBe(5000)
  })

  it('honors an explicit duration override regardless of kind', () => {
    useToast.getState().show('boom', 'error', 12_000)
    expect(useToast.getState().duration).toBe(12_000)
    useToast.getState().show('hi', 'info', 1_000)
    expect(useToast.getState().duration).toBe(1_000)
  })
})

describe('useToast.clear', () => {
  it('drops the message but keeps the last kind/duration', () => {
    useToast.getState().show('boom', 'error')
    useToast.getState().clear()
    expect(useToast.getState().message).toBeNull()
    expect(useToast.getState().kind).toBe('error')
    expect(useToast.getState().duration).toBe(5000)
  })
})
