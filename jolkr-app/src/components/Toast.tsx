import { useEffect, useState } from 'react';
import { create } from 'zustand';

interface ToastState {
  message: string | null;
  kind: 'info' | 'success' | 'error';
  duration: number;
  show: (message: string, kind?: 'info' | 'success' | 'error', duration?: number) => void;
  clear: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  duration: 3000,
  show: (message, kind = 'info', duration?: number) =>
    set({ message, kind, duration: duration ?? (kind === 'error' ? 5000 : 3000) }),
  clear: () => set({ message: null }),
}));

export default function Toast() {
  const message = useToast((s) => s.message);
  const kind = useToast((s) => s.kind);
  const duration = useToast((s) => s.duration);
  const clear = useToast((s) => s.clear);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!message) return;
    setClosing(false);
    const timer = setTimeout(() => setClosing(true), duration);
    return () => clearTimeout(timer);
  }, [message, duration]);

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => clear(), 200);
    return () => clearTimeout(timer);
  }, [closing, clear]);

  if (!message) return null;

  const bg = kind === 'error' ? 'bg-error' : kind === 'success' ? 'bg-online' : 'bg-primary';

  return (
    <div role="status" aria-live="polite" className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] ${closing ? 'animate-toast-exit' : 'animate-toast-enter'}`}>
      <div className={`${bg} text-white text-sm px-5 py-3 rounded-xl shadow-popup backdrop-blur-sm flex items-center gap-2.5 border border-white/10`}>
        {kind === 'success' && (
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="rgba(0,0,0,0.1)" />
            <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {kind === 'error' && (
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="rgba(0,0,0,0.1)" />
            <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {kind === 'info' && (
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="rgba(0,0,0,0.1)" />
            <path d="M12 16v-4m0-4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {message}
        <button onClick={() => setClosing(true)} className="ml-1 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
