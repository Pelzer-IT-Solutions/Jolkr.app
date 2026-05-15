import { create } from 'zustand'
import { getGifFavorites, addGifFavorite, removeGifFavorite } from '../api/client'
import type { GifFavorite } from '../api/types'

interface GifFavoritesState {
  ids: Set<string>
  isLoaded: boolean
  load: () => Promise<void>
  /** Replace the local set with server-loaded favorites. Used by components
   *  that already own the full GifFavorite[] (e.g. GifPicker shows the
   *  thumbnails) — they call this instead of writing to the store directly. */
  applyFavorites: (favs: GifFavorite[]) => void
  toggle: (gifId: string) => void
  /** Apply a server-pushed favorite change from another session.
   *  Idempotent: a no-op if the local set already reflects the change
   *  (the optimistic update from this session may have already won). */
  applyServerEvent: (payload: { added?: { gif_id: string } | null; removed_gif_id?: string | null }) => void
  /** Wipe local state — called on logout to drop the previous session's favorites. */
  reset: () => void
}

export const useGifFavoritesStore = create<GifFavoritesState>((set, get) => ({
  ids: new Set<string>(),
  isLoaded: false,

  reset: () => set({ ids: new Set<string>(), isLoaded: false }),

  load: async () => {
    if (get().isLoaded) return
    try {
      const favs = await getGifFavorites()
      get().applyFavorites(favs)
    } catch {
      set({ isLoaded: true })
    }
  },

  applyFavorites: (favs) => set({ ids: new Set(favs.map((f) => f.gif_id)), isLoaded: true }),

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

  applyServerEvent: (payload) => {
    const current = get().ids
    if (payload.added) {
      const newId = payload.added.gif_id
      if (current.has(newId)) return
      const next = new Set(current)
      next.add(newId)
      set({ ids: next })
      return
    }
    if (payload.removed_gif_id) {
      const rmId = payload.removed_gif_id
      if (!current.has(rmId)) return
      const next = new Set(current)
      next.delete(rmId)
      set({ ids: next })
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
