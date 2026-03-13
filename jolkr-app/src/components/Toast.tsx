import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

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
        {kind === 'success' && <CheckCircle className="w-4 h-4 shrink-0" />}
        {kind === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
        {kind === 'info' && <Info className="w-4 h-4 shrink-0" />}
        {message}
        <button onClick={() => setClosing(true)} className="ml-1 opacity-70 hover:opacity-100" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
