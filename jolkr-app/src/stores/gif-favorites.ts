import { create } from 'zustand'
import { getGifFavorites, addGifFavorite, removeGifFavorite } from '../api/client'

interface GifFavoritesState {
  ids: Set<string>
  loaded: boolean
  load: () => Promise<void>
  toggle: (gifId: string) => void
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

  toggle: (gifId: string) => {
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
      addGifFavorite(gifId).catch(() => {
        const reverted = new Set(get().ids)
        reverted.delete(gifId)
        set({ ids: reverted })
      })
    }
  },
}))

/** Extract GIF ID from a clean proxy URL like /api/gifs/i/{gif_id}/small
 * Also supports legacy format /api/gifs/media?url=...
 */
export function extractGiphyId(src: string): string | null {
  // New clean format: /api/gifs/i/{gif_id}/{size}
  const cleanMatch = src.match(/\/api\/gifs\/i\/([^/]+)\//)
  if (cleanMatch) return cleanMatch[1]

  // Legacy format: /api/gifs/media?url=...
  const legacyMatch = src.match(/\/api\/gifs\/media\?url=(.+)/)
  if (!legacyMatch) return null
  try {
    const decoded = decodeURIComponent(legacyMatch[1])
    const segments = decoded.split('/')
    for (let i = segments.length - 2; i >= 0; i--) {
      const seg = segments[i]
      if (seg && /^[a-zA-Z0-9]{5,30}$/.test(seg)) return seg
    }
    return null
  } catch {
    return null
  }
}
