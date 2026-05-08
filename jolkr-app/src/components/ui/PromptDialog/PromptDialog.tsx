import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import s from './PromptDialog.module.css';

export interface PromptDialogProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  placeholder?: string;
  defaultValue?: string;
  submitLabel: string;
  cancelLabel: string;
  /**
   * When true, the submit button is enabled even when the input is empty
   * — useful for optional fields. Default: false (non-empty value required).
   */
  allowEmpty?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Generic replacement for `window.prompt()`. Renders a single-line text input
 * and submits via Enter or the primary button. Trims whitespace before
 * delivering the value — pass through `value || undefined` if your call-site
 * treats empty string as absent.
 */
export default function PromptDialog({
  open, title, body, placeholder, defaultValue = '', submitLabel, cancelLabel, allowEmpty = false, onSubmit, onCancel,
}: PromptDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);
  // Reset the input each time the dialog re-opens so a stale value from a
  // previous invocation never leaks into the next one. Uses React 19's
  // store-prev pattern instead of an effect to avoid the set-state-in-effect
  // cascade.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(defaultValue);
  }
  useFocusTrap(cardRef);

  // Defer the focus to after the portal mounts so autofocus actually lands.
  useEffect(() => {
    if (open) queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!allowEmpty && !trimmed) return;
    onSubmit(trimmed);
  }

  const canSubmit = allowEmpty || value.trim().length > 0;

  return createPortal(
    <div className={s.overlay} onClick={handleOverlayClick}>
      <div ref={cardRef} className={s.modal} role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <span id="prompt-title" className={s.title}>{title}</span>
        {body && <p className={`${s.body} txt-small`}>{body}</p>}

        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className={s.input}
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className={s.actions}>
            <button
              type="submit"
              className={`${s.btn} ${s.btnPrimary}`}
              disabled={!canSubmit}
            >
              {submitLabel}
            </button>
            <button type="button" className={`${s.btn} ${s.btnGhost}`} onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
