import { useEffect, useRef } from 'react';
import { PhoneOff, Video, User as UserIcon } from 'lucide-react';
import { useCallStore } from '../../stores/call';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useT } from '../../hooks/useT';
import s from './CallDialogs.module.css';

export default function OutgoingCallDialog() {
  const { t } = useT();
  const outgoingCall   = useCallStore((s) => s.outgoingCall);
  const cancelOutgoing = useCallStore((s) => s.cancelOutgoing);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(cardRef);

  useEffect(() => {
    if (!outgoingCall) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelOutgoing();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [outgoingCall, cancelOutgoing]);

  if (!outgoingCall) return null;

  const isVideo = outgoingCall.isVideo;
  const subtitle = isVideo ? t('call.outgoing.subtitleVideo') : t('call.outgoing.subtitleVoice');
  const ariaLabel = isVideo ? t('call.outgoing.ariaVideo') : t('call.outgoing.ariaVoice');

  return (
    <div className={s.overlay}>
      <div ref={cardRef} className={s.card} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <div className={s.avatarWrap}>
          {isVideo ? <Video size={32} strokeWidth={1.5} /> : <UserIcon size={32} strokeWidth={1.5} />}
        </div>

        <div className={s.textBlock}>
          <span className={s.title}>{outgoingCall.recipientName}</span>
          <span className={s.subtitle}>{subtitle}</span>
        </div>

        <div className={s.dots}>
          <span className={s.dot} />
          <span className={s.dot} />
          <span className={s.dot} />
        </div>

        <div className={s.actions}>
          <button
            className={`${s.btn} ${s.btnCancel}`}
            onClick={cancelOutgoing}
          >
            <PhoneOff size={16} strokeWidth={2} />
            {t('call.outgoing.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
