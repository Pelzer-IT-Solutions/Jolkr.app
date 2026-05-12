import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import s from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  /** Label of the primary (confirm) action. */
  confirmLabel: string;
  /**
   * Label of the secondary (cancel) action. Pass `null` to render only the
   * confirm button — the dialog then behaves as an alert (notify + dismiss).
   */
  cancelLabel?: string | null;
  /** Renders the confirm button in danger style. */
  danger?: boolean;
  onConfirm: () => void;
  /**
   * Called when the user dismisses the dialog without confirming (Escape,
   * backdrop click, or Cancel button). Required even in alert mode so the
   * parent can clear its open-state.
   */
  onCancel: () => void;
}

/**
 * Generic replacement for `window.confirm()` and `window.alert()`. Pass a
 * `cancelLabel` to get a confirm/cancel pair, or `cancelLabel={null}` to
 * render only the confirm button (alert mode — confirm doubles as dismiss).
 */
export function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel = null, danger = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onCancel();
  }

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div ref={cardRef} className={s.modal} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <span id="confirm-title" className={s.title}>{title}</span>
        {body && <p className={`${s.body} txt-small`}>{body}</p>}

        <div className={s.actions}>
          <button
            type="button"
            className={`${s.btn} ${danger ? s.btnDanger : s.btnPrimary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          {cancelLabel != null && (
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
