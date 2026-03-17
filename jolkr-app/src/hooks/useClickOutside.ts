import { useEffect, useRef, type RefObject } from 'react';

/**
 * Hook that calls `onClose` when a click/touch happens outside the referenced element.
 * Replaces the anti-pattern of `<div className="fixed inset-0" onClick={close} />`
 * which blocks all clicks and requires double-clicking.
 */
export function useClickOutside<T extends HTMLElement>(
  onClose: () => void,
  active = true,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;

    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Use mousedown instead of click so it fires before focus changes
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);

    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose, active]);

  return ref;
}
