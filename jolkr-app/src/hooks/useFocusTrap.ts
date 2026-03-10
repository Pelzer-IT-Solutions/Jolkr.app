import { useEffect, useRef } from 'react';

const FOCUSABLE = 'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>) {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    const container = containerRef.current;
    if (!container) return;

    const first = container.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables.length === 0) return;

      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [containerRef]);
}
