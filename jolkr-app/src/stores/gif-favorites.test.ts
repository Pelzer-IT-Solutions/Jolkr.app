import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the network layer so the store can be imported without hitting the
// real API client. The pure paths under test (`applyServerEvent`,
// `extractGiphyId`) don't trigger these, but `load`/`toggle` would.
vi.mock('../api/client', () => ({
  getGifFavorites:    vi.fn(),
  addGifFavorite:     vi.fn(),
  removeGifFavorite:  vi.fn(),
}))

const { useGifFavoritesStore, extractGiphyId } = await import('./gif-favorites')

beforeEach(() => {
  useGifFavoritesStore.setState({ ids: new Set(), loaded: false })
})

describe('useGifFavoritesStore.applyServerEvent (added)', () => {
  it('adds a new favorite from a server event', () => {
    useGifFavoritesStore.getState().applyServerEvent({ added: { gif_id: 'g1' } })
    expect(useGifFavoritesStore.getState().ids.has('g1')).toBe(true)
  })

  it('is idempotent when the favorite is already present', () => {
    useGifFavoritesStore.setState({ ids: new Set(['g1']), loaded: true })
    const before = useGifFavoritesStore.getState().ids
    useGifFavoritesStore.getState().applyServerEvent({ added: { gif_id: 'g1' } })
    expect(useGifFavoritesStore.getState().ids).toBe(before)
  })
})

describe('useGifFavoritesStore.applyServerEvent (removed)', () => {
  it('removes a favorite from a server event', () => {
    useGifFavoritesStore.setState({ ids: new Set(['g1', 'g2']), loaded: true })
    useGifFavoritesStore.getState().applyServerEvent({ removed_gif_id: 'g1' })
    const ids = useGifFavoritesStore.getState().ids
    expect(ids.has('g1')).toBe(false)
    expect(ids.has('g2')).toBe(true)
  })

  it('is idempotent when the favorite is not present', () => {
    useGifFavoritesStore.setState({ ids: new Set(['g1']), loaded: true })
    const before = useGifFavoritesStore.getState().ids
    useGifFavoritesStore.getState().applyServerEvent({ removed_gif_id: 'g-missing' })
    expect(useGifFavoritesStore.getState().ids).toBe(before)
  })
})

describe('extractGiphyId', () => {
  it('parses the clean proxy URL format /api/gifs/i/{id}/{size}', () => {
    expect(extractGiphyId('/api/gifs/i/abc123/small')).toBe('abc123')
    expect(extractGiphyId('/api/gifs/i/SOMElongID/large')).toBe('SOMElongID')
  })

  it('parses the legacy /api/gifs/media?url=... format', () => {
    const url = '/api/gifs/media?url=' + encodeURIComponent('https://media.giphy.com/some/path/giphyid12/200.gif')
    expect(extractGiphyId(url)).toBe('giphyid12')
  })

  it('returns null for unrelated URLs', () => {
    expect(extractGiphyId('/api/avatars/u-1')).toBeNull()
    expect(extractGiphyId('https://example.com/random.png')).toBeNull()
  })

  it('returns null when the legacy URL has no recognisable id segment', () => {
    const url = '/api/gifs/media?url=' + encodeURIComponent('https://media.giphy.com/x/y/z/200.gif')
    expect(extractGiphyId(url)).toBeNull()
  })
})
