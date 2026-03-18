import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useMobileNav } from '../hooks/useMobileNav';

export interface SidePanelProps {
  title: string;
  onClose: () => void;
  headerRight?: ReactNode;
  children: ReactNode;
}

const ANIM_DURATION = 200; // ms, matches CSS animations

export default function SidePanel({ title, onClose, headerRight, children }: SidePanelProps) {
  const { isMobile } = useMobileNav();
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleClose = useCallback(() => {
    if (!isMobile) { onClose(); return; }
    setClosing(true);
    timerRef.current = setTimeout(onClose, ANIM_DURATION);
  }, [isMobile, onClose]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleClose]);

  const header = (
    <div className="min-h-17 px-5 py-3 flex items-center gap-2 border-b border-divider shrink-0">
      <h3 className="text-text-primary font-semibold text-sm flex-1 truncate">{title}</h3>
      {headerRight}
      <button onClick={handleClose} className="text-text-tertiary hover:text-text-primary shrink-0" aria-label="Close panel">
        <X className="size-5" />
      </button>
    </div>
  );

  if (isMobile) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex flex-row"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div
          className={`absolute z-0 inset-0 bg-black/50 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
          onClick={handleClose}
        />
        <div className={`ml-auto relative z-10 w-4/5 max-w-80 bg-sidebar border-l border-divider h-full ${closing ? 'animate-slide-out-right' : 'animate-slide-in-right'} flex flex-col shrink-0`}>
          {header}
          <div className="flex-1 flex flex-col min-h-0">
            {children}
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="w-80 h-full bg-sidebar border-l border-divider flex flex-col shrink-0 animate-fade-in">
      {header}
      <div className="flex-1 flex flex-col min-h-0">
        {children}
      </div>
    </div>
  );
}
