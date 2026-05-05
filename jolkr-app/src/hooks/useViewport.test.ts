import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewport } from './useViewport'

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: px,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setWidth(1280)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useViewport', () => {
  it('initializes from window.innerWidth on mount', () => {
    setWidth(1280)
    const { result } = renderHook(() => useViewport())
    expect(result.current.regime).toBe('wide')
    expect(result.current.isWide).toBe(true)
    expect(result.current.isTablet).toBe(false)
    expect(result.current.isCompact).toBe(false)
    expect(result.current.isMobile).toBe(false)
  })

  it('classifies the four regimes by breakpoint', () => {
    setWidth(500)
    expect(renderHook(() => useViewport()).result.current.regime).toBe('mobile')

    setWidth(700)
    expect(renderHook(() => useViewport()).result.current.regime).toBe('compact')

    setWidth(900)
    expect(renderHook(() => useViewport()).result.current.regime).toBe('tablet')

    setWidth(1500)
    expect(renderHook(() => useViewport()).result.current.regime).toBe('wide')
  })

  it('updates regime when crossing a breakpoint via resize', () => {
    setWidth(1280)
    const { result } = renderHook(() => useViewport())
    expect(result.current.regime).toBe('wide')

    act(() => {
      setWidth(700)
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(32)
    })
    expect(result.current.regime).toBe('compact')
  })

  it('bails out (no re-render) on resize within the same regime', () => {
    setWidth(1280)
    const { result } = renderHook(() => useViewport())
    const firstSnapshot = result.current

    act(() => {
      setWidth(1400)
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(32)
    })
    expect(result.current).toBe(firstSnapshot)
  })

  it('boundary: width === BP_TABLET (1024) is wide, < 1024 is tablet', () => {
    setWidth(1024)
    expect(renderHook(() => useViewport()).result.current.regime).toBe('wide')

    setWidth(1023)
    expect(renderHook(() => useViewport()).result.current.regime).toBe('tablet')
  })

  it('cleans up the resize listener on unmount', () => {
    setWidth(1280)
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useViewport())
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    removeSpy.mockRestore()
  })
})
