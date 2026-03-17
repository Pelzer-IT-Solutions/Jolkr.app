import { useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

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
  const confirmRef = useRef<HTMLButtonElement>(null);

  return createPortal(
    <Modal open onClose={onCancel} className="p-8 w-100 max-w-[90vw]">
      <h3 className="text-text-primary text-lg font-semibold mb-2">{title}</h3>
      <p className="text-text-secondary text-sm mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-5 py-2.5 text-sm text-text-secondary hover:text-text-primary rounded-lg hover:bg-hover"
        >
          {cancelLabel}
        </button>
        <Button ref={confirmRef} onClick={onConfirm} variant={danger ? 'danger' : 'primary'}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>,
    document.body,
  );
}
