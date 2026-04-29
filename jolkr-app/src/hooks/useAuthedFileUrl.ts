import { useEffect, useRef, useState } from 'react'
import { authedFetch } from '../api/client'

/**
 * Returns a blob: URL for an authenticated file endpoint (e.g. `/api/files/:id`).
 *
 * The browser can't send our Bearer token via `<img src>` or `<video src>`, so
 * we fetch the bytes through the API client (which attaches Authorization +
 * handles refresh), wrap them in a Blob, and hand back a `blob:` URL the DOM
 * can consume directly. The URL is revoked on unmount and on src change to
 * avoid leaking blobs.
 *
 * Pass an absolute URL or `null`/`undefined` to disable the fetch. Returns
 * `null` while loading or on failure — the caller can fall back to the raw
 * URL if it ever becomes publicly reachable.
 */
export function useAuthedFileUrl(src: string | null | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  // Track the URL we've created so the cleanup pass can revoke it even if a
  // re-render races a stale fetch.
  const currentRef = useRef<string | null>(null)

  useEffect(() => {
    if (!src) {
      setBlobUrl(null)
      return
    }
    let cancelled = false

    authedFetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        // Revoke any prior URL we created for this hook before adopting the new
        // one — handles the rapid-src-change case (e.g. lightbox cycling).
        if (currentRef.current) URL.revokeObjectURL(currentRef.current)
        currentRef.current = url
        setBlobUrl(url)
      })
      .catch(() => { if (!cancelled) setBlobUrl(null) })

    return () => {
      cancelled = true
      if (currentRef.current) {
        URL.revokeObjectURL(currentRef.current)
        currentRef.current = null
      }
    }
  }, [src])

  return blobUrl
}
