import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';

interface MenuPosition {
  x: number;
  y: number;
  target: HTMLInputElement | HTMLTextAreaElement;
}

// Compact SVG icons (16x16, stroke-based, matching app style)
const icons = {
  undo: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
    </svg>
  ),
  redo: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
    </svg>
  ),
  cut: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path strokeLinecap="round" d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
    </svg>
  ),
  copy: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path strokeLinecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  paste: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 2h6l1 2H8L9 2z" />
      <rect x="4" y="4" width="16" height="18" rx="2" />
      <path strokeLinecap="round" d="M8 10h8M8 14h5" />
    </svg>
  ),
  delete: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  selectAll: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M8 12h8M8 8h8M8 16h5" />
    </svg>
  ),
};

export default function TextContextMenu() {
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    const target = el as HTMLInputElement | HTMLTextAreaElement;
    // Only text-like inputs
    if (el.tagName === 'INPUT') {
      const type = (target as HTMLInputElement).type;
      if (!['text', 'search', 'url', 'tel', 'password', ''].includes(type)) return;
    }
    e.preventDefault();

    const menuW = 220;
    const menuH = 300;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);

    setMenu({ x, y, target });
  }, []);

  useEffect(() => {
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [handleContextMenu]);

  // Close on outside click, scroll, or Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  if (!menu) return null;

  const { target } = menu;
  const hasSelection = target.selectionStart !== target.selectionEnd;
  const hasValue = target.value.length > 0;
  const isReadOnly = target.readOnly || target.disabled;

  const exec = (action: () => void) => {
    action();
    setMenu(null);
  };

  const handleUndo = () => exec(() => {
    target.focus();
    document.execCommand('undo');
  });

  const handleRedo = () => exec(() => {
    target.focus();
    document.execCommand('redo');
  });

  const handleCut = () => exec(() => {
    target.focus();
    if (hasSelection) {
      document.execCommand('cut');
    }
  });

  const handleCopy = () => exec(() => {
    target.focus();
    if (hasSelection) {
      document.execCommand('copy');
    }
  });

  const handlePaste = () => exec(async () => {
    target.focus();
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } catch {
      document.execCommand('paste');
    }
  });

  const handleSelectAll = () => exec(() => {
    target.focus();
    target.select();
  });

  const handleDelete = () => exec(() => {
    target.focus();
    if (hasSelection) {
      document.execCommand('delete');
    }
  });

  const items: (
    | { type: 'item'; label: string; icon: React.ReactNode; shortcut?: string; disabled: boolean; onClick: () => void }
    | { type: 'divider' }
  )[] = [
    { type: 'item', label: 'Undo', icon: icons.undo, shortcut: 'Ctrl+Z', disabled: isReadOnly, onClick: handleUndo },
    { type: 'item', label: 'Redo', icon: icons.redo, shortcut: 'Ctrl+Y', disabled: isReadOnly, onClick: handleRedo },
    { type: 'divider' },
    { type: 'item', label: 'Cut', icon: icons.cut, shortcut: 'Ctrl+X', disabled: !hasSelection || isReadOnly, onClick: handleCut },
    { type: 'item', label: 'Copy', icon: icons.copy, shortcut: 'Ctrl+C', disabled: !hasSelection, onClick: handleCopy },
    { type: 'item', label: 'Paste', icon: icons.paste, shortcut: 'Ctrl+V', disabled: isReadOnly, onClick: handlePaste },
    { type: 'item', label: 'Delete', icon: icons.delete, shortcut: 'Del', disabled: !hasSelection || isReadOnly, onClick: handleDelete },
    { type: 'divider' },
    { type: 'item', label: 'Select All', icon: icons.selectAll, shortcut: 'Ctrl+A', disabled: !hasValue, onClick: handleSelectAll },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100]" onClick={() => setMenu(null)} />
      <div
        ref={menuRef}
        className="fixed z-[101] bg-surface border border-divider rounded-lg shadow-xl py-1 min-w-50 animate-dropdown-enter backdrop-blur-sm"
        style={{ left: menu.x, top: menu.y }}
        role="menu"
      >
        {items.map((item, i) =>
          item.type === 'divider' ? (
            <div key={`divider-${i}`} className="my-1 border-t border-divider" />
          ) : (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onClick}
              className="w-full px-3 py-1.5 text-sm text-left flex items-center gap-2.5 disabled:opacity-30 disabled:cursor-default text-text-secondary hover:bg-white/5 hover:text-text-primary disabled:hover:bg-transparent disabled:hover:text-text-secondary transition-colors"
            >
              <span className="shrink-0 opacity-70">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {item.shortcut && (
                <span className="text-[11px] text-text-muted ml-auto tracking-wide">{item.shortcut}</span>
              )}
            </button>
          )
        )}
      </div>
    </>,
    document.body
  );
}
