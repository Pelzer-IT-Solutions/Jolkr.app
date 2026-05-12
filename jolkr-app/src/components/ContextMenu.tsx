import * as Icons from 'lucide-react';
import { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useContextMenuStore, type ContextMenuEntry } from '../stores/context-menu';
import s from './ContextMenu.module.css';

const MENU_PADDING = 8;

const variantClass: Record<string, string> = {
  default: '',
  danger: s.danger,
  warning: s.warning,
};

function isDivider(entry: ContextMenuEntry): entry is { divider: true } {
  return 'divider' in entry;
}

/** Resolve a lucide icon component by name string. */
function getIcon(name: string): React.ComponentType<{ className?: string }> | null {
  const icon = (Icons as Record<string, unknown>)[name];
  return typeof icon === 'function' ? icon as React.ComponentType<{ className?: string }> : null;
}

export function ContextMenu() {
  const isOpen = useContextMenuStore((s) => s.isOpen);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const close = useContextMenuStore((s) => s.close);
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp position to viewport after render (once we know menu dimensions)
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - MENU_PADDING);
    const clampedY = Math.min(y, window.innerHeight - rect.height - MENU_PADDING);
    el.style.left = `${Math.max(MENU_PADDING, clampedX)}px`;
    el.style.top = `${Math.max(MENU_PADDING, clampedY)}px`;
  }, [isOpen, x, y, items]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    const menu = menuRef.current;
    if (!menu) return;

    const focusableItems = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
    const currentIndex = focusableItems.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusableItems[(currentIndex + 1) % focusableItems.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusableItems[(currentIndex - 1 + focusableItems.length) % focusableItems.length]?.focus();
        break;
      case 'Home':
        e.preventDefault();
        focusableItems[0]?.focus();
        break;
      case 'End':
        e.preventDefault();
        focusableItems[focusableItems.length - 1]?.focus();
        break;
      case 'Tab':
        e.preventDefault();
        close();
        break;
    }
  }, [isOpen, close]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Close on click/right-click outside the menu (no overlay — lets events reach elements below)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    // Use timeout so the current open() call finishes before we start listening
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [isOpen, close]);

  // Auto-focus first item on open
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
  }, [isOpen, items]);

  if (!isOpen || items.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className={s.menu}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* index keys are safe here — the items list is frozen for the lifetime
          of this open instance (re-opens close+rebuild from scratch). */}
      {items.map((entry, i) => {
        if (isDivider(entry)) {
          return <div key={i} className={s.divider} />;
        }

        const variant = entry.variant ?? 'default';
        const itemClass = `${s.item} ${variantClass[variant] ?? ''} ${entry.className ?? ''}`.trim();
        const IconComponent = entry.icon ? getIcon(entry.icon) : null;

        return (
          <button
            key={i}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => { entry.onClick(); close(); }}
            className={itemClass}
          >
            {IconComponent && <IconComponent className={s.icon} />}
            {entry.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
