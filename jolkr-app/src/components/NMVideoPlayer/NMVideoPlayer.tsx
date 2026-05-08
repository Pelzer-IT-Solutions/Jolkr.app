import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useNMPlayer } from '../../hooks/useNMPlayer';
import Spinner from '../ui/Spinner';
import s from './NMVideoPlayer.module.css';

export interface NMVideoPlayerProps {
  src: string;
  title?: string;
  image?: string;
  /** When true, the player auto-starts playback once ready. Default: false. */
  autoPlay?: boolean;
}

/**
 * Custom-controlled wrapper around `@nomercy-entertainment/nomercy-video-player`.
 * Used both for direct/HLS video embeds (auto-play after click-to-expand) and
 * for uploaded video attachments (no auto-play, click-to-play).
 */
export default function NMVideoPlayer({ src, title = '', image = '', autoPlay = false }: NMVideoPlayerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const {
    containerRef, isPlaying, currentTime, duration, volume, isMuted, isReady, isBuffering, error,
    togglePlay, toggleMute, seek, requestFullscreen,
  } = useNMPlayer({ src, title, image, autoPlay });
  const [showControls, setShowControls] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setShowControls(true);
    if (isPlaying) hideTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, [isPlaying]);

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const toggleFullscreen = () => {
    requestFullscreen(wrapperRef.current);
  };

  if (error) return <div className={s.errorMsg}>{error}</div>;

  // Live streams have no duration; use isReady as proxy (no progress bar).
  const isLive = duration > 0 ? false : isReady;

  return (
    <div
      ref={wrapperRef}
      className={s.wrap}
      onMouseMove={scheduleHide}
      onMouseLeave={() => { if (isPlaying) setShowControls(false); }}
    >
      <div ref={containerRef} className={s.container} onClick={togglePlay} />
      {isBuffering && <div className={s.bufferOverlay}><Spinner size="lg" /></div>}
      {isLive && <div className={s.liveBadge}><span className={s.liveDot} />LIVE</div>}
      <div className={s.controls} data-hidden={!showControls}>
        {!isLive && (
          <div className={s.progressBar} onClick={handleSeek}>
            <div className={s.progressFill} style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
          </div>
        )}
        <div className={s.controlsRow}>
          <button className={s.controlBtn} onClick={togglePlay}>
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <span className={s.timeLabel}>{isLive ? 'LIVE' : `${fmt(currentTime)} / ${fmt(duration)}`}</span>
          <div className={s.spacer} />
          <button className={s.controlBtn} onClick={toggleMute}>
            {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button className={s.controlBtn} onClick={toggleFullscreen}>
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
}
