import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, ExternalLink, MoreHorizontal, Copy, Link, Info } from 'lucide-react';
import { formatBytes } from '../utils/format';
import Spinner from './ui/Spinner';

export interface LightboxImage {
  src: string;
  alt: string;
  filename?: string;
  sizeBytes?: number;
  contentType?: string;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2;
const SCALE_STEP = 0.1;

export default function ImageLightbox({ images, initialIndex = 0, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const [showMore, setShowMore] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useFocusTrap(lightboxRef);

  const current = images[index];
  const hasMultiple = images.length > 1;

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  }, [images.length]);

  const clampScale = useCallback((s: number) => Math.round(Math.min(Math.max(s, MIN_SCALE), MAX_SCALE) * 10) / 10, []);

  const zoomIn = useCallback(() => setScale((s) => clampScale(s + SCALE_STEP)), [clampScale]);
  const zoomOut = useCallback(() => setScale((s) => clampScale(s - SCALE_STEP)), [clampScale]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowMore(false); setShowDetails(false); onClose(); }
      if (hasMultiple && e.key === 'ArrowLeft') goPrev();
      if (hasMultiple && e.key === 'ArrowRight') goNext();
      if (e.key === '+' || e.key === '=') zoomIn();
      if (e.key === '-') zoomOut();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, hasMultiple, goPrev, goNext, zoomIn, zoomOut]);

  // Reset state when image changes
  useEffect(() => {
    setLoaded(false);
    setScale(1);
    setShowMore(false);
    setShowDetails(false);
    setDimensions(null);
  }, [index]);

  // Close more menu when clicking outside
  useEffect(() => {
    if (!showMore) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setShowMore(false);
        setShowDetails(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMore]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return clampScale(prev + delta);
    });
  }, [clampScale]);

  const handleImageLoad = useCallback(() => {
    setLoaded(true);
    if (imgRef.current) {
      setDimensions({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      const response = await fetch(current.src, { mode: 'cors' });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = current.filename || current.alt || 'image';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(current.src, '_blank');
    }
  }, [current]);

  const handleOpenExternal = useCallback(() => {
    window.open(current.src, '_blank', 'noopener');
  }, [current]);

  const handleCopyImage = useCallback(async () => {
    try {
      const response = await fetch(current.src, { mode: 'cors' });
      const blob = await response.blob();
      const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(current.src);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    } catch { /* clipboard API may not be available */ }
    setShowMore(false);
  }, [current]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(current.src);
    } catch { /* ignore */ }
    setShowMore(false);
  }, [current]);

  if (!current) return null;

  const sizeStr = current.sizeBytes ? formatBytes(current.sizeBytes) : null;
  const dimStr = dimensions ? `${dimensions.w}x${dimensions.h}` : null;
  const detailStr = [dimStr, sizeStr].filter(Boolean).join(' (') + (sizeStr ? ')' : '');

  return createPortal(
    <div
      ref={lightboxRef}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
      onClick={onClose}
      onWheel={handleWheel}
    >
      {/* Toolbar */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={zoomIn}
          disabled={scale >= MAX_SCALE}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom in (+)"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          onClick={zoomOut}
          disabled={scale <= MIN_SCALE}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Zoom out (-)"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-5 h-5" />
        </button>
        <button
          onClick={handleDownload}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          title="Download"
          aria-label="Download"
        >
          <Download className="w-5 h-5" />
        </button>
        <button
          onClick={handleOpenExternal}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          title="Open in new tab"
          aria-label="Open in new tab"
        >
          <ExternalLink className="w-5 h-5" />
        </button>

        {/* More menu */}
        <div className="relative" ref={moreRef}>
          <button
            onClick={() => { setShowMore((v) => !v); setShowDetails(false); }}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${showMore ? 'bg-white/20 text-white' : 'bg-black/50 text-white/70 hover:text-white hover:bg-black/70'}`}
            title="More"
            aria-label="More options"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {showMore && (
            <div className="absolute right-0 top-11 bg-surface border border-divider rounded-xl shadow-float py-1 w-48 text-sm">
              <button
                onClick={handleCopyImage}
                className="w-full px-3 py-2 text-left text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy Image
              </button>
              <button
                onClick={handleCopyLink}
                className="w-full px-3 py-2 text-left text-text-secondary hover:bg-hover hover:text-text-primary flex items-center gap-2"
              >
                <Link className="w-4 h-4" />
                Copy Link
              </button>
              <button
                onClick={() => setShowDetails((v) => !v)}
                className={`w-full px-3 py-2 text-left flex items-center gap-2 ${showDetails ? 'bg-hover text-text-primary' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
              >
                <Info className="w-4 h-4" />
                View Details
                <ChevronRight className="w-3 h-3 ml-auto" />
              </button>
              {showDetails && (
                <div className="px-3 py-2 border-t border-divider">
                  <div className="text-text-tertiary text-xs mb-1">Filename</div>
                  <div className="text-text-primary text-xs truncate mb-2">{current.filename || current.alt}</div>
                  {(dimStr || sizeStr) && (
                    <>
                      <div className="text-text-tertiary text-xs mb-1">Size</div>
                      <div className="text-text-primary text-xs">{detailStr}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          title="Close (Esc)"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Previous button */}
      {hasMultiple && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Previous image"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Next button */}
      {hasMultiple && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Next image"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-sm px-3 py-1 rounded-full z-10">
          {index + 1} / {images.length}
        </div>
      )}

      {/* Zoom indicator */}
      {scale !== 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1 rounded-full z-10">
          {Math.round(scale * 100)}%
        </div>
      )}

      {/* Spinner */}
      {!loaded && (
        <Spinner colors="border-white/20 border-t-white/60" className="size-16! border-2!" />
      )}

      {/* Image */}
      <img
        ref={imgRef}
        src={current.src}
        alt={current.alt}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        className={`max-w-[90vw] max-h-[90vh] min-w-[80vw] min-h-[60vh] object-contain shadow-2xl transition-all duration-150 ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
        style={{ transform: `scale(${scale})` }}
        onClick={onClose}
        onLoad={handleImageLoad}
      />

      {/* Thumbnail strip */}
      {hasMultiple && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10" style={{ marginBottom: scale !== 1 ? '2rem' : 0 }}>
          {images.map((img, i) => (
            <button
              key={img.src}
              onClick={(e) => { e.stopPropagation(); setIndex(i); }}
              className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all ${i === index ? 'border-white scale-110' : 'border-white/30 hover:border-white/60 opacity-60 hover:opacity-100'}`}
              aria-label={`View image ${i + 1}`}
            >
              <img src={img.src} alt={img.alt} crossOrigin="anonymous" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/** Convert an image URL to a PNG blob (for clipboard API which requires PNG). */
async function convertToPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert to PNG'));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = src;
  });
}
