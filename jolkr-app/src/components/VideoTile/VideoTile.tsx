import { MicOff } from 'lucide-react';
import { useEffect, useRef } from 'react';
import s from './VideoTile.module.css';

interface VideoTileProps {
  /** Live MediaStream to render. `null` shows the avatar fallback. */
  stream: MediaStream | null;
  userId: string;
  username: string;
  avatarUrl?: string;
  isMuted: boolean;
  isCameraOn: boolean;
  isSpeaking: boolean;
  /** Local self-tile: mute audio playback (avoid self-feedback) and mirror horizontally. */
  isLocal?: boolean;
  className?: string;
}

export function VideoTile({
  stream,
  username,
  avatarUrl,
  isMuted,
  isCameraOn,
  isSpeaking,
  isLocal = false,
  className,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const showVideo = isCameraOn && stream != null;
  const initial = username.charAt(0).toUpperCase() || '?';

  return (
    <div
      className={`${s.tile} ${isSpeaking ? s.speaking : ''} ${className ?? ''}`}
      data-camera-off={!showVideo}
    >
      {showVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`${s.video} ${isLocal ? s.mirrored : ''}`}
        />
      )}
      {!showVideo && (
        <div className={s.fallback}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={username} className={s.avatarImg} />
          ) : (
            <div className={s.avatarInitial}>{initial}</div>
          )}
        </div>
      )}

      <div className={s.label}>
        {isMuted && <MicOff size={12} strokeWidth={2} className={s.muteIcon} />}
        <span className={s.username}>{username}</span>
      </div>
    </div>
  );
}
