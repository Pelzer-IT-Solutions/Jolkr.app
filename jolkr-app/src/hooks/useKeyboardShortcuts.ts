import { useEffect } from 'react';

interface ShortcutActions {
  toggleSearch?: () => void;
  toggleMembers?: () => void;
  closeAll?: () => void;
}

/**
 * Global keyboard shortcuts:
 * - Ctrl+K: Toggle search
 * - Ctrl+Shift+M: Toggle member list
 * - Escape: Close open panels
 */
export function useKeyboardShortcuts({ toggleSearch, toggleMembers, closeAll }: ShortcutActions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs (except Escape)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !isInput) {
        e.preventDefault();
        toggleSearch?.();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M' && !isInput) {
        e.preventDefault();
        toggleMembers?.();
        return;
      }

      if (e.key === 'Escape' && !isInput) {
        closeAll?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSearch, toggleMembers, closeAll]);
}
