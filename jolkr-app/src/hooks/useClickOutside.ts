import { useEffect, useRef, type RefObject } from 'react';

/**
 * Hook that calls `onClose` when a click/touch happens outside the referenced element.
 * Replaces the anti-pattern of `<div className="fixed inset-0" onClick={close} />`
 * which blocks all clicks and requires double-clicking.
 *
 * `anchor` should point at the trigger element (e.g. the toggle button). Clicks
 * inside the anchor are NOT treated as outside — otherwise the toggle button
 * would close the popup on mousedown, and its own onClick would re-open it
 * on the same gesture, producing the close-then-reopen flicker.
 */
export function useClickOutside<T extends HTMLElement>(
  onClose: () => void,
  active = true,
  anchor?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;

    const handler = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor?.current?.contains(target)) return;
      onClose();
    };

    // Use mousedown instead of click so it fires before focus changes
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);

    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose, active, anchor]);

  return ref;
}
