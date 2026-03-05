import { useEffect } from 'react';
import { create } from 'zustand';

interface ToastState {
  message: string | null;
  kind: 'info' | 'success' | 'error';
  show: (message: string, kind?: 'info' | 'success' | 'error') => void;
  clear: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  show: (message, kind = 'info') => set({ message, kind }),
  clear: () => set({ message: null }),
}));

export default function Toast() {
  const message = useToast((s) => s.message);
  const kind = useToast((s) => s.kind);
  const clear = useToast((s) => s.clear);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(clear, 3000);
    return () => clearTimeout(timer);
  }, [message, clear]);

  if (!message) return null;

  const bg = kind === 'error' ? 'bg-error' : kind === 'success' ? 'bg-online' : 'bg-primary';

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-fade-in">
      <div className={`${bg} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2`}>
        {message}
        <button onClick={clear} className="ml-1 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
