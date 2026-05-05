import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WsListenerEvent } from '../api/ws-events'
import type { Server, Channel, Category, Role, Member } from '../api/types'

let wsListener: ((event: WsListenerEvent) => void) | undefined

vi.mock('../api/ws', () => ({
  wsClient: {
    on: vi.fn((listener: (event: WsListenerEvent) => void) => {
      wsListener = listener
      return () => { wsListener = undefined }
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}))

const mockApi = {
  getServers: vi.fn(),
  getChannels: vi.fn(),
  getMembersWithRoles: vi.fn(),
  getCategories: vi.fn(),
  getRoles: vi.fn(),
  getMyPermissions: vi.fn(),
  getMyChannelPermissions: vi.fn(),
  getServerEmojis: vi.fn(),
  createServer: vi.fn(),
  createChannel: vi.fn(),
  updateServer: vi.fn(),
  updateChannel: vi.fn(),
  deleteServer: vi.fn(),
  deleteChannel: vi.fn(),
  reorderChannels: vi.fn(),
  reorderServers: vi.fn(),
  leaveServer: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}
vi.mock('../api/client', () => mockApi)

const authState: { user: { id: string } | null } = { user: { id: 'me' } }
vi.mock('./auth', () => ({
  useAuthStore: {
    getState: () => authState,
  },
}))

const { useServersStore } = await import('./servers')

const SERVER_A: Server = { id: 'srv-a', name: 'A', owner_id: 'me' } as unknown as Server
const SERVER_B: Server = { id: 'srv-b', name: 'B', owner_id: 'me' } as unknown as Server
const CH_1: Channel = { id: 'ch-1', server_id: 'srv-a', name: 'general', kind: 'text', position: 0 } as unknown as Channel
const CH_2: Channel = { id: 'ch-2', server_id: 'srv-a', name: 'voice', kind: 'voice', position: 1 } as unknown as Channel

beforeEach(() => {
  useServersStore.getState().reset()
  authState.user = { id: 'me' }
  for (const fn of Object.values(mockApi)) fn.mockReset()
})

describe('useServersStore.fetchServers', () => {
  it('replaces servers with the API response', async () => {
    mockApi.getServers.mockResolvedValue([SERVER_A, SERVER_B])
    await useServersStore.getState().fetchServers()
    expect(useServersStore.getState().servers).toEqual([SERVER_A, SERVER_B])
    expect(useServersStore.getState().loading).toBe(false)
  })

  it('shows loading=true on initial fetch and clears on failure', async () => {
    mockApi.getServers.mockRejectedValue(new Error('500'))
    const promise = useServersStore.getState().fetchServers()
    expect(useServersStore.getState().loading).toBe(true)
    await promise
    expect(useServersStore.getState().loading).toBe(false)
  })
})

describe('useServersStore.fetchChannels', () => {
  it('always refetches even when cached so server-switch sees fresh data', async () => {
    useServersStore.setState({ channels: { 'srv-a': [CH_1] } })
    mockApi.getChannels.mockResolvedValue([CH_1, CH_2])
    await useServersStore.getState().fetchChannels('srv-a')
    expect(mockApi.getChannels).toHaveBeenCalledTimes(1)
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_1, CH_2])
  })

  it('fetches and caches when no entry exists', async () => {
    mockApi.getChannels.mockResolvedValue([CH_1, CH_2])
    await useServersStore.getState().fetchChannels('srv-a')
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_1, CH_2])
  })
})

describe('useServersStore CRUD', () => {
  it('createServer appends to the servers list', async () => {
    mockApi.createServer.mockResolvedValue(SERVER_A)
    const result = await useServersStore.getState().createServer('A')
    expect(result).toBe(SERVER_A)
    expect(useServersStore.getState().servers).toEqual([SERVER_A])
  })

  it('createChannel appends and dedupes by id', async () => {
    useServersStore.setState({ servers: [SERVER_A], channels: { 'srv-a': [CH_1] } })
    mockApi.createChannel.mockResolvedValue(CH_2)
    await useServersStore.getState().createChannel('srv-a', 'voice', 'voice')
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_1, CH_2])

    // Second create with same id is a no-op
    mockApi.createChannel.mockResolvedValue(CH_2)
    await useServersStore.getState().createChannel('srv-a', 'voice', 'voice')
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_1, CH_2])
  })

  it('updateServer replaces by id', async () => {
    useServersStore.setState({ servers: [SERVER_A, SERVER_B] })
    const updated = { ...SERVER_A, name: 'A2' }
    mockApi.updateServer.mockResolvedValue(updated)
    await useServersStore.getState().updateServer('srv-a', { name: 'A2' })
    expect(useServersStore.getState().servers).toEqual([updated, SERVER_B])
  })

  it('deleteServer removes from the servers list', async () => {
    useServersStore.setState({ servers: [SERVER_A, SERVER_B] })
    mockApi.deleteServer.mockResolvedValue(undefined)
    await useServersStore.getState().deleteServer('srv-a')
    expect(useServersStore.getState().servers).toEqual([SERVER_B])
  })

  it('deleteChannel removes from the channels map for that server', async () => {
    useServersStore.setState({ channels: { 'srv-a': [CH_1, CH_2] } })
    mockApi.deleteChannel.mockResolvedValue(undefined)
    await useServersStore.getState().deleteChannel('ch-1', 'srv-a')
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_2])
  })
})

describe('useServersStore.reorderChannels — optimistic + revert', () => {
  it('applies new positions immediately (optimistic) and accepts server response', async () => {
    useServersStore.setState({ channels: { 'srv-a': [CH_1, CH_2] } })
    const reordered = [{ ...CH_2, position: 0 }, { ...CH_1, position: 1 }]
    mockApi.reorderChannels.mockResolvedValue(reordered)
    await useServersStore.getState().reorderChannels('srv-a', [
      { id: 'ch-2', position: 0 },
      { id: 'ch-1', position: 1 },
    ])
    expect(useServersStore.getState().channels['srv-a']).toEqual(reordered)
  })

  it('reverts to the original ordering when the API rejects', async () => {
    useServersStore.setState({ channels: { 'srv-a': [CH_1, CH_2] } })
    mockApi.reorderChannels.mockRejectedValue(new Error('boom'))
    await useServersStore.getState().reorderChannels('srv-a', [
      { id: 'ch-2', position: 0 },
      { id: 'ch-1', position: 1 },
    ])
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_1, CH_2])
  })
})

describe('useServersStore.leaveServer — cascade cleanup', () => {
  it('removes server + channels + members + categories + roles + permissions in one shot', async () => {
    useServersStore.setState({
      servers: [SERVER_A, SERVER_B],
      channels: { 'srv-a': [CH_1] },
      members: { 'srv-a': [] as Member[] },
      categories: { 'srv-a': [] as Category[] },
      roles: { 'srv-a': [] as Role[] },
      permissions: { 'srv-a': 7 },
      channelPermissions: { 'ch-1': 3 },
    })
    mockApi.leaveServer.mockResolvedValue(undefined)
    await useServersStore.getState().leaveServer('srv-a')

    const s = useServersStore.getState()
    expect(s.servers).toEqual([SERVER_B])
    expect(s.channels['srv-a']).toBeUndefined()
    expect(s.members['srv-a']).toBeUndefined()
    expect(s.categories['srv-a']).toBeUndefined()
    expect(s.roles['srv-a']).toBeUndefined()
    expect(s.permissions['srv-a']).toBeUndefined()
    expect(s.channelPermissions['ch-1']).toBeUndefined()
  })
})

describe('useServersStore WS events', () => {
  it('ChannelCreate appends the new channel to the right server', () => {
    useServersStore.setState({ servers: [SERVER_A], channels: { 'srv-a': [CH_1] } })
    expect(wsListener).toBeDefined()
    wsListener!({ op: 'ChannelCreate', d: { channel: CH_2 } } as unknown as WsListenerEvent)
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_1, CH_2])
  })

  it('ChannelCreate is a no-op for a server we do not belong to', () => {
    useServersStore.setState({ servers: [SERVER_A], channels: { 'srv-a': [CH_1] } })
    const stranger = { ...CH_2, server_id: 'srv-foreign' } as Channel
    wsListener!({ op: 'ChannelCreate', d: { channel: stranger } } as unknown as WsListenerEvent)
    expect(useServersStore.getState().channels['srv-foreign']).toBeUndefined()
  })

  it('ChannelDelete removes the channel from the cache', () => {
    useServersStore.setState({ servers: [SERVER_A], channels: { 'srv-a': [CH_1, CH_2] } })
    wsListener!({ op: 'ChannelDelete', d: { channel_id: 'ch-1', server_id: 'srv-a' } } as unknown as WsListenerEvent)
    expect(useServersStore.getState().channels['srv-a']).toEqual([CH_2])
  })

  it('ServerDelete cascade-removes server + dependent caches', () => {
    useServersStore.setState({
      servers: [SERVER_A, SERVER_B],
      channels: { 'srv-a': [CH_1] },
      permissions: { 'srv-a': 1, 'srv-b': 2 },
    })
    wsListener!({ op: 'ServerDelete', d: { server_id: 'srv-a' } } as unknown as WsListenerEvent)
    const s = useServersStore.getState()
    expect(s.servers).toEqual([SERVER_B])
    expect(s.channels['srv-a']).toBeUndefined()
    expect(s.permissions['srv-a']).toBeUndefined()
    expect(s.permissions['srv-b']).toBe(2)
  })

  it('MemberLeave removes the member from the server cache', () => {
    const m1 = { user_id: 'me', role_ids: [] } as unknown as Member
    const m2 = { user_id: 'other', role_ids: [] } as unknown as Member
    useServersStore.setState({ servers: [SERVER_A], members: { 'srv-a': [m1, m2] } })
    wsListener!({ op: 'MemberLeave', d: { server_id: 'srv-a', user_id: 'other' } } as unknown as WsListenerEvent)
    expect(useServersStore.getState().members['srv-a']).toEqual([m1])
  })

  it('MemberUpdate role_ids for SELF invalidates permission caches', () => {
    const m1 = { user_id: 'me', role_ids: ['role-old'] } as unknown as Member
    useServersStore.setState({
      servers: [SERVER_A],
      members: { 'srv-a': [m1] },
      channels: { 'srv-a': [CH_1] },
      permissions: { 'srv-a': 7 },
      channelPermissions: { 'ch-1': 3 },
    })
    wsListener!({
      op: 'MemberUpdate',
      d: { server_id: 'srv-a', user_id: 'me', role_ids: ['role-new'] },
    } as unknown as WsListenerEvent)

    const s = useServersStore.getState()
    expect(s.members['srv-a']?.[0]?.role_ids).toEqual(['role-new'])
    expect(s.permissions['srv-a']).toBeUndefined()
    expect(s.channelPermissions['ch-1']).toBeUndefined()
  })

  it('MemberUpdate role_ids for SOMEONE ELSE keeps our permission caches', () => {
    const m1 = { user_id: 'other', role_ids: [] } as unknown as Member
    useServersStore.setState({
      servers: [SERVER_A],
      members: { 'srv-a': [m1] },
      permissions: { 'srv-a': 7 },
      channelPermissions: { 'ch-1': 3 },
    })
    wsListener!({
      op: 'MemberUpdate',
      d: { server_id: 'srv-a', user_id: 'other', role_ids: ['role-x'] },
    } as unknown as WsListenerEvent)

    const s = useServersStore.getState()
    expect(s.permissions['srv-a']).toBe(7)
    expect(s.channelPermissions['ch-1']).toBe(3)
  })

  it('MemberJoin for SELF on an unknown server triggers fetchServers', () => {
    useServersStore.setState({ servers: [] })
    mockApi.getServers.mockResolvedValue([SERVER_A])
    wsListener!({ op: 'MemberJoin', d: { server_id: 'srv-a', user_id: 'me' } } as unknown as WsListenerEvent)
    expect(mockApi.getServers).toHaveBeenCalledTimes(1)
  })
})
