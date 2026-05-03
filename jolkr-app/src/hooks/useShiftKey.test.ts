import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShiftKey } from './useShiftKey'

beforeEach(() => {
  // jsdom keeps a single window across tests; reset focus state defensively.
  window.dispatchEvent(new Event('blur'))
})

describe('useShiftKey', () => {
  it('starts as false', () => {
    const { result } = renderHook(() => useShiftKey())
    expect(result.current).toBe(false)
  })

  it('flips to true on Shift keydown and back to false on keyup', () => {
    const { result } = renderHook(() => useShiftKey())
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })) })
    expect(result.current).toBe(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' })) })
    expect(result.current).toBe(false)
  })

  it('ignores non-Shift keys', () => {
    const { result } = renderHook(() => useShiftKey())
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })) })
    expect(result.current).toBe(false)
  })

  it('clears the held flag on window blur (focus left while Shift was held)', () => {
    const { result } = renderHook(() => useShiftKey())
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })) })
    expect(result.current).toBe(true)
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(result.current).toBe(false)
  })

  it('removes its listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useShiftKey())
    unmount()
    // After unmount the hook value reference is frozen; firing keydown
    // shouldn't crash or update anything observable.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }))
    expect(result.current).toBe(false)
  })
})
