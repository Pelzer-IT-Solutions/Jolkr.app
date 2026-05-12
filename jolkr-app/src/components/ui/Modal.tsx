import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import s from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

export function Modal({ open, onClose, children, className, overlayClassName }: ModalProps) {
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

  const overlayCls = overlayClassName ? `${s.overlay} ${overlayClassName}` : s.overlay;
  const contentCls = className ? `${s.content} ${className}` : s.content;

  return (
    <div
      ref={overlayRef}
      className={overlayCls}
      onClick={onClose ? (e) => { if (e.target === overlayRef.current) onClose(); } : undefined}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        className={contentCls}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
