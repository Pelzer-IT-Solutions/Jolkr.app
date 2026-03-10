import { useCallback, useEffect, useRef, useState } from 'react';

/** Clamp a menu position to stay within the viewport */
function clampMenuPosition(x: number, y: number, menuWidth: number, menuHeight: number) {
  const maxX = window.innerWidth - menuWidth - 8;
  const maxY = window.innerHeight - menuHeight - 8;
  return { x: Math.min(x, maxX), y: Math.min(y, maxY) };
}

export interface UseContextMenuReturn<T> {
  isOpen: boolean;
  position: { x: number; y: number };
  data: T | null;
  open: (e: React.MouseEvent, data: T) => void;
  close: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}

export function useContextMenu<T>(menuWidth = 180, menuHeight = 160): UseContextMenuReturn<T> {
  const [state, setState] = useState<{ data: T; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const open = useCallback((e: React.MouseEvent, data: T) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = clampMenuPosition(e.clientX, e.clientY, menuWidth, menuHeight);
    setState({ data, x: pos.x, y: pos.y });
  }, [menuWidth, menuHeight]);

  const close = useCallback(() => setState(null), []);

  // Click-outside handler
  useEffect(() => {
    if (!state) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setState(null);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [state]);

  // Escape + keyboard navigation
  useEffect(() => {
    if (!state) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setState(null);
        return;
      }
      if (!menuRef.current) return;
      const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
      if (!items.length) return;
      const active = document.activeElement as HTMLElement;
      const idx = items.indexOf(active);
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          items[idx < items.length - 1 ? idx + 1 : 0]?.focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          items[idx > 0 ? idx - 1 : items.length - 1]?.focus();
          break;
        case 'Home':
          e.preventDefault();
          items[0]?.focus();
          break;
        case 'End':
          e.preventDefault();
          items[items.length - 1]?.focus();
          break;
        case 'Tab':
          setState(null);
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state]);

  // Auto-focus first menu item on open
  useEffect(() => {
    if (state && menuRef.current) {
      requestAnimationFrame(() => {
        const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
        first?.focus();
      });
    }
  }, [state]);

  return {
    isOpen: state !== null,
    position: state ? { x: state.x, y: state.y } : { x: 0, y: 0 },
    data: state?.data ?? null,
    open,
    close,
    menuRef,
  };
}
