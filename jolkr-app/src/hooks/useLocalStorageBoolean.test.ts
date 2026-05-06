import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalStorageBoolean, LOCAL_PREF_EVENT, notifyLocalPrefChange } from './useLocalStorageBoolean'

beforeEach(() => {
  localStorage.clear()
})

describe('useLocalStorageBoolean — initial read', () => {
  it('returns the default value when the key is missing', () => {
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.k1', true))
    expect(result.current[0]).toBe(true)
  })

  it('reads "true" / "false" from localStorage if present', () => {
    localStorage.setItem('jolkr.test.k2', 'false')
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.k2', true))
    expect(result.current[0]).toBe(false)
  })

  it('treats any non-"false" string as true', () => {
    localStorage.setItem('jolkr.test.k3', 'whatever')
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.k3', false))
    expect(result.current[0]).toBe(true)
  })
})

describe('useLocalStorageBoolean — setter', () => {
  it('persists the new value to localStorage', () => {
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.set', false))
    act(() => { result.current[1](true) })
    expect(localStorage.getItem('jolkr.test.set')).toBe('true')
    expect(result.current[0]).toBe(true)
  })

  it('flips back to false', () => {
    localStorage.setItem('jolkr.test.flip', 'true')
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.flip', true))
    act(() => { result.current[1](false) })
    expect(localStorage.getItem('jolkr.test.flip')).toBe('false')
    expect(result.current[0]).toBe(false)
  })
})

describe('useLocalStorageBoolean — same-tab fan-out', () => {
  it('updates when another consumer of the same key dispatches the change event', () => {
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.fanout', false))
    expect(result.current[0]).toBe(false)
    act(() => {
      localStorage.setItem('jolkr.test.fanout', 'true')
      notifyLocalPrefChange('jolkr.test.fanout')
    })
    expect(result.current[0]).toBe(true)
  })

  it('ignores change events for other keys', () => {
    const { result } = renderHook(() => useLocalStorageBoolean('jolkr.test.iso', false))
    act(() => {
      localStorage.setItem('jolkr.test.other', 'true')
      window.dispatchEvent(new CustomEvent(LOCAL_PREF_EVENT, { detail: { key: 'jolkr.test.other' } }))
    })
    expect(result.current[0]).toBe(false)
  })
})
