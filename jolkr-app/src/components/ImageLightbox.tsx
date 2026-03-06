import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt, onClose }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Reset state when src changes
  useEffect(() => { setLoaded(false); setScale(1); }, [src]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.min(Math.max(prev + delta, 0.25), 5);
    });
  }, []);

  // Portal to document.body to escape transform containing blocks (virtualizer)
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
      onClick={onClose}
      onWheel={handleWheel}
    >
      <button
        className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
      >
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {scale !== 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1 rounded-full z-10">
          {Math.round(scale * 100)}%
        </div>
      )}
      {!loaded && (
        <div className="w-16 h-16 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? ''}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        className={`max-w-[90vw] max-h-[90vh] min-w-[80vw] min-h-[60vh] object-contain rounded-lg shadow-2xl transition-all duration-150 ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
        style={{ transform: `scale(${scale})` }}
        onClick={onClose}
        onLoad={() => setLoaded(true)}
      />
    </div>,
    document.body,
  );
}
