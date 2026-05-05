import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import s from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

/**
 * Shared modal scaffold.
 * - Portal-rendered at `document.body` so an `overflow: hidden` ancestor
 *   (e.g. the chat scroller) can never clip the dialog.
 * - Escape closes (when `onClose` is supplied).
 * - Click on the backdrop closes; click on the content does not.
 * - Tab is trapped inside the content via `useFocusTrap`.
 *
 * Consumer CSS gets merged onto the built-in `.overlay` / `.content` classes,
 * so dialogs can override sizing / radius / animation while keeping the
 * built-in backdrop + scaffolding behaviour. (Last source wins per CSS spec.)
 */
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

  const overlayCls = overlayClassName ? `${s.overlay} ${overlayClassName}` : s.overlay;
  const contentCls = className ? `${s.content} ${className}` : s.content;

  return createPortal(
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
    </div>,
    document.body,
  );
}
