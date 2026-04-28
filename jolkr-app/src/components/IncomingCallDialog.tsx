import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, User as UserIcon } from 'lucide-react';
import { useCallStore } from '../stores/call';
import { stopRingSound } from '../hooks/useCallEvents';
import { useFocusTrap } from '../hooks/useFocusTrap';
import s from './CallDialogs.module.css';

export default function IncomingCallDialog() {
  const incomingCall   = useCallStore((s) => s.incomingCall);
  const acceptIncoming = useCallStore((s) => s.acceptIncoming);
  const rejectIncoming = useCallStore((s) => s.rejectIncoming);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef);

  useEffect(() => {
    if (!incomingCall) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopRingSound();
        rejectIncoming();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [incomingCall, rejectIncoming]);

  if (!incomingCall) return null;

  return (
    <div className={s.overlay}>
      <div ref={cardRef} className={s.card} role="dialog" aria-modal="true" aria-label="Incoming call">
        <div className={`${s.avatarWrap} ${s.pulsing}`}>
          <UserIcon size={32} strokeWidth={1.5} />
        </div>

        <div className={s.textBlock}>
          <span className={s.title}>{incomingCall.callerUsername}</span>
          <span className={s.subtitle}>is calling…</span>
        </div>

        <div className={s.actions}>
          <button
            className={`${s.btn} ${s.btnReject}`}
            onClick={() => { stopRingSound(); rejectIncoming(); }}
          >
            <PhoneOff size={16} strokeWidth={2} />
            Decline
          </button>
          <button
            className={`${s.btn} ${s.btnAccept}`}
            onClick={() => { stopRingSound(); acceptIncoming(); }}
          >
            <Phone size={16} strokeWidth={2} />
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
