import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  User,
  Server as ApiServer,
  Channel as ApiChannel,
  Category as ApiCategory,
  Member as ApiMember,
  Message as ApiMessage,
  DmChannel,
} from '../api/types'
import {
  hashColor,
  avatarLetter,
  userToAvatar,
  formatTimestamp,
  toMemberStatus,
  transformMessage,
  transformMessages,
  transformServer,
  transformMemberGroup,
  transformDmConversation,
} from './transforms'

// ─── Fixtures ───────────────────────────────────────────────────────

const userFactory = (overrides: Partial<User> = {}): User => ({
  id: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  display_name: null,
  avatar_url: null,
  banner_color: null,
  bio: null,
  status: null,
  is_system: false,
  ...overrides,
})

const messageFactory = (overrides: Partial<ApiMessage> = {}): ApiMessage => ({
  id: 'm1',
  channel_id: 'c1',
  author_id: 'u1',
  content: 'hello',
  nonce: null,
  created_at: '2026-05-03T12:00:00Z',
  updated_at: null,
  is_edited: false,
  is_pinned: false,
  reply_to_id: null,
  attachments: [],
  reactions: [],
  embeds: [],
  ...overrides,
})

// ─── Pure helpers ───────────────────────────────────────────────────

describe('hashColor', () => {
  it('returns OKLCH formatted string with the documented lightness band', () => {
    const c = hashColor('alice')
    expect(c).toMatch(/^oklch\((42|48)% 0\.16 \d+\)$/)
  })

  it('is deterministic for the same input', () => {
    expect(hashColor('alice')).toBe(hashColor('alice'))
  })

  it('produces different colors for different inputs', () => {
    expect(hashColor('alice')).not.toBe(hashColor('bob'))
  })

  it('dims yellows (60–110°) to 42% L for AA contrast against white', () => {
    // Pick an input whose hash falls into the yellow band by exhaustive search.
    let yellowInput: string | null = null
    for (let i = 0; i < 1000 && !yellowInput; i++) {
      const candidate = `seed-${i}`
      const m = hashColor(candidate).match(/oklch\((\d+)% 0\.16 (\d+)\)/)
      if (m && Number(m[2]) >= 60 && Number(m[2]) <= 110) {
        yellowInput = candidate
      }
    }
    expect(yellowInput).not.toBeNull()
    expect(hashColor(yellowInput!)).toMatch(/^oklch\(42% 0\.16 (6\d|7\d|8\d|9\d|10\d|110)\)$/)
  })
})

describe('avatarLetter', () => {
  it('uses display_name first letter when set', () => {
    expect(avatarLetter(userFactory({ display_name: 'Phillippe' }))).toBe('P')
  })

  it('falls back to username when display_name is missing', () => {
    expect(avatarLetter(userFactory({ display_name: null, username: 'bob' }))).toBe('B')
  })

  it('uppercases the letter', () => {
    expect(avatarLetter(userFactory({ display_name: 'lowercase' }))).toBe('L')
  })

  it('returns ? for an empty display name and empty username', () => {
    // displayName() with both fields empty returns '' (the OR short-circuits
    // through both empties), so `displayName(user)?.[0]` is undefined and the
    // `?? '?'` fallback fires.
    expect(avatarLetter(userFactory({ display_name: '', username: '' }))).toBe('?')
  })
})

describe('userToAvatar', () => {
  it('returns null avatarUrl when the user has no avatar_url', () => {
    const out = userToAvatar(userFactory({ avatar_url: null }))
    expect(out.avatarUrl).toBeNull()
    expect(out.color).toMatch(/^oklch/)
    expect(out.letter).toBe('A')
  })

  it('returns the cached avatar endpoint when the user has an avatar_url', () => {
    // The exact base URL depends on the environment (`/api` in prod web,
    // `https://jolkr.app/api` in DEV web, `<server>/api` in Tauri), so the
    // test asserts the path suffix instead of the full URL.
    const out = userToAvatar(userFactory({ id: 'u-42', avatar_url: 'whatever.jpg' }))
    expect(out.avatarUrl).toMatch(/\/api\/avatars\/u-42$/)
  })

  it('prefers user.banner_color over the hashColor fallback', () => {
    // The user's chosen banner color is the source of truth so other
    // clients see the same color the user picked in profile settings.
    const picked = 'oklch(75% 0.16 95)'
    const out = userToAvatar(userFactory({ banner_color: picked }))
    expect(out.color).toBe(picked)
  })

  it('falls back to hashColor when banner_color is null', () => {
    const out = userToAvatar(userFactory({ id: 'u-99', banner_color: null }))
    expect(out.color).toBe(hashColor('u-99'))
  })
})

describe('formatTimestamp', () => {
  // Lock the clock so "today"/"yesterday" branches are deterministic.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T15:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders today as "Today at <time>"', () => {
    expect(formatTimestamp('2026-05-03T10:15:00Z')).toMatch(/^Today at \d{1,2}:\d{2} (AM|PM)$/)
  })

  it('renders yesterday as "Yesterday at <time>"', () => {
    expect(formatTimestamp('2026-05-02T10:15:00Z')).toMatch(/^Yesterday at \d{1,2}:\d{2} (AM|PM)$/)
  })

  it('renders older dates with a date prefix', () => {
    expect(formatTimestamp('2026-04-30T10:15:00Z')).toMatch(/^[A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d{2} (AM|PM)$/)
  })
})

describe('toMemberStatus', () => {
  it('passes through the four known statuses', () => {
    expect(toMemberStatus('online')).toBe('online')
    expect(toMemberStatus('idle')).toBe('idle')
    expect(toMemberStatus('dnd')).toBe('dnd')
    expect(toMemberStatus('offline')).toBe('offline')
  })

  it('falls back to offline for null / undefined / unknown values', () => {
    expect(toMemberStatus(null)).toBe('offline')
    expect(toMemberStatus(undefined)).toBe('offline')
    expect(toMemberStatus('mystery')).toBe('offline')
  })
})

// ─── Message transform ─────────────────────────────────────────────

describe('transformMessage', () => {
  const author = userFactory({ id: 'u1', display_name: 'Alice' })
  const users = new Map<string, User>([['u1', author]])

  it('uses the author from the users map when available', () => {
    const msg = messageFactory()
    const allMessages = new Map([[msg.id, msg]])
    const vm = transformMessage(msg, users, allMessages)
    expect(vm.author).toBe('Alice')
    expect(vm.letter).toBe('A')
  })

  it('falls back to the embedded `author` field when the user is not in the map', () => {
    const msg = messageFactory({ author: userFactory({ id: 'u2', display_name: 'Bob' }) })
    const allMessages = new Map([[msg.id, msg]])
    const vm = transformMessage(msg, new Map(), allMessages)
    expect(vm.author).toBe('Bob')
  })

  it('marks `continued` true when prev message has the same author', () => {
    const prev = messageFactory({ id: 'm0' })
    const curr = messageFactory({ id: 'm1' })
    const allMessages = new Map([[prev.id, prev], [curr.id, curr]])
    expect(transformMessage(curr, users, allMessages, prev).continued).toBe(true)
  })

  it('marks `continued` false when prev message has a different author', () => {
    const prev = messageFactory({ id: 'm0', author_id: 'u9' })
    const curr = messageFactory({ id: 'm1', author_id: 'u1' })
    const allMessages = new Map([[prev.id, prev], [curr.id, curr]])
    expect(transformMessage(curr, users, allMessages, prev).continued).toBe(false)
  })

  it('builds a replyTo with truncated text for un-encrypted referenced messages', () => {
    const long = 'x'.repeat(150)
    const target = messageFactory({ id: 'm0', content: long })
    const curr = messageFactory({ id: 'm1', reply_to_id: 'm0' })
    const allMessages = new Map([[target.id, target], [curr.id, curr]])
    const vm = transformMessage(curr, users, allMessages)
    expect(vm.replyTo).toBeDefined()
    expect(vm.replyTo?.text.length).toBe(100)
  })

  it('replaces replyTo text with "Encrypted message" when the referenced message has a nonce', () => {
    const target = messageFactory({ id: 'm0', content: 'ciphertext-base64', nonce: 'abc' })
    const curr = messageFactory({ id: 'm1', reply_to_id: 'm0' })
    const allMessages = new Map([[target.id, target], [curr.id, curr]])
    const vm = transformMessage(curr, users, allMessages)
    expect(vm.replyTo?.text).toBe('Encrypted message')
  })

  it('omits replyTo when reply_to_id points at a missing message', () => {
    const curr = messageFactory({ id: 'm1', reply_to_id: 'm-missing' })
    const allMessages = new Map([[curr.id, curr]])
    expect(transformMessage(curr, users, allMessages).replyTo).toBeUndefined()
  })

  it('passes through reactions from API to UI shape', () => {
    const msg = messageFactory({
      reactions: [{ emoji: '👍', count: 3, me: true, user_ids: ['u1', 'u2', 'u3'] }],
    })
    const allMessages = new Map([[msg.id, msg]])
    const vm = transformMessage(msg, users, allMessages)
    expect(vm.reactions).toEqual([{ emoji: '👍', count: 3, me: true, userIds: ['u1', 'u2', 'u3'] }])
  })

  it('defaults reaction.me to false when undefined (wire-DTO without the field)', () => {
    const msg = messageFactory({
      reactions: [{ emoji: '🔥', count: 1, user_ids: ['u9'] }],
    })
    const allMessages = new Map([[msg.id, msg]])
    expect(transformMessage(msg, users, allMessages).reactions[0]?.me).toBe(false)
  })
})

describe('transformMessages', () => {
  const users = new Map([['u1', userFactory({ id: 'u1', display_name: 'Alice' })]])

  it('flags `continued` correctly across the array', () => {
    const msgs = [
      messageFactory({ id: 'a', author_id: 'u1' }),
      messageFactory({ id: 'b', author_id: 'u1' }),
      messageFactory({ id: 'c', author_id: 'u9' }),
    ]
    const out = transformMessages(msgs, users)
    expect(out.map(m => m.continued)).toEqual([false, true, false])
  })

  it('sets isDm: true on every result when the flag is passed', () => {
    const out = transformMessages([messageFactory()], users, true)
    expect(out[0]?.isDm).toBe(true)
  })
})

// ─── Server / Member / Channel transforms ──────────────────────────

describe('transformServer', () => {
  const server: ApiServer = {
    id: 's1',
    name: 'My Server',
    owner_id: 'u1',
    icon_url: null,
    created_at: '2026-01-01T00:00:00Z',
  }
  const channels: ApiChannel[] = [
    { id: 'c1', server_id: 's1', name: 'general', kind: 'text', position: 0, category_id: null },
    { id: 'c2', server_id: 's1', name: 'random',  kind: 'text', position: 1, category_id: 'cat1' },
    { id: 'c3', server_id: 's1', name: 'voice',   kind: 'voice', position: 2, category_id: 'cat1' },
  ]
  const cats: ApiCategory[] = [
    { id: 'cat1', server_id: 's1', name: 'Lounge', position: 0 },
  ]
  const empty = { online: [], offline: [] }

  it('sorts channels by position', () => {
    const out = transformServer(server, channels, cats, empty, 0)
    expect(out.channels.map(c => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('puts uncategorized channels under a synthetic `__uncategorized__` category at the top', () => {
    const out = transformServer(server, channels, cats, empty, 0)
    expect(out.categories[0]?.id).toBe('__uncategorized__')
    expect(out.categories[0]?.channels).toEqual(['c1'])
    expect(out.categories[1]?.id).toBe('cat1')
    expect(out.categories[1]?.channels).toEqual(['c2', 'c3'])
  })

  it('renders the right channel icon per kind', () => {
    const out = transformServer(server, channels, cats, empty, 0)
    expect(out.channels.find(c => c.id === 'c1')?.icon).toBe('#')
    expect(out.channels.find(c => c.id === 'c3')?.icon).toBe('🔊')
  })

  it('aggregates per-channel unread counts on each ChannelDisplay', () => {
    const out = transformServer(server, channels, cats, empty, 5, { c1: 3, c2: 2 })
    expect(out.channels.find(c => c.id === 'c1')?.unread).toBe(3)
    expect(out.channels.find(c => c.id === 'c2')?.unread).toBe(2)
  })

  it('reports server-level unread as a boolean derived from the total count', () => {
    expect(transformServer(server, channels, cats, empty, 0).unread).toBe(false)
    expect(transformServer(server, channels, cats, empty, 7).unread).toBe(true)
  })
})

describe('transformMemberGroup', () => {
  const u1 = userFactory({ id: 'u1', username: 'alice' })
  const u2 = userFactory({ id: 'u2', username: 'bob' })
  const users = new Map([['u1', u1], ['u2', u2]])

  it('splits members into online vs offline buckets based on presence', () => {
    const members: ApiMember[] = [
      { id: 'm1', server_id: 's', user_id: 'u1', joined_at: '', user: u1 },
      { id: 'm2', server_id: 's', user_id: 'u2', joined_at: '', user: u2 },
    ]
    const presences = new Map([['u1', 'online']])
    const group = transformMemberGroup(members, users, presences)
    expect(group.online.map(m => m.userId)).toEqual(['u1'])
    expect(group.offline.map(m => m.userId)).toEqual(['u2'])
  })

  it('treats idle / dnd as online (not offline)', () => {
    const members: ApiMember[] = [
      { id: 'm1', server_id: 's', user_id: 'u1', joined_at: '', user: u1 },
      { id: 'm2', server_id: 's', user_id: 'u2', joined_at: '', user: u2 },
    ]
    const presences = new Map([['u1', 'idle'], ['u2', 'dnd']])
    const group = transformMemberGroup(members, users, presences)
    expect(group.online.map(m => m.status).sort()).toEqual(['dnd', 'idle'])
    expect(group.offline.length).toBe(0)
  })

  it('uses the member nickname over the user display name when set', () => {
    const members: ApiMember[] = [
      { id: 'm1', server_id: 's', user_id: 'u1', joined_at: '', user: u1, nickname: 'Boss' },
    ]
    const presences = new Map([['u1', 'online']])
    const group = transformMemberGroup(members, users, presences)
    expect(group.online[0]?.name).toBe('Boss')
  })

  it('skips members whose user record is missing entirely', () => {
    const members: ApiMember[] = [
      { id: 'mX', server_id: 's', user_id: 'u-orphan', joined_at: '' },
    ]
    const group = transformMemberGroup(members, new Map(), new Map())
    expect(group.online).toEqual([])
    expect(group.offline).toEqual([])
  })
})

describe('transformDmConversation', () => {
  const me   = userFactory({ id: 'me', username: 'me' })
  const them = userFactory({ id: 'them', username: 'them' })
  const users = new Map([['me', me], ['them', them]])

  it('excludes the current user from participants', () => {
    const dm: DmChannel = {
      id: 'd1', is_group: false, name: null, members: ['me', 'them'],
      created_at: '2026-01-01T00:00:00Z',
    }
    const out = transformDmConversation(dm, users, new Map([['them', 'online']]), 'me')
    expect(out.participants.map(p => p.userId)).toEqual(['them'])
    expect(out.participants[0]?.status).toBe('online')
  })

  it('marks group conversations with type "group"', () => {
    const dm: DmChannel = {
      id: 'd2', is_group: true, name: 'Mates', members: ['me', 'them'],
      created_at: '2026-01-01T00:00:00Z',
    }
    expect(transformDmConversation(dm, users, new Map(), 'me').type).toBe('group')
  })

  it('falls back to an Unknown placeholder for missing user records', () => {
    const dm: DmChannel = {
      id: 'd3', is_group: false, name: null, members: ['me', 'ghost'],
      created_at: '2026-01-01T00:00:00Z',
    }
    const out = transformDmConversation(dm, users, new Map(), 'me')
    expect(out.participants[0]?.name).toBe('Unknown')
    expect(out.participants[0]?.status).toBe('offline')
  })

  it('passes the unread count through verbatim', () => {
    const dm: DmChannel = {
      id: 'd4', is_group: false, name: null, members: ['me', 'them'],
      created_at: '2026-01-01T00:00:00Z',
    }
    expect(transformDmConversation(dm, users, new Map(), 'me', null, 4).unread).toBe(4)
    expect(transformDmConversation(dm, users, new Map(), 'me').unread).toBe(0)
  })
})
