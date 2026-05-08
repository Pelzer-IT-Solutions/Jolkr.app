import { useEffect, useRef, useState, useCallback } from 'react';
import type { TimeData, VolumeState } from '@nomercy-entertainment/nomercy-video-player';
import { isMobile } from '../platform/detect';

interface NMPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isReady: boolean;
  isBuffering: boolean;
  /** Fraction (0–1) of the longest buffered range that ends after the
   *  current playhead. Drives the "loaded ahead" overlay on the seek bar. */
  bufferedAhead: number;
  /** Active playback speed (1 = normal). */
  playbackRate: number;
  /** Whether the player is currently in picture-in-picture mode. */
  isPip: boolean;
  error: string | null;
}

interface NMPlayerActions {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  /** Skip forward (positive) or backward (negative) seconds, clamped to 0..duration. */
  skip: (delta: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  togglePip: () => void;
  requestFullscreen: (wrapper?: HTMLElement | null) => void;
}

export interface NMPlayerResult extends NMPlayerState, NMPlayerActions {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface UseNMPlayerConfig {
  src: string;
  title?: string;
  image?: string;
  autoPlay?: boolean;
}

export function useNMPlayer(config: UseNMPlayerConfig): NMPlayerResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReturnType<typeof import('@nomercy-entertainment/nomercy-video-player').default> | null>(null);
  const idRef = useRef(`nmplayer-${Math.random().toString(36).slice(2, 9)}`);

  const [state, setState] = useState<NMPlayerState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 100,
    isMuted: false,
    isReady: false,
    isBuffering: false,
    bufferedAhead: 0,
    playbackRate: 1,
    isPip: false,
    error: null,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Set the id for NMPlayer to find the container
    el.id = idRef.current;

    let disposed = false;

    import('@nomercy-entertainment/nomercy-video-player').then((mod) => {
      if (disposed) return;

      const nmplayer = mod.default;
      try {
        const player = nmplayer(idRef.current);

        player.setup({
          playlist: [{
            id: config.src,
            title: config.title || '',
            description: '',
            file: config.src,
            image: config.image || '',
            duration: '0:00',
          }],
          controls: false,
          autoPlay: config.autoPlay ?? true,
          disableMediaControls: true,
          disableAutoPlayback: false,
          preload: 'metadata',
        });

        playerRef.current = player;

        player.on('time', (data: TimeData) => {
          setState((s) => ({
            ...s,
            currentTime: data.currentTime,
            duration: data.duration,
            bufferedAhead: computeBufferedAhead(player.videoElement, data.currentTime, data.duration),
          }));
        });

        // PiP transitions are dispatched as events on the underlying video
        // element rather than the player API. Subscribe to the standard ones
        // so our UI button reflects state.
        const pipEnter = () => setState((s) => ({ ...s, isPip: true }));
        const pipLeave = () => setState((s) => ({ ...s, isPip: false }));
        player.videoElement?.addEventListener('enterpictureinpicture', pipEnter);
        player.videoElement?.addEventListener('leavepictureinpicture', pipLeave);

        // Surface playback-rate changes that could come from the browser's
        // native video menu (right-click in some browsers) or our setter.
        const rateChange = () => {
          const rate = player.videoElement?.playbackRate ?? 1;
          setState((s) => ({ ...s, playbackRate: rate }));
        };
        player.videoElement?.addEventListener('ratechange', rateChange);

        // Update the buffered-ahead fraction as new data arrives, even when
        // playback is paused (the `time` event only fires while playing).
        const onProgress = () => {
          const v = player.videoElement;
          if (!v) return;
          setState((s) => ({
            ...s,
            bufferedAhead: computeBufferedAhead(v, v.currentTime, v.duration || s.duration),
          }));
        };
        player.videoElement?.addEventListener('progress', onProgress);

        player.on('duration', (data: TimeData) => {
          setState((s) => ({ ...s, duration: data.duration }));
        });

        player.on('play', () => {
          setState((s) => ({ ...s, isPlaying: true, isBuffering: false }));
        });

        player.on('pause', () => {
          setState((s) => ({ ...s, isPlaying: false }));
        });

        player.on('waiting', () => {
          setState((s) => ({ ...s, isBuffering: true }));
        });

        player.on('canplay', () => {
          setState((s) => ({ ...s, isBuffering: false }));
        });

        player.on('volume', (data: VolumeState) => {
          setState((s) => ({
            ...s,
            volume: data.volume,
            isMuted: data.muted,
          }));
        });

        player.on('mute', (data: VolumeState) => {
          setState((s) => ({ ...s, isMuted: data.muted }));
        });

        player.on('ready', () => {
          setState((s) => ({ ...s, isReady: true }));
        });

        player.on('error', () => {
          setState((s) => ({ ...s, error: 'Playback error' }));
        });
      } catch (e) {
        setState((s) => ({ ...s, error: (e as Error).message }));
      }
    }).catch(() => {
      if (!disposed) setState((s) => ({ ...s, error: 'Failed to load video player' }));
    });

    return () => {
      disposed = true;
      try {
        playerRef.current?.dispose();
      } catch {
        // Ignore dispose errors
      }
      playerRef.current = null;
    };
  }, [config.src, config.title, config.image, config.autoPlay]);

  const play = useCallback(() => {
    const p = playerRef.current;
    if (p) p.videoElement?.play?.();
  }, []);

  const pause = useCallback(() => {
    const p = playerRef.current;
    if (p) p.videoElement?.pause?.();
  }, []);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.videoElement?.paused) p.videoElement.play();
    else p.videoElement?.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const p = playerRef.current;
    if (p && p.videoElement) p.videoElement.currentTime = time;
  }, []);

  const skip = useCallback((delta: number) => {
    const p = playerRef.current;
    if (p && p.videoElement) {
      const next = Math.max(0, Math.min(p.videoElement.duration || 0, p.videoElement.currentTime + delta));
      p.videoElement.currentTime = next;
    }
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const p = playerRef.current;
    if (p && p.videoElement) p.videoElement.playbackRate = rate;
  }, []);

  const togglePip = useCallback(() => {
    const v = playerRef.current?.videoElement;
    if (!v) return;
    // `pictureInPictureElement` is on `document`, not the element. Browsers
    // that don't support PiP simply throw on requestPictureInPicture — swallow.
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      v.requestPictureInPicture?.().catch(() => {});
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const p = playerRef.current;
    if (p && p.videoElement) {
      p.videoElement.volume = vol / 100;
      if (vol > 0) p.videoElement.muted = false;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (p && p.videoElement) p.videoElement.muted = !p.videoElement.muted;
  }, []);

  // Pick the right fullscreen target per platform:
  // - Desktop / web: prefer the wrapper element (keeps our custom controls
  //   visible). Requesting fullscreen on a <video> directly causes the
  //   browser to overlay its native HTML5 controls.
  // - Mobile WebView (Android): the host's native fullscreen path
  //   (WebChromeClient.onShowCustomView) only fires when requestFullscreen
  //   is invoked on the actual <video> element, so we keep that order.
  const requestFullscreen = useCallback((wrapper?: HTMLElement | null) => {
    const videoTarget =
      (playerRef.current?.videoElement as HTMLElement | undefined) ??
      containerRef.current?.querySelector('video') ??
      null;
    const target = isMobile()
      ? (videoTarget ?? wrapper ?? null)
      : (wrapper ?? videoTarget);
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { });
    } else {
      target.requestFullscreen().catch(() => { });
    }
  }, []);

  return {
    containerRef,
    ...state,
    play,
    pause,
    togglePlay,
    seek,
    skip,
    setVolume,
    toggleMute,
    setPlaybackRate,
    togglePip,
    requestFullscreen,
  };
}

/**
 * Walk the video element's TimeRanges to find the longest buffered range
 * that contains (or extends past) the current playhead, then return the
 * fraction of `duration` that is already loaded ahead. Returns 0 when no
 * data is loaded around the playhead — the seek bar overlay collapses.
 */
function computeBufferedAhead(
  v: HTMLVideoElement | null | undefined,
  current: number,
  duration: number,
): number {
  if (!v || !duration || !isFinite(duration)) return 0;
  const ranges = v.buffered;
  for (let i = 0; i < ranges.length; i++) {
    const start = ranges.start(i);
    const end = ranges.end(i);
    if (current >= start && current <= end) {
      return Math.min(1, end / duration);
    }
  }
  return 0;
}
