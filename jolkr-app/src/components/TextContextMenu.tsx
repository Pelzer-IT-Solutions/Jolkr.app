import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Undo2, Redo2, Scissors, Copy, ClipboardPaste, Trash2, TextSelect } from 'lucide-react';
import s from './TextContextMenu.module.css';

interface MenuPosition {
  x: number;
  y: number;
  target: HTMLInputElement | HTMLTextAreaElement;
}

const icons = {
  undo: <Undo2 className={s.icon} />,
  redo: <Redo2 className={s.icon} />,
  cut: <Scissors className={s.icon} />,
  copy: <Copy className={s.icon} />,
  paste: <ClipboardPaste className={s.icon} />,
  delete: <Trash2 className={s.icon} />,
  selectAll: <TextSelect className={s.icon} />,
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
      <div
        ref={menuRef}
        className={s.menu}
        style={{ left: menu.x, top: menu.y }}
        role="menu"
      >
        {items.map((item, i) =>
          item.type === 'divider' ? (
            <div key={`divider-${i}`} className={s.divider} />
          ) : (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={item.onClick}
              className={s.item}
            >
              <span className={s.iconWrap}>{item.icon}</span>
              <span className={s.label}>{item.label}</span>
              {item.shortcut && (
                <span className={s.shortcut}>{item.shortcut}</span>
              )}
            </button>
          )
        )}
      </div>,
    document.body
  );
}
