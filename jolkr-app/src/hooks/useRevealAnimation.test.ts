import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRevealAnimation } from './useRevealAnimation'
import { revealWindowMs } from '../utils/animations'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRevealAnimation', () => {
  it('starts true when active is true (default)', () => {
    const { result } = renderHook(() => useRevealAnimation(5, ['k1']))
    expect(result.current).toBe(true)
  })

  it('starts false when active is false', () => {
    const { result } = renderHook(() => useRevealAnimation(5, ['k1'], false))
    expect(result.current).toBe(false)
  })

  it('clears the flag after revealWindowMs(totalItems)', () => {
    const { result } = renderHook(() => useRevealAnimation(3, ['k1']))
    expect(result.current).toBe(true)
    act(() => { vi.advanceTimersByTime(revealWindowMs(3)) })
    expect(result.current).toBe(false)
  })

  it('honors an explicit durationMs override', () => {
    const { result } = renderHook(() => useRevealAnimation(99, ['k1'], true, 50))
    expect(result.current).toBe(true)
    act(() => { vi.advanceTimersByTime(49) })
    expect(result.current).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(false)
  })

  it('re-triggers when deps change after the previous animation cleared', () => {
    const { result, rerender } = renderHook(
      ({ deps }) => useRevealAnimation(3, deps),
      { initialProps: { deps: ['k1'] as readonly unknown[] } },
    )
    act(() => { vi.advanceTimersByTime(revealWindowMs(3)) })
    expect(result.current).toBe(false)
    rerender({ deps: ['k2'] })
    expect(result.current).toBe(true)
  })

  it('flips false → true when active turns on with the same deps', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useRevealAnimation(2, ['fixed'], active),
      { initialProps: { active: false } },
    )
    expect(result.current).toBe(false)
    rerender({ active: true })
    expect(result.current).toBe(true)
  })

  it('flips true → false immediately when active turns off mid-animation', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useRevealAnimation(2, ['fixed'], active),
      { initialProps: { active: true } },
    )
    expect(result.current).toBe(true)
    rerender({ active: false })
    expect(result.current).toBe(false)
  })
})
