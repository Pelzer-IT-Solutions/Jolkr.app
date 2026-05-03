import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDebouncedValue', () => {
  it('returns the initial value synchronously on first render', () => {
    const { result } = renderHook(() => useDebouncedValue('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('does not update before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
  })

  it('updates once the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe('b')
  })

  it('coalesces rapid changes — only the latest value sticks', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    )
    rerender({ value: 'b' })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ value: 'c' })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ value: 'd' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe('d')
  })

  it('honors a changed delay', () => {
    const { result, rerender } = renderHook(
      ({ value, ms }) => useDebouncedValue(value, ms),
      { initialProps: { value: 'a', ms: 300 } },
    )
    rerender({ value: 'b', ms: 100 })
    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe('b')
  })
})
