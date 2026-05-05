import { useState } from 'react';
import { Mic, MicOff, Video, VideoOff, RefreshCw, PhoneOff, Minimize2 } from 'lucide-react';
import { useVoiceStore } from '../../stores/voice';
import { useCallStore } from '../../stores/call';
import { useAuthStore } from '../../stores/auth';
import { useViewport } from '../../hooks/useViewport';
import { VideoTile } from '../VideoTile/VideoTile';
import { CallPipWindow } from '../CallPipWindow/CallPipWindow';
import s from './CallWindow.module.css';

export function CallWindow() {
  const [isMinimized, setIsMinimized] = useState(false);

  const callType        = useVoiceStore((st) => st.callType);
  const connectionState = useVoiceStore((st) => st.connectionState);
  const channelName     = useVoiceStore((st) => st.channelName);
  const localVideoStream  = useVoiceStore((st) => st.localVideoStream);
  const remoteVideoStreams = useVoiceStore((st) => st.remoteVideoStreams);
  const participants    = useVoiceStore((st) => st.participants);
  const isMuted         = useVoiceStore((st) => st.isMuted);
  const isCameraOn      = useVoiceStore((st) => st.isCameraOn);
  const isCameraUnavailable = useVoiceStore((st) => st.isCameraUnavailable);
  const toggleMute      = useVoiceStore((st) => st.toggleMute);
  const toggleCamera    = useVoiceStore((st) => st.toggleCamera);
  const switchCamera    = useVoiceStore((st) => st.switchCamera);

  const endActiveCall   = useCallStore((st) => st.endActiveCall);
  const user            = useAuthStore((st) => st.user);
  const { isMobile }    = useViewport();

  if (callType !== 'video' || connectionState === 'disconnected') return null;

  // 1-on-1: the single other participant is the remote.
  const remote = participants[0];
  const remoteStream = remote ? remoteVideoStreams.get(remote.userId) ?? null : null;
  const remoteName = channelName ?? 'Connecting…';

  if (isMinimized) {
    return (
      <CallPipWindow
        remoteStream={remoteStream}
        remoteName={remoteName}
        remoteUserId={remote?.userId ?? ''}
        remoteIsMuted={remote?.isMuted ?? false}
        remoteIsCameraOn={(remote?.hasVideo ?? false) && remoteStream != null}
        remoteIsSpeaking={remote?.isSpeaking ?? false}
        onExpand={() => setIsMinimized(false)}
        onHangup={endActiveCall}
      />
    );
  }

  return (
    <div className={s.overlay} role="dialog" aria-label="Video call">
      <div className={s.stage}>
        <VideoTile
          stream={remoteStream}
          userId={remote?.userId ?? ''}
          username={remoteName}
          avatarUrl={undefined}
          isMuted={remote?.isMuted ?? false}
          isCameraOn={(remote?.hasVideo ?? false) && remoteStream != null}
          isSpeaking={remote?.isSpeaking ?? false}
          className={s.remoteTile}
        />

        <div className={s.selfTile}>
          <VideoTile
            stream={localVideoStream}
            userId={user?.id ?? 'self'}
            username={user?.display_name ?? user?.username ?? 'You'}
            avatarUrl={user?.avatar_url ?? undefined}
            isMuted={isMuted}
            isCameraOn={isCameraOn}
            isSpeaking={false}
            isLocal
          />
        </div>
      </div>

      <div className={s.controls}>
        <button
          className={`${s.ctrlBtn} ${isMuted ? s.toggled : ''}`}
          onClick={toggleMute}
          title={isMuted ? 'Unmute' : 'Mute'}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff size={20} strokeWidth={1.75} /> : <Mic size={20} strokeWidth={1.75} />}
        </button>

        <button
          className={`${s.ctrlBtn} ${!isCameraOn ? s.toggled : ''}`}
          onClick={toggleCamera}
          disabled={isCameraUnavailable}
          title={isCameraUnavailable ? 'Camera unavailable' : isCameraOn ? 'Turn camera off' : 'Turn camera on'}
          aria-label={isCameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {isCameraOn ? <Video size={20} strokeWidth={1.75} /> : <VideoOff size={20} strokeWidth={1.75} />}
        </button>

        {isMobile && (
          <button
            className={s.ctrlBtn}
            onClick={() => { switchCamera(); }}
            disabled={!isCameraOn}
            title="Switch camera"
            aria-label="Switch camera"
          >
            <RefreshCw size={20} strokeWidth={1.75} />
          </button>
        )}

        <button
          className={s.ctrlBtn}
          onClick={() => setIsMinimized(true)}
          title="Minimize to picture-in-picture"
          aria-label="Minimize"
        >
          <Minimize2 size={20} strokeWidth={1.75} />
        </button>

        <button
          className={s.hangupBtn}
          onClick={endActiveCall}
          title="End call"
          aria-label="End call"
        >
          <PhoneOff size={22} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
