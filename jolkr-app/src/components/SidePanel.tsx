import { type ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import { useMobileNav } from '../hooks/useMobileNav';

export interface SidePanelProps {
  title: string;
  onClose: () => void;
  headerRight?: ReactNode;
  children: ReactNode;
}

export default function SidePanel({ title, onClose, headerRight, children }: SidePanelProps) {
  const { isMobile } = useMobileNav();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const header = (
    <div className="min-h-17 px-5 py-3 flex items-center gap-2 border-b border-divider shrink-0">
      <h3 className="text-text-primary font-semibold text-sm flex-1 truncate">{title}</h3>
      {headerRight}
      <button onClick={onClose} className="text-text-tertiary hover:text-text-primary shrink-0" aria-label="Close panel">
        <X className="size-5" />
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1" onClick={onClose} />
        <div className="w-4/5 max-w-80 bg-sidebar border-l border-divider h-full animate-slide-in-right flex flex-col">
          {header}
          <div className="flex-1 flex flex-col min-h-0">
            {children}
          </div>
        </div>
      </div>
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
