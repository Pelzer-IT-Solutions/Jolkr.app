import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    confirmRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  return createPortal(
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onCancel}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className="bg-surface rounded-2xl p-8 w-[400px] max-w-[90vw] animate-modal-scale border border-divider shadow-popup" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-text-primary text-lg font-semibold mb-2">{title}</h3>
        <p className="text-text-secondary text-sm mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary rounded-lg hover:bg-white/[0.06]"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-5 py-2.5 text-sm text-white rounded-lg shadow-sm ${
              danger
                ? 'bg-error hover:bg-error/80'
                : 'btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
