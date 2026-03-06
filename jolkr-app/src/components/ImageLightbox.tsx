import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  src: string;
  alt?: string;
  onClose: () => void;
}

export default function ImageLightbox({ src, alt, onClose }: Props) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Reset loaded state when src changes
  useEffect(() => { setLoaded(false); }, [src]);

  // Portal to document.body to escape transform containing blocks (virtualizer)
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out"
      onClick={onClose}
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
      {!loaded && (
        <div className="w-16 h-16 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
      )}
      <img
        src={src}
        alt={alt ?? ''}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        className={`max-w-[90vw] max-h-[90vh] min-w-[80vw] min-h-[60vh] object-contain rounded-lg shadow-2xl transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0 absolute'}`}
        onClick={(e) => e.stopPropagation()}
        onLoad={() => setLoaded(true)}
      />
    </div>,
    document.body,
  );
}
