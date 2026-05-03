import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { useToast } from '../stores/toast';
import s from './Toast.module.css';

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

  const toastClass = closing ? `${s.toast} ${s.closing}` : s.toast;
  const bodyClass = `${s.body} ${s[kind]}`;

  return (
    <div role="status" aria-live="polite" className={toastClass}>
      <div className={bodyClass}>
        {kind === 'success' && <CheckCircle className={s.icon} />}
        {kind === 'error' && <AlertCircle className={s.icon} />}
        {kind === 'info' && <Info className={s.icon} />}
        <span className={s.message}>{message}</span>
        <button onClick={() => setClosing(true)} className={s.dismiss} aria-label="Dismiss">
          <X className={s.dismissIcon} />
        </button>
      </div>
    </div>
  );
}
