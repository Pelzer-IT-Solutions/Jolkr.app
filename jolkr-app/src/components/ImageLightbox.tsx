import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, ExternalLink,
  MoreHorizontal, Copy, Link, Info, ChevronRight as ArrowRight,
} from 'lucide-react'
import type { Attachment } from '../api/types'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useAuthedFileUrl } from '../hooks/useAuthedFileUrl'
import { rewriteStorageUrl } from '../platform/config'
import { formatBytes } from '../utils/format'
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
  const [showMore, setShowMore] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
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
  const zoomIn  = useCallback(() => setScale((v) => clampScale(v + SCALE_STEP)), [clampScale])
  const zoomOut = useCallback(() => setScale((v) => clampScale(v - SCALE_STEP)), [clampScale])

  // Reset per-image state when navigating
  useEffect(() => {
    setScale(1)
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
    setScale((prev) => clampScale(prev + (e.deltaY > 0 ? -0.1 : 0.1)))
  }, [clampScale])

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
          className={s.image}
          src={displaySrc}
          alt={current.alt}
          onClick={(e) => e.stopPropagation()}
          onLoad={handleImageLoad}
          style={{ transform: `scale(${scale})` }}
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
