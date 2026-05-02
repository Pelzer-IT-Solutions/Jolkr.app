import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, ExternalLink,
  MoreHorizontal, Copy, Link, Info, ChevronRight as ArrowRight,
} from 'lucide-react'
import type { Attachment } from '../../api/types'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useAuthedFileUrl } from '../../hooks/useAuthedFileUrl'
import { rewriteStorageUrl } from '../../platform/config'
import { formatBytes } from '../../utils/format'
import s from './ImageLightbox.module.css'

export interface LightboxImage {
  src: string
  alt: string
  filename?: string
  sizeBytes?: number
  contentType?: string
}

interface PropsAttachments {
  attachments: Attachment[]
  initialIndex?: number
  onClose: () => void
}
interface PropsImages {
  images: LightboxImage[]
  initialIndex?: number
  onClose: () => void
}
type Props = PropsAttachments | PropsImages

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const SCALE_STEP = 0.1

function resolveSrc(rawUrl: string): string {
  if (rawUrl.startsWith('/api/files/') || rawUrl.startsWith('/files/')) return rawUrl
  return rewriteStorageUrl(rawUrl) ?? rawUrl
}

export default function ImageLightbox(props: Props) {
  // Normalize both prop shapes into a single internal model — the legacy
  // "images" prop carries a precomputed src; the newer "attachments" prop
  // routes through useAuthedFileUrl below to get a blob: URL.
  const items: { src: string; needsAuth: boolean; alt: string; filename?: string; sizeBytes?: number; contentType?: string }[] =
    'attachments' in props
      ? props.attachments.map((a) => ({
          src: resolveSrc(a.url),
          needsAuth: a.url.startsWith('/api/files/') || a.url.startsWith('/files/'),
          alt: a.filename,
          filename: a.filename,
          sizeBytes: a.size_bytes,
          contentType: a.content_type,
        }))
      : props.images.map((i) => ({ ...i, needsAuth: false }))

  const [index, setIndex] = useState(props.initialIndex ?? 0)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // Live drag state held in refs (no rerender per mousemove). Captures the
  // cursor + offset at mousedown so the move handler can compute delta in O(1).
  const panStartRef = useRef<{ cursorX: number; cursorY: number; offsetX: number; offsetY: number } | null>(null)
  // Track whether mousedown actually moved — used to suppress the click-to-
  // close that fires after a drag ends.
  const dragMovedRef = useRef(false)
  useFocusTrap(containerRef)

  const current = items[index]
  const hasMultiple = items.length > 1

  // Always call the hook — pass null when current item already has a usable
  // URL so the hook short-circuits without a fetch.
  const blobUrl = useAuthedFileUrl(current?.needsAuth ? current.src : null)
  const displaySrc = current?.needsAuth ? blobUrl : current?.src ?? null
  const isLoading = !displaySrc

  const goPrev = useCallback(() => setIndex((i) => (i > 0 ? i - 1 : items.length - 1)), [items.length])
  const goNext = useCallback(() => setIndex((i) => (i < items.length - 1 ? i + 1 : 0)), [items.length])
  const clampScale = useCallback((v: number) => Math.round(Math.min(Math.max(v, MIN_SCALE), MAX_SCALE) * 10) / 10, [])

  // Pan offset is bounded so the image can't be dragged off-screen entirely —
  // when we're zoomed in, the user can shift up to half of the *extra* pixels
  // the zoom adds in each axis. At scale=1 the bounds are zero (pan is locked).
  const clampOffset = useCallback((next: { x: number; y: number }, atScale: number) => {
    const img = imgRef.current
    if (!img) return next
    // offsetWidth/Height ignore CSS transforms, so they give us the true
    // pre-scale rendered size — exactly what we need for the bounds math.
    const baseW = img.offsetWidth
    const baseH = img.offsetHeight
    const maxX = Math.max(0, (baseW * atScale - baseW) / 2)
    const maxY = Math.max(0, (baseH * atScale - baseH) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }, [])

  // Centralised setter so every zoom path enforces the offset clamp. When the
  // user zooms back to 1× we snap the offset back to centre — otherwise a
  // tiny remainder leaves the image visibly nudged.
  const applyScale = useCallback((nextScale: number, anchor?: { clientX: number; clientY: number }) => {
    const clamped = clampScale(nextScale)
    setScale((prev) => {
      if (clamped === prev) return prev
      // If we have an anchor (wheel zoom toward cursor), shift the offset so
      // the point under the cursor stays put. Derivation: offset is added in
      // post-scale viewport pixels, so `new = old + dx * (1 - ratio)` where
      // dx is cursor distance from the displayed image centre.
      if (anchor && imgRef.current) {
        const rect = imgRef.current.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top  + rect.height / 2
        const dx = anchor.clientX - cx
        const dy = anchor.clientY - cy
        const ratio = clamped / prev
        setOffset((curr) => {
          const next = clamped <= 1
            ? { x: 0, y: 0 }
            : { x: curr.x + dx * (1 - ratio), y: curr.y + dy * (1 - ratio) }
          return clampOffset(next, clamped)
        })
      } else if (clamped <= 1) {
        setOffset({ x: 0, y: 0 })
      } else {
        setOffset((curr) => clampOffset(curr, clamped))
      }
      return clamped
    })
  }, [clampScale, clampOffset])

  const zoomIn  = useCallback(() => applyScale(scale + SCALE_STEP), [scale, applyScale])
  const zoomOut = useCallback(() => applyScale(scale - SCALE_STEP), [scale, applyScale])

  // Reset per-image state when navigating
  useEffect(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
    setShowMore(false)
    setShowDetails(false)
    setNaturalDims(null)
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowMore(false); setShowDetails(false); props.onClose() }
      if (hasMultiple && e.key === 'ArrowLeft')  goPrev()
      if (hasMultiple && e.key === 'ArrowRight') goNext()
      if (e.key === '+' || e.key === '=') zoomIn()
      if (e.key === '-') zoomOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props, hasMultiple, goPrev, goNext, zoomIn, zoomOut])

  useEffect(() => {
    if (!showMore) return
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false); setShowDetails(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMore])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP
    applyScale(scale + delta, { clientX: e.clientX, clientY: e.clientY })
  }, [scale, applyScale])

  // ── Pan handlers (active when scale > 1) ──────────────────────────────
  const handleImagePointerDown = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return
    // Left mouse / primary pointer only — we don't want to start a pan from
    // a right-click or middle-click.
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    panStartRef.current = {
      cursorX: e.clientX,
      cursorY: e.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    }
    dragMovedRef.current = false
    setIsPanning(true)
    // Capture the pointer so we keep getting events even if the cursor
    // strays outside the image (or the lightbox).
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [scale, offset])

  const handleImagePointerMove = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    const start = panStartRef.current
    if (!start) return
    const dx = e.clientX - start.cursorX
    const dy = e.clientY - start.cursorY
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMovedRef.current = true
    setOffset(clampOffset({ x: start.offsetX + dx, y: start.offsetY + dy }, scale))
  }, [scale, clampOffset])

  const handleImagePointerUp = useCallback((e: React.PointerEvent<HTMLImageElement>) => {
    if (!panStartRef.current) return
    panStartRef.current = null
    setIsPanning(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  // Double-click toggles between 1× and 2× anchored on the cursor — quick
  // shortcut so users don't have to click + + + + to zoom in.
  const handleImageDoubleClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation()
    if (scale > 1) {
      applyScale(1)
    } else {
      applyScale(2, { clientX: e.clientX, clientY: e.clientY })
    }
  }, [scale, applyScale])

  const handleDownload = useCallback(async () => {
    if (!displaySrc) return
    try {
      const a = document.createElement('a')
      a.href = displaySrc
      a.download = current?.filename || current?.alt || 'image'
      a.click()
    } catch {
      window.open(displaySrc, '_blank')
    }
  }, [displaySrc, current])

  const handleOpenExternal = useCallback(() => {
    if (displaySrc) window.open(displaySrc, '_blank', 'noopener')
  }, [displaySrc])

  const handleCopyImage = useCallback(async () => {
    if (!displaySrc) return
    try {
      const res = await fetch(displaySrc)
      const blob = await res.blob()
      const png = blob.type === 'image/png' ? blob : await convertToPng(displaySrc)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    } catch { /* clipboard API may be unavailable */ }
    setShowMore(false)
  }, [displaySrc])

  const handleCopyLink = useCallback(async () => {
    if (!current) return
    try {
      // Copy the canonical (non-blob) URL — blob URLs are local-only and
      // useless in chat. Prefer the source the lightbox was opened with.
      await navigator.clipboard.writeText(current.src)
    } catch { /* ignore */ }
    setShowMore(false)
  }, [current])

  const handleImageLoad = useCallback(() => {
    if (imgRef.current) {
      setNaturalDims({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })
    }
  }, [])

  if (!current) return null

  const sizeStr = current.sizeBytes ? formatBytes(current.sizeBytes) : null
  const dimStr = naturalDims ? `${naturalDims.w}×${naturalDims.h}` : null

  return createPortal(
    <div
      ref={containerRef}
      className={s.overlay}
      onClick={props.onClose}
      onWheel={handleWheel}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      {/* ── Toolbar ── */}
      <div className={s.toolbar} onClick={(e) => e.stopPropagation()}>
        <button className={s.toolBtn} onClick={zoomIn}  disabled={scale >= MAX_SCALE} title="Zoom in (+)" aria-label="Zoom in"><ZoomIn size={18} strokeWidth={1.6} /></button>
        <button className={s.toolBtn} onClick={zoomOut} disabled={scale <= MIN_SCALE} title="Zoom out (-)" aria-label="Zoom out"><ZoomOut size={18} strokeWidth={1.6} /></button>
        <button className={s.toolBtn} onClick={handleDownload}     title="Download"           aria-label="Download"><Download size={18} strokeWidth={1.6} /></button>
        <button className={s.toolBtn} onClick={handleOpenExternal} title="Open in new tab"    aria-label="Open in new tab"><ExternalLink size={18} strokeWidth={1.6} /></button>

        <div className={s.moreWrap} ref={moreRef}>
          <button
            className={`${s.toolBtn} ${showMore ? s.toolBtnActive : ''}`}
            onClick={() => { setShowMore((v) => !v); setShowDetails(false) }}
            title="More"
            aria-label="More options"
          >
            <MoreHorizontal size={18} strokeWidth={1.6} />
          </button>
          {showMore && (
            <div className={s.moreMenu}>
              <button className={s.menuItem} onClick={handleCopyImage}><Copy size={14} strokeWidth={1.6} />Copy image</button>
              <button className={s.menuItem} onClick={handleCopyLink}><Link size={14} strokeWidth={1.6} />Copy link</button>
              <button
                className={`${s.menuItem} ${showDetails ? s.active : ''}`}
                onClick={() => setShowDetails((v) => !v)}
              >
                <Info size={14} strokeWidth={1.6} />View details
                <ArrowRight size={12} strokeWidth={1.8} className={s.menuChevron} />
              </button>
              {showDetails && (
                <div className={s.detailsBlock}>
                  <span className={s.detailsLabel}>Filename</span>
                  <span className={s.detailsValue}>{current.filename || current.alt}</span>
                  {(dimStr || sizeStr) && (
                    <>
                      <span className={s.detailsLabel}>Size</span>
                      <span className={s.detailsValue}>{[dimStr, sizeStr].filter(Boolean).join(' · ')}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <button className={s.toolBtn} onClick={props.onClose} title="Close (Esc)" aria-label="Close">
          <X size={18} strokeWidth={1.6} />
        </button>
      </div>

      {/* ── Prev / next ── */}
      {hasMultiple && (
        <button className={`${s.navBtn} ${s.navBtnLeft}`} onClick={(e) => { e.stopPropagation(); goPrev() }} aria-label="Previous image"><ChevronLeft size={22} strokeWidth={1.8} /></button>
      )}
      {hasMultiple && (
        <button className={`${s.navBtn} ${s.navBtnRight}`} onClick={(e) => { e.stopPropagation(); goNext() }} aria-label="Next image"><ChevronRight size={22} strokeWidth={1.8} /></button>
      )}

      {hasMultiple && <div className={s.counter}>{index + 1} / {items.length}</div>}

      {scale !== 1 && <div className={s.zoomPill}>{Math.round(scale * 100)}%</div>}

      {isLoading && <div className={s.spinner} />}

      {displaySrc && (
        <img
          ref={imgRef}
          className={`${s.image} ${scale > 1 ? (isPanning ? s.imagePanning : s.imagePannable) : ''}`}
          src={displaySrc}
          alt={current.alt}
          onClick={(e) => {
            e.stopPropagation()
            // Suppress the click that fires after a drag — otherwise
            // releasing a pan would also close the lightbox if we ever
            // wired that path.
            if (dragMovedRef.current) {
              dragMovedRef.current = false
              return
            }
          }}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={handleImagePointerUp}
          onPointerCancel={handleImagePointerUp}
          onDoubleClick={handleImageDoubleClick}
          onLoad={handleImageLoad}
          style={{
            // Order matters: translate first, then scale, so the offset is
            // applied in pre-scale image coordinates (matches the clamp).
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: isPanning ? 'none' : 'transform 150ms ease',
          }}
          draggable={false}
        />
      )}
    </div>,
    document.body,
  )
}

/** PNG conversion for clipboard (which only accepts image/png). */
async function convertToPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No canvas context')); return }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob); else reject(new Error('PNG conversion failed'))
      }, 'image/png')
    }
    img.onerror = reject
    img.src = src
  })
}
