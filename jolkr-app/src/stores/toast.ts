import { create } from 'zustand'

interface ToastState {
  message: string | null
  kind: 'info' | 'success' | 'error'
  duration: number
  show: (message: string, kind?: 'info' | 'success' | 'error', duration?: number) => void
  clear: () => void
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  duration: 3000,
  show: (message, kind = 'info', duration?: number) =>
    set({ message, kind, duration: duration ?? (kind === 'error' ? 5000 : 3000) }),
  clear: () => set({ message: null }),
}))
