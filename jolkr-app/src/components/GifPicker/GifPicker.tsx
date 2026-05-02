import { useState, useEffect, useRef, useCallback } from 'react'
import { Heart, Search, X, ArrowLeft } from 'lucide-react'
import { getApiBaseUrl } from '../../platform/config'
import { getGifFavorites, getGifCategories, searchGifs, getFeaturedGifs } from '../../api/client'
import type { TenorResult, TenorCategory } from '../../api/client'
// addGifFavorite/removeGifFavorite are called by the shared store
import type { GifFavorite } from '../../api/types'
import { useGifFavoritesStore } from '../../stores/gif-favorites'
import { useColorMode } from '../../utils/colorMode'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import s from './GifPicker.module.css'

const apiBase = getApiBaseUrl().replace(/\/api$/, '')

interface GifItem {
  id: string
  title: string
  gifUrl: string      // original GIPHY URL (for sending as message)
  previewUrl: string  // proxied tinygif (thumbnail)
  fullUrl: string     // proxied full gif (display)
  width: number
  height: number
}

type View = 'home' | 'browse' | 'favorites'

interface Props {
  onSelect: (gifUrl: string) => void
  width?: number
  height?: number
}

export default function GifPicker({ onSelect, width = 450, height = 450 }: Props) {
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 300)
  const [browseTitle, setBrowseTitle] = useState('')
  const [categories, setCategories] = useState<TenorCategory[]>([])
  const [gifs, setGifs] = useState<GifItem[]>([])
  const [loading, setLoading] = useState(false)
  const favIds = useGifFavoritesStore((s) => s.ids)
  const toggleFav = useGifFavoritesStore((s) => s.toggle)
  const [favGifs, setFavGifs] = useState<GifFavorite[]>([])
  const [offset, setOffset] = useState('0')
  const [hasMore, setHasMore] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { isDark } = useColorMode()
  const theme = isDark ? 'dark' : 'light'

  // Load categories on mount
  useEffect(() => {
    getGifCategories()
      .then((data) => setCategories(data.tags ?? []))
      .catch(() => {})
  }, [])

  // Load favorites on mount
  useEffect(() => {
    getGifFavorites()
      .then((favs) => {
        setFavGifs(favs)
        // Also populate the shared store
        useGifFavoritesStore.setState({ ids: new Set(favs.map((f) => f.gif_id)), loaded: true })
      })
      .catch(() => {})
  }, [])

  const parseTenorResults = (results: TenorResult[]): GifItem[] =>
    results.map((r) => ({
      id: r.id,
      title: r.title ?? r.content_description ?? '',
      gifUrl: r.url,
      previewUrl: r.media_formats?.tinygif?.url ?? '',
      fullUrl: r.media_formats?.gif?.url ?? '',
      width: r.media_formats?.tinygif?.dims?.[0] ?? 150,
      height: r.media_formats?.tinygif?.dims?.[1] ?? 150,
    }))

  const fetchGifs = useCallback(
    async (q: string, pos: string = '0', append = false) => {
      setLoading(true)
      try {
        const data = q
          ? await searchGifs(q, 30, pos)
          : await getFeaturedGifs(30, pos);
        const items = parseTenorResults(data.results ?? [])
        setGifs((prev) => (append ? [...prev, ...items] : items))
        setOffset(data.next ?? '0')
        setHasMore(items.length >= 30)
      } catch {
        if (!append) setGifs([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  // Debounced search — refetch when the debounced query settles.
  useEffect(() => {
    if (view !== 'browse') return
    setOffset('0')
    setHasMore(true)
    fetchGifs(debouncedQuery)
  }, [debouncedQuery, view, fetchGifs])

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || loading || !hasMore || view === 'home') return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      fetchGifs(view === 'browse' ? query : '', offset, true)
    }
  }, [loading, hasMore, offset, query, view, fetchGifs])

  const openCategory = (term: string, name: string) => {
    setQuery(term)
    setBrowseTitle(name)
    setView('browse')
  }

  const openSearch = (q: string) => {
    setQuery(q)
    setBrowseTitle('')
    setView('browse')
  }

  const openFavorites = () => setView('favorites')

  const goHome = () => {
    setView('home')
    setQuery('')
    setBrowseTitle('')
    setGifs([])
  }

  const toggleFavorite = (gif: GifItem) => {
    const isFav = favIds.has(gif.id)
    if (isFav) {
      setFavGifs((prev) => prev.filter((f) => f.gif_id !== gif.id))
    } else {
      const newFav: GifFavorite = {
        gif_id: gif.id,
        gif_url: gif.fullUrl || gif.previewUrl,
        preview_url: gif.previewUrl,
        title: gif.title,
        added_at: new Date().toISOString(),
      }
      setFavGifs((prev) => [newFav, ...prev])
    }
    // Toggle in the shared store (handles API call + optimistic update)
    toggleFav(gif.id)
  }

  // Resolve a proxy-relative URL to absolute
  const resolveUrl = (url: string) =>
    url.startsWith('/') ? `${apiBase}${url}` : url

  // ── Masonry layout: distribute GIFs across 2 columns by cumulative height ──
  const buildColumns = (items: GifItem[]): [GifItem[], GifItem[]] => {
    const cols: [GifItem[], GifItem[]] = [[], []]
    const heights = [0, 0]
    for (const gif of items) {
      const ratio = gif.height / (gif.width || 1)
      const idx = heights[0] <= heights[1] ? 0 : 1
      cols[idx].push(gif)
      heights[idx] += ratio
    }
    return cols
  }

  // Convert favorites to GifItems for rendering
  const favToGifItems = (favs: GifFavorite[]): GifItem[] =>
    favs.map((f) => ({
      id: f.gif_id,
      title: f.title,
      gifUrl: f.gif_url,
      previewUrl: f.preview_url,
      fullUrl: f.gif_url,
      width: 150,
      height: 150,
    }))

  // ── Render masonry GIF grid ──
  const renderGifGrid = (items: GifItem[]) => {
    if (!loading && items.length === 0) {
      return (
        <div className={s.body}>
          <div className={s.empty}>
            <span>{view === 'favorites' ? 'No favorites yet' : 'No GIFs found'}</span>
          </div>
        </div>
      )
    }

    const [col1, col2] = buildColumns(items)

    const renderCell = (gif: GifItem) => (
      <div key={gif.id} className={s.gifCell}>
        <img
          className={s.gifThumb}
          src={resolveUrl(gif.previewUrl)}
          alt={gif.title}
          loading="lazy"
          onClick={() => {
            const url = gif.fullUrl ? resolveUrl(gif.fullUrl) : resolveUrl(gif.previewUrl)
            onSelect(url)
          }}
        />
        <button
          className={s.heartBtn}
          data-fav={favIds.has(gif.id)}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(gif) }}
          title={favIds.has(gif.id) ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={14} fill={favIds.has(gif.id) ? 'currentColor' : 'none'} />
        </button>
      </div>
    )

    return (
      <div className={s.body}>
        <div className={s.gifList} ref={scrollRef} onScroll={handleScroll}>
          <div className={s.gifColumn}>
            {col1.map(renderCell)}
          </div>
          <div className={s.gifColumn}>
            {col2.map(renderCell)}
          </div>
        </div>
      </div>
    )
  }

  // ── Header content depends on view ──
  const renderHeader = () => {
    // Home: search input
    if (view === 'home') {
      return (
        <div className={s.searchWrap}>
          <Search size={18} className={s.searchIcon} />
          <input
            className={s.searchInput}
            placeholder="Search Tenor"
            value={query}
            onChange={(e) => {
              const val = e.target.value
              setQuery(val)
              if (val.length > 0) openSearch(val)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && query) openSearch(query) }}
          />
        </div>
      )
    }

    // Browse with a category title (not free search)
    if (view === 'browse' && browseTitle) {
      return (
        <>
          <button className={s.backBtn} onClick={goHome} title="Back">
            <ArrowLeft size={18} />
          </button>
          <div className={s.titleBar}>
            <span className={s.titleText}>{browseTitle}</span>
            <button className={s.clearBtn} onClick={goHome} title="Close">
              <X size={16} />
            </button>
          </div>
        </>
      )
    }

    // Browse with free search or favorites
    return (
      <>
        <button className={s.backBtn} onClick={goHome} title="Back">
          <ArrowLeft size={18} />
        </button>
        {view === 'favorites' ? (
          <div className={s.titleBar}>
            <Heart size={16} />
            <span className={s.titleText}>Favorites</span>
          </div>
        ) : (
          <div className={s.searchWrap}>
            <Search size={18} className={s.searchIcon} />
            <input
              className={s.searchInput}
              placeholder="Search Tenor"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button className={s.clearBtn} onClick={() => setQuery('')} title="Clear" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
                <X size={16} />
              </button>
            )}
          </div>
        )}
      </>
    )
  }

  return (
    <div className={s.picker} data-theme={theme} style={{ width, height }}>
      {/* Header */}
      <div className={s.header}>
        {renderHeader()}
      </div>

      {/* Body */}
      {view === 'home' && (
        <div className={s.body}>
          <div className={s.categories}>
            {/* Favorites card — first position, shows first fav GIF as preview */}
            <button className={s.categoryCard} onClick={openFavorites}>
              {favGifs.length > 0 ? (
                <img
                  className={s.categoryImg}
                  src={resolveUrl(favGifs[0].preview_url)}
                  alt="Favorites"
                  loading="lazy"
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2b2b2b' }}>
                  <Heart size={28} color="#ff4757" fill="#ff4757" />
                </div>
              )}
              <div className={s.categoryOverlay}>
                <span className={s.categoryName}>
                  <Heart size={16} fill="currentColor" />
                  Favorites
                </span>
              </div>
            </button>

            {/* Category cards from GIPHY */}
            {categories.map((cat) => (
              <button
                key={cat.searchterm}
                className={s.categoryCard}
                onClick={() => openCategory(cat.searchterm, cat.name.replace(/^#/, ''))}
              >
                {cat.image && (
                  <img
                    className={s.categoryImg}
                    src={resolveUrl(cat.image)}
                    alt={cat.name}
                    loading="lazy"
                  />
                )}
                <div className={s.categoryOverlay}>
                  <span className={s.categoryName}>{cat.name.replace(/^#/, '')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'browse' && renderGifGrid(gifs)}
      {view === 'favorites' && renderGifGrid(favToGifItems(favGifs))}

      {loading && view !== 'home' && gifs.length === 0 && (
        <div className={s.loading}>Loading...</div>
      )}

    </div>
  )
}
