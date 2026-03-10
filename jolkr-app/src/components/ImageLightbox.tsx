import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';

export interface LightboxImage {
  src: string;
  alt: string;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
}

export default function ImageLightbox({ images, initialIndex = 0, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(lightboxRef);

  const current = images[index];
  const hasMultiple = images.length > 1;

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : images.length - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((i) => (i < images.length - 1 ? i + 1 : 0));
  }, [images.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (hasMultiple && e.key === 'ArrowLeft') goPrev();
      if (hasMultiple && e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, hasMultiple, goPrev, goNext]);

  // Reset loaded/scale when image changes
  useEffect(() => { setLoaded(false); setScale(1); }, [index]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(Math.max(prev + delta, 0.25), 5);
    });
  }, []);

  if (!current) return null;

  return createPortal(
    <div
      ref={lightboxRef}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
      onClick={onClose}
      onWheel={handleWheel}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Previous button */}
      {hasMultiple && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Previous image"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Next button */}
      {hasMultiple && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Next image"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
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
        <div className="w-16 h-16 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
      )}

      {/* Image */}
      <img
        ref={imgRef}
        src={current.src}
        alt={current.alt}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        className={`max-w-[90vw] max-h-[90vh] min-w-[80vw] min-h-[60vh] object-contain rounded-lg shadow-2xl transition-all duration-150 ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
        style={{ transform: `scale(${scale})` }}
        onClick={onClose}
        onLoad={() => setLoaded(true)}
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
