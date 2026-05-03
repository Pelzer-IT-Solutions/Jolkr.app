import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { User } from '../api/types'
import type { WsListenerEvent } from '../api/ws-events'

// Capture the listener auth.ts registers at module-load time so each test
// can fire WS events through it.
let wsListener: ((event: WsListenerEvent) => void) | undefined
const mockWsConnect = vi.fn()
const mockWsDisconnect = vi.fn()

vi.mock('../api/ws', () => ({
  wsClient: {
    connect: mockWsConnect,
    disconnect: mockWsDisconnect,
    on: vi.fn((listener: (event: WsListenerEvent) => void) => {
      wsListener = listener
      return () => { wsListener = undefined }
    }),
  },
}))

const mockApi = {
  login: vi.fn(),
  register: vi.fn(),
  getMe: vi.fn(),
  updateMe: vi.fn(),
  getAccessToken: vi.fn(),
  clearTokens: vi.fn(),
}
vi.mock('../api/client', () => mockApi)

const mockResetE2EE = vi.fn()
vi.mock('../services/e2ee', () => ({
  resetE2EE: mockResetE2EE,
}))

const mockLeaveChannel = vi.fn()
vi.mock('./voice', () => ({
  useVoiceStore: {
    getState: () => ({ leaveChannel: mockLeaveChannel }),
  },
}))

const mockResetAllStores = vi.fn()
vi.mock('./reset', () => ({
  resetAllStores: mockResetAllStores,
}))

const mockToastShow = vi.fn()
vi.mock('./toast', () => ({
  useToast: {
    getState: () => ({ show: mockToastShow }),
  },
}))

const { useAuthStore } = await import('./auth')

const SAMPLE_USER: User = {
  id: 'user-1',
  email: 'a@b.c',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: null,
  bio: null,
  status: 'online',
  banner_color: null,
  email_verified: true,
  show_read_receipts: true,
  dm_filter: 'all',
  allow_friend_requests: true,
} as unknown as User

beforeEach(() => {
  useAuthStore.setState({ user: null, loading: false, error: null })
  mockApi.login.mockReset()
  mockApi.register.mockReset()
  mockApi.getMe.mockReset()
  mockApi.updateMe.mockReset()
  mockApi.getAccessToken.mockReset()
  mockApi.clearTokens.mockReset()
  mockWsConnect.mockReset()
  mockWsDisconnect.mockReset()
  mockResetE2EE.mockReset()
  mockResetE2EE.mockResolvedValue(undefined)
  mockLeaveChannel.mockReset()
  mockLeaveChannel.mockResolvedValue(undefined)
  mockResetAllStores.mockReset()
  mockToastShow.mockReset()
})

describe('useAuthStore.login', () => {
  it('on success: stores user, clears loading, connects WS', async () => {
    mockApi.login.mockResolvedValue(undefined)
    mockApi.getMe.mockResolvedValue(SAMPLE_USER)
    await useAuthStore.getState().login('a@b.c', 'pw')

    expect(useAuthStore.getState().user).toBe(SAMPLE_USER)
    expect(useAuthStore.getState().loading).toBe(false)
    expect(useAuthStore.getState().error).toBeNull()
    expect(mockWsConnect).toHaveBeenCalledTimes(1)
  })

  it('on failure: stores error, clears loading, rethrows', async () => {
    const err = new Error('bad creds')
    mockApi.login.mockRejectedValue(err)

    await expect(useAuthStore.getState().login('a', 'b')).rejects.toThrow('bad creds')
    expect(useAuthStore.getState().error).toBe('bad creds')
    expect(useAuthStore.getState().loading).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
    expect(mockWsConnect).not.toHaveBeenCalled()
  })
})

describe('useAuthStore.register', () => {
  it('connects WS only when the registered user is email-verified', async () => {
    mockApi.register.mockResolvedValue(undefined)
    mockApi.getMe.mockResolvedValue({ ...SAMPLE_USER, email_verified: true })
    await useAuthStore.getState().register('a@b.c', 'alice', 'pw')
    expect(mockWsConnect).toHaveBeenCalledTimes(1)
  })

  it('does NOT connect WS for unverified registrations', async () => {
    mockApi.register.mockResolvedValue(undefined)
    mockApi.getMe.mockResolvedValue({ ...SAMPLE_USER, email_verified: false })
    await useAuthStore.getState().register('a@b.c', 'alice', 'pw')
    expect(mockWsConnect).not.toHaveBeenCalled()
  })
})

describe('useAuthStore.loadUser', () => {
  it('no-ops when there is no access token', async () => {
    mockApi.getAccessToken.mockReturnValue(null)
    await useAuthStore.getState().loadUser()
    expect(mockApi.getMe).not.toHaveBeenCalled()
  })

  it('loads user and connects WS when verified', async () => {
    mockApi.getAccessToken.mockReturnValue('tok')
    mockApi.getMe.mockResolvedValue(SAMPLE_USER)
    await useAuthStore.getState().loadUser()
    expect(useAuthStore.getState().user).toBe(SAMPLE_USER)
    expect(mockWsConnect).toHaveBeenCalledTimes(1)
  })

  it('on 401: clears tokens, sets user to null', async () => {
    mockApi.getAccessToken.mockReturnValue('tok')
    const err = Object.assign(new Error('unauth'), { status: 401 })
    mockApi.getMe.mockRejectedValue(err)
    await useAuthStore.getState().loadUser()
    expect(mockApi.clearTokens).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('on transient (non-401) failure: keeps tokens, still nulls user', async () => {
    mockApi.getAccessToken.mockReturnValue('tok')
    mockApi.getMe.mockRejectedValue(new Error('network'))
    await useAuthStore.getState().loadUser()
    expect(mockApi.clearTokens).not.toHaveBeenCalled()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('useAuthStore.updateProfile', () => {
  it('replaces user with the API response', async () => {
    const next = { ...SAMPLE_USER, display_name: 'Alice2' } as User
    mockApi.updateMe.mockResolvedValue(next)
    await useAuthStore.getState().updateProfile({ display_name: 'Alice2' })
    expect(useAuthStore.getState().user).toBe(next)
  })
})

describe('useAuthStore.applyUserUpdate', () => {
  it('no-ops when there is no user logged in', () => {
    useAuthStore.getState().applyUserUpdate({ status: 'idle' })
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('applies only the present fields and leaves the rest untouched', () => {
    useAuthStore.setState({ user: SAMPLE_USER })
    useAuthStore.getState().applyUserUpdate({ status: 'idle' })
    const u = useAuthStore.getState().user
    expect(u?.status).toBe('idle')
    expect(u?.display_name).toBe(SAMPLE_USER.display_name)
    expect(u?.bio).toBe(SAMPLE_USER.bio)
  })
})

describe('useAuthStore.logout', () => {
  it('runs the full teardown sequence: voice → ws → tokens → e2ee → reset → state', async () => {
    useAuthStore.setState({ user: SAMPLE_USER, error: 'x' })
    await useAuthStore.getState().logout()

    expect(mockLeaveChannel).toHaveBeenCalledTimes(1)
    expect(mockWsDisconnect).toHaveBeenCalledTimes(1)
    expect(mockApi.clearTokens).toHaveBeenCalledTimes(1)
    expect(mockResetE2EE).toHaveBeenCalledTimes(1)
    expect(mockResetAllStores).toHaveBeenCalledTimes(1)
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().error).toBeNull()
    expect(mockToastShow).not.toHaveBeenCalled()
  })

  it('surfaces a toast when resetE2EE fails (security-critical)', async () => {
    useAuthStore.setState({ user: SAMPLE_USER })
    mockResetE2EE.mockRejectedValue(new Error('idb locked'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await useAuthStore.getState().logout()

    expect(mockToastShow).toHaveBeenCalledTimes(1)
    expect(mockToastShow.mock.calls[0]?.[0]).toMatch(/encryption keys/i)
    // Even on E2EE failure, state must still be cleared so a fresh login
    // doesn't see the stale user.
    expect(useAuthStore.getState().user).toBeNull()
    errSpy.mockRestore()
  })

  it('does not throw when leaveChannel fails (best-effort)', async () => {
    useAuthStore.setState({ user: SAMPLE_USER })
    mockLeaveChannel.mockRejectedValue(new Error('voice gone'))
    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined()
  })
})

describe('WS event integration', () => {
  it('UserUpdate for the current user → applyUserUpdate', () => {
    useAuthStore.setState({ user: SAMPLE_USER })
    expect(wsListener).toBeDefined()
    wsListener!({ op: 'UserUpdate', d: { user_id: SAMPLE_USER.id, status: 'idle' } } as WsListenerEvent)
    expect(useAuthStore.getState().user?.status).toBe('idle')
  })

  it('UserUpdate for a different user is ignored', () => {
    useAuthStore.setState({ user: SAMPLE_USER })
    wsListener!({ op: 'UserUpdate', d: { user_id: 'other', status: 'idle' } } as WsListenerEvent)
    expect(useAuthStore.getState().user?.status).toBe('online')
  })

  it('UserUpdate with no logged-in user is ignored', () => {
    useAuthStore.setState({ user: null })
    wsListener!({ op: 'UserUpdate', d: { user_id: SAMPLE_USER.id, status: 'idle' } } as WsListenerEvent)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('EmailVerified triggers loadUser (best-effort, swallows errors)', async () => {
    mockApi.getAccessToken.mockReturnValue('tok')
    mockApi.getMe.mockResolvedValue({ ...SAMPLE_USER, email_verified: true })
    wsListener!({ op: 'EmailVerified', d: { user_id: SAMPLE_USER.id } } as WsListenerEvent)
    // Drain the microtask queue
    await Promise.resolve()
    await Promise.resolve()
    expect(mockApi.getMe).toHaveBeenCalled()
  })
})
