import { useRef } from 'react';
import { Music, Pause, Play, Volume2, VolumeX, Volume1 } from 'lucide-react';
import { useNMMusic } from '../../hooks/useNMMusic';
import { useT } from '../../hooks/useT';
import s from './NMMusicPlayer.module.css';

export interface NMMusicPlayerProps {
  src: string;
  filename: string;
}

/**
 * Inline audio chip for chat attachments. Wraps the headless
 * `@nomercy-entertainment/nomercy-music-player` PlayerCore in a
 * Jolkr-styled horizontal layout: filename header + play / scrubber /
 * time / volume. One PlayerCore instance per attachment — fine for chat
 * usage where simultaneous tracks are rare and the queue features of the
 * full music player aren't needed.
 */
export default function NMMusicPlayer({ src, filename }: NMMusicPlayerProps) {
  const { t } = useT();
  const visualizerRef = useRef<HTMLCanvasElement>(null);
  const {
    isPlaying, currentTime, duration, bufferedAhead,
    volume, isMuted, error,
    togglePlay, seek, setVolume, toggleMute,
  } = useNMMusic({ src, filename, visualizerCanvasRef: visualizerRef });

  if (error) {
    return (
      <div className={s.errorWrap}>
        <div className={s.header}>
          <span className={s.iconWrap}><Music size={16} strokeWidth={1.6} /></span>
          <span className={s.filename}>{filename}</span>
        </div>
        <span>{error}</span>
      </div>
    );
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = bufferedAhead * 100;
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  return (
    <div className={s.wrap}>
      <canvas ref={visualizerRef} className={s.visualizer} aria-hidden />
      <div className={s.header}>
        <span className={s.iconWrap}><Music size={16} strokeWidth={1.6} /></span>
        <span className={s.filename} title={filename}>{filename}</span>
      </div>

      <div className={s.controls}>
        <button
          className={s.playBtn}
          onClick={togglePlay}
          title={isPlaying ? t('player.pause') : t('player.play')}
          aria-label={isPlaying ? t('player.pause') : t('player.play')}
        >
          {isPlaying
            ? <Pause size={16} fill="currentColor" />
            : <Play size={16} fill="currentColor" style={{ marginLeft: 1 }} />}
        </button>

        <div className={s.progressBar} onClick={handleSeekClick}>
          <div className={s.progressTrack}>
            <div className={s.progressBuffered} style={{ width: `${bufferedPct}%` }} />
            <div className={s.progressPlayed} style={{ width: `${progressPct}%` }} />
            <div className={s.progressThumb} style={{ left: `${progressPct}%` }} />
          </div>
        </div>

        <span className={s.timeLabel}>{fmt(currentTime)} / {fmt(duration)}</span>

        <div className={s.volumeWrap}>
          <button
            className={s.ctrlBtn}
            onClick={toggleMute}
            title={isMuted ? t('player.unmute') : t('player.mute')}
            aria-label={isMuted ? t('player.unmute') : t('player.mute')}
          >
            <VolumeIcon size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className={s.volumeSlider}
            aria-label={t('player.volume')}
            style={{ '--vol': `${isMuted ? 0 : volume}%` } as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const total = Math.floor(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sx = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sx.toString().padStart(2, '0')}`;
  return `${m}:${sx.toString().padStart(2, '0')}`;
}
