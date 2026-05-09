import { useEffect, useState } from 'react'
import { authedFetch } from '../api/client'

/** Module-level cache of resolved stream URLs keyed by attachment id.
 *  Tokens live ~4h server-side; we cache them for ~3.5h so a re-render
 *  (scrolling, tab switching, lightbox open/close) never pays the
 *  round-trip again. Cleared on logout via `resetAllStores`. */
const STREAM_URL_TTL_MS = 3.5 * 60 * 60 * 1000
interface CachedUrl { url: string; expiresAt: number }
const cache = new Map<string, CachedUrl>()

export function clearStreamUrlCache() { cache.clear() }

function attachmentIdFromSrc(src: string): string | null {
  const m = src.match(/\/api\/files\/([^/?#]+)/) ?? src.match(/\/files\/([^/?#]+)/)
  return m?.[1] ?? null
}

/**
 * Resolves an `/api/files/:id` URL into a short-lived signed companion URL
 * (`/api/files/:id?t=<stream-token>`) that media elements can hit directly
 * with HTTP Range requests — playback starts before the full file is
 * downloaded, seeking issues fresh range requests, no blob memory cost.
 *
 * Calls the dedicated `/api/files/:id/url` endpoint which performs the
 * same access checks as the bytes endpoint and signs a stream token bound
 * to the attachment + the calling user (4h TTL). The token rides in the
 * query string because `<video src>` / `<audio src>` can't supply a custom
 * `Authorization` header. Token leakage exposes only that one file for
 * the remaining window — never the JWT, never another attachment.
 *
 * Pass an `/api/files/:id` URL or `null`/`undefined` to disable. Returns
 * `null` while resolving and on failure.
 */
export function useAuthedRedirectUrl(src: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(null)

  useEffect(() => {
    if (!src) {
      queueMicrotask(() => setResolved(null))
      return
    }

    // Only the authed `/api/files/:id` shape gets the streaming treatment.
    // Anything else (legacy direct-MinIO presigned URLs, blob:, data:) we
    // hand back unchanged — the URL is already directly usable.
    const isFilesEndpoint = /\/api\/files\/[^/]+(\?.*)?$/.test(src) || /\/files\/[^/]+(\?.*)?$/.test(src)
    if (!isFilesEndpoint) {
      queueMicrotask(() => setResolved(src))
      return
    }

    // Cache check — re-mount of the same media tile (scrolling away and
    // back, lightbox open/close, message edit re-render) is the common
    // case and shouldn't re-pay the URL round-trip.
    const aid = attachmentIdFromSrc(src)
    if (aid) {
      const hit = cache.get(aid)
      if (hit && hit.expiresAt > Date.now()) {
        queueMicrotask(() => setResolved(hit.url))
        return
      }
    }

    // Build the `/url` companion endpoint: `/api/files/<id>` → `/api/files/<id>/url`.
    // Strip any query string we won't be sending and append `/url` to the path.
    const [pathOnly] = src.split('?', 1)
    const urlEndpoint = `${pathOnly}/url`

    let cancelled = false

    authedFetch(urlEndpoint, { method: 'GET' })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { url?: string }
        if (!json?.url) throw new Error('Missing url in response')
        if (aid) cache.set(aid, { url: json.url, expiresAt: Date.now() + STREAM_URL_TTL_MS })
        setResolved(json.url)
      })
      .catch(() => { if (!cancelled) setResolved(null) })

    return () => { cancelled = true }
  }, [src])

  return resolved
}
