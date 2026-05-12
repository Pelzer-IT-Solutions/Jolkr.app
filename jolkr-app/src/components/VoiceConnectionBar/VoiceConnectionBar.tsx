import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff, X } from 'lucide-react';
import { useT } from '../../hooks/useT';
import { useCallStore } from '../../stores/call';
import { useVoiceStore } from '../../stores/voice';
import s from './VoiceConnectionBar.module.css';

export function VoiceConnectionBar() {
  const { t } = useT();
  const connectionState = useVoiceStore((st) => st.connectionState);
  const channelName     = useVoiceStore((st) => st.channelName);
  const callType        = useVoiceStore((st) => st.callType);
  const isMuted         = useVoiceStore((st) => st.isMuted);
  const isDeafened      = useVoiceStore((st) => st.isDeafened);
  const error           = useVoiceStore((st) => st.error);
  const toggleMute      = useVoiceStore((st) => st.toggleMute);
  const toggleDeafen    = useVoiceStore((st) => st.toggleDeafen);
  const leaveChannel    = useVoiceStore((st) => st.leaveChannel);
  const clearError      = useVoiceStore((st) => st.clearError);

  const activeCallDmId  = useCallStore((st) => st.activeCallDmId);
  const endActiveCall   = useCallStore((st) => st.endActiveCall);

  // Show an error toast if voice failed
  if (error && connectionState === 'disconnected') {
    return (
      <div className={s.error} role="alert">
        <span>{t('call.bar.errorPrefix', { error })}</span>
        <button className={s.errorClose} onClick={clearError} aria-label={t('call.bar.dismiss')}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  }

  if (connectionState === 'disconnected') return null;
  // Video calls are owned by CallWindow (full-screen + PiP) — bar would be redundant.
  if (callType === 'video') return null;

  const isConnecting = connectionState === 'connecting';

  async function hangUp() {
    if (activeCallDmId) {
      // It's a DM call — end via call store (which leaves voice + notifies the other side)
      await endActiveCall();
    } else {
      // Server voice channel — just leave voice
      await leaveChannel();
    }
  }

  return (
    <div className={s.bar} role="status" aria-live="polite">
      <span className={`${s.statusDot} ${isConnecting ? s.connecting : ''}`} />

      <div className={s.info}>
        <span className={`${s.label} ${isConnecting ? s.connecting : ''}`}>
          {isConnecting ? t('call.bar.connecting') : t('call.bar.connected')}
        </span>
        <span className={s.channelName}>{channelName ?? t('call.bar.voiceFallback')}</span>
      </div>

      <div className={s.controls}>
        <button
          className={`${s.iconBtn} ${isMuted ? s.toggled : ''}`}
          onClick={toggleMute}
          title={isMuted ? t('call.bar.unmute') : t('call.bar.mute')}
          aria-label={isMuted ? t('call.bar.unmuteAria') : t('call.bar.muteAria')}
        >
          {isMuted ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}
        </button>
        <button
          className={`${s.iconBtn} ${isDeafened ? s.toggled : ''}`}
          onClick={toggleDeafen}
          title={isDeafened ? t('call.bar.undeafen') : t('call.bar.deafen')}
          aria-label={isDeafened ? t('call.bar.undeafen') : t('call.bar.deafen')}
        >
          {isDeafened ? <HeadphoneOff size={16} strokeWidth={1.75} /> : <Headphones size={16} strokeWidth={1.75} />}
        </button>
        <button
          className={s.leaveBtn}
          onClick={hangUp}
          title={t('call.bar.disconnect')}
          aria-label={t('call.bar.disconnectAria')}
        >
          <PhoneOff size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
