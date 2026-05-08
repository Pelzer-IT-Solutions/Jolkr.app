import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Maximize, Minimize, Pause, Play, Volume2, VolumeX, Volume1,
  RotateCcw, RotateCw, Settings, PictureInPicture2,
} from 'lucide-react';
import { useNMPlayer } from '../../hooks/useNMPlayer';
import { useT } from '../../hooks/useT';
import Spinner from '../ui/Spinner';
import s from './NMVideoPlayer.module.css';

export interface NMVideoPlayerProps {
  src: string;
  title?: string;
  image?: string;
  /** When true, the player auto-starts playback once ready. Default: false. */
  autoPlay?: boolean;
}

const SKIP_SECONDS = 10;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/**
 * Jolkr's player UI on top of the (headless) NoMercy player engine. The
 * engine handles playback, HLS, buffering, events; this component owns the
 * visible chrome — center play, scrubber with buffered overlay, skip ±10,
 * volume slider, settings (speed), PiP, fullscreen, keyboard shortcuts.
 */
export default function NMVideoPlayer({ src, title = '', image = '', autoPlay = false }: NMVideoPlayerProps) {
  const { t } = useT();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const {
    containerRef,
    isPlaying, currentTime, duration, volume, isMuted, isReady, isBuffering,
    bufferedAhead, playbackRate, isPip, error,
    togglePlay, toggleMute, setVolume, seek, skip, setPlaybackRate, togglePip, requestFullscreen,
  } = useNMPlayer({ src, title, image, autoPlay });

  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [scrubPreview, setScrubPreview] = useState<{ x: number; time: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  // Sync our `isFullscreen` flag with the document's fullscreen state — the
  // user can leave fullscreen via Esc / browser chrome without the button.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    setShowControls(true);
    if (isPlaying && !showSettings) {
      hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
    }
  }, [isPlaying, showSettings]);

  // Cancel auto-hide while the settings menu is open so the user can pick
  // a speed without the controls vanishing under the cursor. Settings
  // closing or playback resuming re-arms the timer; the timer callback is
  // the only thing that calls setShowControls(false), keeping this effect
  // free of synchronous render-time state mutations.
  useEffect(() => {
    clearTimeout(hideTimerRef.current);
    if (showSettings || !isPlaying) return;
    hideTimerRef.current = setTimeout(() => setShowControls(false), 2500);
    return () => clearTimeout(hideTimerRef.current);
  }, [showSettings, isPlaying]);

  // Keyboard shortcuts. Only fire when the wrapper has focus / contains
  // focus so multiple players on a page don't fight for the same keys.
  useEffect(() => {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    function onKey(e: KeyboardEvent) {
      if (!wrap || !wrap.contains(document.activeElement) && document.activeElement !== wrap) return;
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft':
          e.preventDefault(); skip(-SKIP_SECONDS); break;
        case 'ArrowRight':
          e.preventDefault(); skip(SKIP_SECONDS); break;
        case 'ArrowUp':
          e.preventDefault(); setVolume(Math.min(100, volume + 5)); break;
        case 'ArrowDown':
          e.preventDefault(); setVolume(Math.max(0, volume - 5)); break;
        case 'm':
          e.preventDefault(); toggleMute(); break;
        case 'f':
          e.preventDefault(); requestFullscreen(wrap); break;
      }
    }
    wrap.addEventListener('keydown', onKey);
    return () => wrap.removeEventListener('keydown', onKey);
  }, [togglePlay, skip, toggleMute, setVolume, requestFullscreen, volume]);

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  const handleSeekHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    setScrubPreview({ x, time: ratio * duration });
  };

  if (error) return <div className={s.errorMsg}>{error}</div>;

  // Live streams: no duration → no progress bar, show LIVE badge.
  const isLive = duration > 0 ? false : isReady;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = bufferedAhead * 100;

  // Pick the volume icon by current loudness so the muted state isn't the
  // only visual signal — full / half / mute matches every other player.
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 50 ? Volume1 : Volume2;

  return (
    <div
      ref={wrapperRef}
      className={s.wrap}
      tabIndex={0}
      onMouseMove={scheduleHide}
      onMouseLeave={() => { if (isPlaying && !showSettings) setShowControls(false); }}
      data-state={isPlaying ? 'playing' : 'paused'}
    >
      <div ref={containerRef} className={s.container} onClick={togglePlay} />

      {isBuffering && <div className={s.bufferOverlay}><Spinner size="lg" /></div>}

      {/* Big center play/pause button. Visible while paused or hovering;
         clicking the surface itself also toggles via the container above. */}
      <button
        className={s.centerBtn}
        data-visible={!isPlaying && !isBuffering}
        onClick={togglePlay}
        title={isPlaying ? t('player.pause') : t('player.play')}
        aria-label={isPlaying ? t('player.pause') : t('player.play')}
        tabIndex={-1}
      >
        {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" />}
      </button>

      {isLive && <div className={s.liveBadge}><span className={s.liveDot} />LIVE</div>}

      <div className={s.controls} data-hidden={!showControls}>
        {!isLive && (
          <div
            className={s.progressBar}
            onClick={handleSeekClick}
            onMouseMove={handleSeekHover}
            onMouseLeave={() => setScrubPreview(null)}
          >
            <div className={s.progressTrack}>
              <div className={s.progressBuffered} style={{ width: `${bufferedPct}%` }} />
              <div className={s.progressPlayed} style={{ width: `${progressPct}%` }} />
              <div className={s.progressThumb} style={{ left: `${progressPct}%` }} />
            </div>
            {scrubPreview && (
              <div className={s.scrubLabel} style={{ left: scrubPreview.x }}>
                {fmt(scrubPreview.time)}
              </div>
            )}
          </div>
        )}

        <div className={s.controlsRow}>
          <button
            className={s.ctrlBtn}
            onClick={togglePlay}
            title={isPlaying ? t('player.pause') : t('player.play')}
            aria-label={isPlaying ? t('player.pause') : t('player.play')}
          >
            {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>

          {!isLive && (
            <>
              <button
                className={s.ctrlBtn}
                onClick={() => skip(-SKIP_SECONDS)}
                title={t('player.skipBack', { seconds: SKIP_SECONDS })}
                aria-label={t('player.skipBack', { seconds: SKIP_SECONDS })}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className={s.ctrlBtn}
                onClick={() => skip(SKIP_SECONDS)}
                title={t('player.skipForward', { seconds: SKIP_SECONDS })}
                aria-label={t('player.skipForward', { seconds: SKIP_SECONDS })}
              >
                <RotateCw size={16} />
              </button>
            </>
          )}

          <div className={s.volumeWrap}>
            <button
              className={s.ctrlBtn}
              onClick={toggleMute}
              title={isMuted ? t('player.unmute') : t('player.mute')}
              aria-label={isMuted ? t('player.unmute') : t('player.mute')}
            >
              <VolumeIcon size={18} />
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

          {!isLive && (
            <span className={s.timeLabel}>{fmt(currentTime)} / {fmt(duration)}</span>
          )}
          {isLive && <span className={s.timeLabel}>LIVE</span>}

          <div className={s.spacer} />

          <div className={s.settingsWrap}>
            <button
              className={`${s.ctrlBtn} ${showSettings ? s.ctrlBtnActive : ''}`}
              onClick={() => setShowSettings(v => !v)}
              title={t('player.settings')}
              aria-label={t('player.settings')}
              aria-expanded={showSettings}
            >
              <Settings size={16} />
            </button>
            {showSettings && (
              <div className={s.settingsMenu} role="menu">
                <div className={s.settingsHeader}>{t('player.playbackSpeed')}</div>
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    role="menuitemradio"
                    aria-checked={playbackRate === rate}
                    className={`${s.settingsItem} ${playbackRate === rate ? s.settingsItemActive : ''}`}
                    onClick={() => { setPlaybackRate(rate); setShowSettings(false); }}
                  >
                    {rate === 1 ? t('player.speedNormal') : `${rate}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {document.pictureInPictureEnabled && (
            <button
              className={`${s.ctrlBtn} ${isPip ? s.ctrlBtnActive : ''}`}
              onClick={togglePip}
              title={isPip ? t('player.exitPip') : t('player.enterPip')}
              aria-label={isPip ? t('player.exitPip') : t('player.enterPip')}
            >
              <PictureInPicture2 size={16} />
            </button>
          )}

          <button
            className={s.ctrlBtn}
            onClick={() => requestFullscreen(wrapperRef.current)}
            title={isFullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
            aria-label={isFullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
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
