import { create } from 'zustand'
import { getGifFavorites, addGifFavorite, removeGifFavorite } from '../api/client'

interface GifFavoritesState {
  ids: Set<string>
  loaded: boolean
  load: () => Promise<void>
  toggle: (gifId: string, extra?: { gif_url?: string; preview_url?: string; title?: string }) => void
}

export const useGifFavoritesStore = create<GifFavoritesState>((set, get) => ({
  ids: new Set<string>(),
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const favs = await getGifFavorites()
      set({ ids: new Set(favs.map((f) => f.gif_id)), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  toggle: (gifId: string, extra?: { gif_url?: string; preview_url?: string; title?: string }) => {
    const { ids } = get()
    const isFav = ids.has(gifId)
    const next = new Set(ids)

    if (isFav) {
      next.delete(gifId)
      set({ ids: next })
      removeGifFavorite(gifId).catch(() => {
        set({ ids: new Set(get().ids).add(gifId) })
      })
    } else {
      next.add(gifId)
      set({ ids: next })
      addGifFavorite({ gif_id: gifId, ...extra }).catch(() => {
        const reverted = new Set(get().ids)
        reverted.delete(gifId)
        set({ ids: reverted })
      })
    }
  },
}))

/** Extract GIPHY ID from a proxy URL like /api/gifs/media?url=https%3A%2F%2Fmedia1.giphy.com%2Fmedia%2F...%2F{ID}%2Fgiphy.gif
 * New GIPHY URL format: .../media/v1.Y2lk.../{shortID}/giphy.gif
 * Old GIPHY URL format: .../media/{shortID}/giphy.gif
 * The short ID is always the segment right before the filename (giphy.gif, 200w.gif, etc.)
 */
export function extractGiphyId(src: string): string | null {
  const match = src.match(/\/api\/gifs\/media\?url=(.+)/)
  if (!match) return null
  try {
    const decoded = decodeURIComponent(match[1])
    // Split the path and find the short alphanumeric ID (not the v1.Y2lk... token)
    const segments = decoded.split('/')
    // Walk backwards: last segment is filename, the one before it is the short ID
    for (let i = segments.length - 2; i >= 0; i--) {
      const seg = segments[i]
      // Short GIPHY IDs are alphanumeric, typically 10-20 chars, never start with "v1."
      if (seg && /^[a-zA-Z0-9]{5,30}$/.test(seg)) {
        return seg
      }
    }
    return null
  } catch {
    return null
  }
}
