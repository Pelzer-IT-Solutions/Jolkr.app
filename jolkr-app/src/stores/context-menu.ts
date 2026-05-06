import { create } from 'zustand';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'warning';
  className?: string;
  disabled?: boolean;
}

export interface ContextMenuDivider {
  divider: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuEntry[];
  open: (x: number, y: number, items: ContextMenuEntry[]) => void;
  close: () => void;
  /** Wipe all state — called on logout to keep nothing stale for the next session. */
  reset: () => void;
}

const initialContextMenuState = {
  isOpen: false,
  x: 0,
  y: 0,
  items: [] as ContextMenuEntry[],
};

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  ...initialContextMenuState,
  open: (x, y, items) => set({ isOpen: true, x, y, items }),
  close: () => set({ isOpen: false, items: [] }),
  reset: () => set(initialContextMenuState),
}));
