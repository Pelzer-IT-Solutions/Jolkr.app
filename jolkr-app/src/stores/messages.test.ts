import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Message } from '../api/types'
import type { WsListenerEvent } from '../api/ws-events'

let wsListener: ((event: WsListenerEvent) => void) | undefined

vi.mock('../api/ws', () => ({
  wsClient: {
    on: vi.fn((listener: (event: WsListenerEvent) => void) => {
      wsListener = listener
      return () => { wsListener = undefined }
    }),
  },
}))

const mockApi = {
  getMessages: vi.fn(),
  getDmMessages: vi.fn(),
  sendMessage: vi.fn(),
  sendDmMessage: vi.fn(),
  editMessage: vi.fn(),
  editDmMessage: vi.fn(),
  deleteMessage: vi.fn(),
  deleteDmMessage: vi.fn(),
  getThreadMessages: vi.fn(),
  sendThreadMessage: vi.fn(),
}
vi.mock('../api/client', () => mockApi)

const authState: { user: { id: string } | null } = { user: { id: 'me' } }
vi.mock('./auth', () => ({
  useAuthStore: {
    getState: () => authState,
  },
}))

const { useMessagesStore } = await import('./messages')

function makeMsg(over: Partial<Message> & { id: string; channel_id: string }): Message {
  return {
    author_id: 'me',
    content: '',
    nonce: null,
    created_at: '2026-05-03T00:00:00Z',
    updated_at: null,
    is_edited: false,
    is_pinned: false,
    reply_to_id: null,
    thread_id: null,
    thread_reply_count: null,
    attachments: [],
    reactions: [],
    embeds: [],
    ...over,
  } as unknown as Message
}

beforeEach(() => {
  useMessagesStore.getState().reset()
  authState.user = { id: 'me' }
  for (const fn of Object.values(mockApi)) fn.mockReset()
})

describe('useMessagesStore — synchronous helpers', () => {
  it('addMessage appends and dedupes by id', () => {
    const m1 = makeMsg({ id: 'm1', channel_id: 'c1' })
    useMessagesStore.getState().addMessage('c1', m1)
    useMessagesStore.getState().addMessage('c1', m1)
    expect(useMessagesStore.getState().messages['c1']).toEqual([m1])
  })

  it('updateMessage preserves existing reactions when patch lacks them', () => {
    const reactions = [{ emoji: '👍', count: 1, me: true, user_ids: ['me'] }]
    const m1 = makeMsg({ id: 'm1', channel_id: 'c1', reactions })
    useMessagesStore.setState({ messages: { c1: [m1] } })
    const patch = makeMsg({ id: 'm1', channel_id: 'c1', content: 'edited' })
    delete (patch as { reactions?: unknown }).reactions
    useMessagesStore.getState().updateMessage('c1', patch as Message)
    const result = useMessagesStore.getState().messages['c1']?.[0]
    expect(result?.content).toBe('edited')
    expect(result?.reactions).toEqual(reactions)
  })

  it('removeMessage drops the targeted id', () => {
    const a = makeMsg({ id: 'a', channel_id: 'c1' })
    const b = makeMsg({ id: 'b', channel_id: 'c1' })
    useMessagesStore.setState({ messages: { c1: [a, b] } })
    useMessagesStore.getState().removeMessage('c1', 'a')
    expect(useMessagesStore.getState().messages['c1']).toEqual([b])
  })

  it('updateReactions also propagates into threadMessages', () => {
    const a = makeMsg({ id: 'm1', channel_id: 'c1' })
    const tA = makeMsg({ id: 'm1', channel_id: 'c1', thread_id: 't1' })
    useMessagesStore.setState({
      messages: { c1: [a] },
      threadMessages: { t1: [tA] },
    })
    const reactions = [{ emoji: '🎉', count: 1, me: false, user_ids: ['other'] }]
    useMessagesStore.getState().updateReactions('c1', 'm1', reactions)

    expect(useMessagesStore.getState().messages['c1']?.[0]?.reactions).toEqual(reactions)
    expect(useMessagesStore.getState().threadMessages['t1']?.[0]?.reactions).toEqual(reactions)
  })

  it('clearThreadMessages clears all four thread maps for that thread', () => {
    useMessagesStore.setState({
      threadMessages: { t1: [], t2: [] },
      threadLoading: { t1: true, t2: false },
      threadLoadingOlder: { t1: false, t2: false },
      threadHasMore: { t1: true, t2: false },
    })
    useMessagesStore.getState().clearThreadMessages('t1')
    const s = useMessagesStore.getState()
    expect(s.threadMessages['t1']).toBeUndefined()
    expect(s.threadLoading['t1']).toBeUndefined()
    expect(s.threadLoadingOlder['t1']).toBeUndefined()
    expect(s.threadHasMore['t1']).toBeUndefined()
    expect(s.threadMessages['t2']).toBeDefined()
  })
})

describe('useMessagesStore.fetchMessages', () => {
  it('reverses the API order, derives me from user_ids, sets hasMore', async () => {
    const newer = makeMsg({
      id: 'm2', channel_id: 'c1',
      reactions: [{ emoji: '👍', count: 2, me: false, user_ids: ['me', 'other'] }],
    })
    const older = makeMsg({ id: 'm1', channel_id: 'c1' })
    // API returns newest-first; store stores oldest-first
    mockApi.getMessages.mockResolvedValue([newer, older])
    await useMessagesStore.getState().fetchMessages('c1', false)

    const stored = useMessagesStore.getState().messages['c1'] ?? []
    expect(stored.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(stored[1]?.reactions?.[0]?.me).toBe(true)
    expect(useMessagesStore.getState().hasMore['c1']).toBe(false)
  })

  it('uses getDmMessages when isDm=true', async () => {
    mockApi.getDmMessages.mockResolvedValue([])
    await useMessagesStore.getState().fetchMessages('dm-1', true)
    expect(mockApi.getDmMessages).toHaveBeenCalledWith('dm-1')
    expect(mockApi.getMessages).not.toHaveBeenCalled()
  })

  it('on failure: clears loading without crashing', async () => {
    mockApi.getMessages.mockRejectedValue(new Error('500'))
    await useMessagesStore.getState().fetchMessages('c1', false)
    expect(useMessagesStore.getState().loading['c1']).toBe(false)
  })
})

describe('useMessagesStore.fetchOlder', () => {
  it('short-circuits when there is no cached page yet', async () => {
    await useMessagesStore.getState().fetchOlder('c1', false)
    expect(mockApi.getMessages).not.toHaveBeenCalled()
  })

  it('guards against concurrent calls via loadingOlder', async () => {
    useMessagesStore.setState({
      messages: { c1: [makeMsg({ id: 'm1', channel_id: 'c1' })] },
      loadingOlder: { c1: true },
    })
    await useMessagesStore.getState().fetchOlder('c1', false)
    expect(mockApi.getMessages).not.toHaveBeenCalled()
  })

  it('prepends older messages and sets hasMore based on page size', async () => {
    const m1 = makeMsg({ id: 'm1', channel_id: 'c1', created_at: '2026-05-03T01:00:00Z' })
    useMessagesStore.setState({ messages: { c1: [m1] } })
    const older = makeMsg({ id: 'm0', channel_id: 'c1', created_at: '2026-05-03T00:00:00Z' })
    mockApi.getMessages.mockResolvedValue([older])

    await useMessagesStore.getState().fetchOlder('c1', false)
    expect(useMessagesStore.getState().messages['c1']?.map((m) => m.id)).toEqual(['m0', 'm1'])
    expect(useMessagesStore.getState().hasMore['c1']).toBe(false)
  })
})

describe('useMessagesStore.editMessage / deleteMessage', () => {
  it('editMessage routes through editDmMessage when isDm=true', async () => {
    const updated = makeMsg({ id: 'm1', channel_id: 'dm-1', content: 'edited' })
    mockApi.editDmMessage.mockResolvedValue(updated)
    useMessagesStore.setState({
      messages: { 'dm-1': [makeMsg({ id: 'm1', channel_id: 'dm-1' })] },
    })
    await useMessagesStore.getState().editMessage('m1', 'dm-1', 'edited', true)
    expect(mockApi.editDmMessage).toHaveBeenCalled()
    expect(mockApi.editMessage).not.toHaveBeenCalled()
    expect(useMessagesStore.getState().messages['dm-1']?.[0]?.content).toBe('edited')
  })

  it('deleteMessage routes through deleteDmMessage when isDm=true', async () => {
    mockApi.deleteDmMessage.mockResolvedValue(undefined)
    useMessagesStore.setState({
      messages: { 'dm-1': [makeMsg({ id: 'm1', channel_id: 'dm-1' })] },
    })
    await useMessagesStore.getState().deleteMessage('m1', 'dm-1', true)
    expect(mockApi.deleteDmMessage).toHaveBeenCalled()
    expect(useMessagesStore.getState().messages['dm-1']).toEqual([])
  })
})

describe('useMessagesStore WS events', () => {
  it('MessageCreate (channel) appends to the channel cache', () => {
    expect(wsListener).toBeDefined()
    wsListener!({
      op: 'MessageCreate',
      d: {
        message: {
          id: 'new', channel_id: 'c1', author_id: 'me', content: 'hi',
          created_at: '2026-05-03T00:00:00Z',
        },
      },
    } as unknown as WsListenerEvent)
    expect(useMessagesStore.getState().messages['c1']?.[0]?.id).toBe('new')
  })

  it('MessageCreate (thread) routes to thread store + bumps starter thread_reply_count', () => {
    const starter = makeMsg({ id: 'starter', channel_id: 'c1', thread_id: 't1', thread_reply_count: 2 })
    useMessagesStore.setState({ messages: { c1: [starter] } })

    wsListener!({
      op: 'MessageCreate',
      d: {
        message: {
          id: 'reply', channel_id: 'c1', thread_id: 't1', author_id: 'me', content: 'rep',
          created_at: '2026-05-03T00:00:00Z',
        },
      },
    } as unknown as WsListenerEvent)

    expect(useMessagesStore.getState().threadMessages['t1']?.[0]?.id).toBe('reply')
    expect(useMessagesStore.getState().messages['c1']?.[0]?.thread_reply_count).toBe(3)
  })

  it('MessageDelete decrements thread_reply_count when the deleted msg was a thread reply', () => {
    const starter = makeMsg({ id: 'starter', channel_id: 'c1', thread_id: 't1', thread_reply_count: 5 })
    const reply = makeMsg({ id: 'reply', channel_id: 'c1', thread_id: 't1' })
    useMessagesStore.setState({
      messages: { c1: [starter] },
      threadMessages: { t1: [reply] },
    })
    wsListener!({
      op: 'MessageDelete',
      d: { channel_id: 'c1', message_id: 'reply' },
    } as unknown as WsListenerEvent)

    expect(useMessagesStore.getState().threadMessages['t1']).toEqual([])
    expect(useMessagesStore.getState().messages['c1']?.[0]?.thread_reply_count).toBe(4)
  })

  it('ThreadCreate bumps the threadListVersion counter', () => {
    const before = useMessagesStore.getState().threadListVersion
    wsListener!({ op: 'ThreadCreate', d: { thread: {} } } as unknown as WsListenerEvent)
    expect(useMessagesStore.getState().threadListVersion).toBe(before + 1)
  })

  it('ReactionUpdate derives me from user_ids using the current user', () => {
    useMessagesStore.setState({
      messages: { c1: [makeMsg({ id: 'm1', channel_id: 'c1' })] },
    })
    wsListener!({
      op: 'ReactionUpdate',
      d: {
        channel_id: 'c1',
        message_id: 'm1',
        reactions: [{ emoji: '👍', count: 2, user_ids: ['me', 'other'] }],
      },
    } as unknown as WsListenerEvent)
    expect(useMessagesStore.getState().messages['c1']?.[0]?.reactions?.[0]?.me).toBe(true)
  })

  it('PollUpdate replaces the poll on the targeted message', () => {
    useMessagesStore.setState({
      messages: { c1: [makeMsg({ id: 'm1', channel_id: 'c1' })] },
    })
    const poll = { question: 'Yes?', options: [] } as unknown
    wsListener!({
      op: 'PollUpdate',
      d: { poll, channel_id: 'c1', message_id: 'm1' },
    } as unknown as WsListenerEvent)
    expect(useMessagesStore.getState().messages['c1']?.[0]).toMatchObject({ poll })
  })
})
