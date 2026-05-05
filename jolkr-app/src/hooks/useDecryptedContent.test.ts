import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock the e2ee + crypto modules BEFORE importing the hook so its top-level
// imports resolve to the spies. Each test resets the mock state via the
// helpers below.
vi.mock('../services/e2ee', () => ({
  isE2EEReady: vi.fn(),
  getLocalKeys: vi.fn(),
}))
vi.mock('../crypto/channelKeys', () => ({
  decryptChannelMessage: vi.fn(),
}))

import { useDecryptedContent } from './useDecryptedContent'
import { isE2EEReady, getLocalKeys } from '../services/e2ee'
import { decryptChannelMessage } from '../crypto/channelKeys'

const mockIsReady = vi.mocked(isE2EEReady)
const mockGetKeys = vi.mocked(getLocalKeys)
const mockDecrypt = vi.mocked(decryptChannelMessage)

const FAKE_KEYS = { sentinel: true } as never

beforeEach(() => {
  mockIsReady.mockReset()
  mockGetKeys.mockReset()
  mockDecrypt.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDecryptedContent', () => {
  it('returns plaintext synchronously when nonce is missing', () => {
    const { result } = renderHook(() =>
      useDecryptedContent('hello', null, false, 'channel-1'),
    )
    expect(result.current).toEqual({
      displayContent: 'hello',
      isEncrypted: false,
      decrypting: false,
    })
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  it('returns the keys-unavailable placeholder when channelId is missing', () => {
    const { result } = renderHook(() =>
      useDecryptedContent('ciphertext', 'nonce', false, undefined),
    )
    expect(result.current.displayContent).toMatch(/keys unavailable/i)
    expect(result.current.isEncrypted).toBe(true)
    expect(result.current.decrypting).toBe(false)
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  it('decrypts and returns plaintext when E2EE is ready', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetKeys.mockReturnValue(FAKE_KEYS)
    mockDecrypt.mockResolvedValue('plaintext-out')

    const { result } = renderHook(() =>
      useDecryptedContent('cipher', 'nonce', false, 'channel-1'),
    )
    expect(result.current.decrypting).toBe(true)

    await waitFor(() => expect(result.current.decrypting).toBe(false))
    expect(result.current.displayContent).toBe('plaintext-out')
    expect(result.current.isEncrypted).toBe(true)
    expect(mockDecrypt).toHaveBeenCalledWith(
      'channel-1',
      FAKE_KEYS,
      'cipher',
      'nonce',
      false,
    )
  })

  it('shows the fail placeholder when decrypt rejects', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetKeys.mockReturnValue(FAKE_KEYS)
    mockDecrypt.mockRejectedValue(new Error('boom'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() =>
      useDecryptedContent('cipher', 'nonce', false, 'channel-1'),
    )
    await waitFor(() => expect(result.current.decrypting).toBe(false))
    expect(result.current.displayContent).toMatch(/keys unavailable/i)
    warnSpy.mockRestore()
  })

  it('shows the fail placeholder when E2EE returns ready but no local keys', async () => {
    mockIsReady.mockReturnValue(true)
    mockGetKeys.mockReturnValue(null)

    const { result } = renderHook(() =>
      useDecryptedContent('cipher', 'nonce', false, 'channel-1'),
    )
    await waitFor(() => expect(result.current.decrypting).toBe(false))
    expect(result.current.displayContent).toMatch(/keys unavailable/i)
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  it('retries up to 5 times when E2EE is not ready, then fails', async () => {
    vi.useFakeTimers()
    mockIsReady.mockReturnValue(false)

    const { result } = renderHook(() =>
      useDecryptedContent('cipher', 'nonce', false, 'channel-1'),
    )
    expect(result.current.decrypting).toBe(true)

    // 5 retries × 1000ms = 5s; the 6th attempt gives up.
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })

    expect(mockIsReady).toHaveBeenCalled()
    expect(mockIsReady.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(result.current.decrypting).toBe(false)
    expect(result.current.displayContent).toMatch(/keys unavailable/i)
  })

  it('eventually succeeds if E2EE flips ready before the retry budget runs out', async () => {
    vi.useFakeTimers()
    let calls = 0
    mockIsReady.mockImplementation(() => { calls++; return calls >= 3 })
    mockGetKeys.mockReturnValue(FAKE_KEYS)
    mockDecrypt.mockResolvedValue('late-plaintext')

    const { result } = renderHook(() =>
      useDecryptedContent('cipher', 'nonce', false, 'channel-1'),
    )

    // Two retries × 1000ms before isReady returns true on attempt #3.
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    // Drain the resolved promise from decryptChannelMessage.
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(result.current.displayContent).toBe('late-plaintext')
    expect(result.current.decrypting).toBe(false)
  })

  it('resets state synchronously when content/nonce/channelId changes', () => {
    mockIsReady.mockReturnValue(false)
    const { result, rerender } = renderHook(
      ({ content, nonce, channelId }) =>
        useDecryptedContent(content, nonce, false, channelId),
      { initialProps: { content: 'a', nonce: 'n1', channelId: 'c1' as string | undefined } },
    )
    expect(result.current.decrypting).toBe(true)

    rerender({ content: 'a', nonce: null as unknown as string, channelId: 'c1' })
    expect(result.current).toEqual({
      displayContent: 'a',
      isEncrypted: false,
      decrypting: false,
    })

    rerender({ content: 'b', nonce: 'n2', channelId: undefined })
    expect(result.current.displayContent).toMatch(/keys unavailable/i)
    expect(result.current.isEncrypted).toBe(true)
  })
})
