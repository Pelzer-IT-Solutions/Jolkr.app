import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

export default function Modal({ open, onClose, children, className, overlayClassName }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useFocusTrap(contentRef);

  useEffect(() => {
    if (!open || !onClose) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className={`fixed inset-0 z-50 flex items-center justify-center animate-fade-in ${overlayClassName ?? 'bg-black/50'}`}
      onClick={onClose ? (e) => { if (e.target === overlayRef.current) onClose(); } : undefined}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        className={`bg-sidebar rounded-3xl border border-divider shadow-popup animate-modal-scale max-h-[85vh] overflow-y-auto ${className ?? ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
