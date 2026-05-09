import { useEffect, useRef, useState, useCallback } from 'react';
import type { TimeData, VolumeState } from '@nomercy-entertainment/nomercy-video-player';
import { isMobile } from '../platform/detect';
import { takeover, release } from './playerRegistry';

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

/**
 * Wrapper around `@nomercy-entertainment/nomercy-video-player`. The engine is
 * headless — it owns a `<video>` inside our container `<div>` but draws no
 * controls — so the surrounding component layers our UI on top of the React
 * state surfaced here.
 *
 * Two key things from the working v0.9.1 implementation that the more
 * elaborate intermediate version got wrong:
 *
 *   1. **`videoElement` is created asynchronously inside `setup()`.** Any
 *      synchronous access right after `setup()` returns `undefined`, so all
 *      the `addEventListener('ended'/'progress'/'enterpictureinpicture',
 *      ...)` calls that used to live here silently never attached. The
 *      cleaner pattern is to either (a) attach inside the engine's `play`
 *      callback (which only fires after the element is live) or (b) skip
 *      the listener entirely and read the element on demand from the action
 *      callbacks. We do (b) for play/pause/seek/volume — exactly like
 *      v0.9.1 — and (a) for PiP / progress / ratechange.
 *
 *   2. **`disableAutoPlayback: true` on a freshly-set-up engine is the
 *      reason the loading spinner spun forever** — it gates the engine's
 *      first-track init, not just queue advancement. v0.9.1 used `false`,
 *      and so do we; the single-item playlist gives us "no auto-advance"
 *      for free without poking that switch.
 */
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

    el.id = idRef.current;
    const playerId = idRef.current;

    let disposed = false;
    // Listeners we'll attach to `videoElement` once it materialises (on the
    // first `ready` event). Held here so cleanup can detach the same
    // function references the engine handed back.
    const attached: { v?: HTMLVideoElement; pip?: () => void; pipLeave?: () => void; rate?: () => void; progress?: () => void; ended?: () => void } = {};

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
          // No autoplay for chat attachments — user clicks play.
          autoPlay: config.autoPlay ?? false,
          disableMediaControls: true,
          // CRITICAL: keep this `false`. Setting it `true` here gates the
          // engine's first-track init and the spinner spins forever (this
          // was the regression that broke video playback in the previous
          // refactor). The single-item playlist already prevents
          // auto-advance — there is no "next track" to advance to.
          disableAutoPlayback: false,
          preload: 'metadata',
        });

        playerRef.current = player;

        const attachVideoListeners = () => {
          const v = player.videoElement;
          if (!v || attached.v === v) return;
          attached.v = v;

          // Browser default is loop=false; force it anyway in case some
          // earlier code path flipped it on the same element.
          v.loop = false;

          attached.pip = () => setState((s) => ({ ...s, isPip: true }));
          attached.pipLeave = () => setState((s) => ({ ...s, isPip: false }));
          v.addEventListener('enterpictureinpicture', attached.pip);
          v.addEventListener('leavepictureinpicture', attached.pipLeave);

          attached.rate = () => {
            setState((s) => ({ ...s, playbackRate: v.playbackRate }));
          };
          v.addEventListener('ratechange', attached.rate);

          attached.progress = () => {
            setState((s) => ({
              ...s,
              bufferedAhead: computeBufferedAhead(v, v.currentTime, v.duration || s.duration),
            }));
          };
          v.addEventListener('progress', attached.progress);

          // The engine has no `ended` event of its own. Wire one on the
          // element so the chip parks at currentTime=0 ready for the next
          // play click. Plus belt-and-braces: explicitly pause + zero out
          // (browser default already does this, just verifying).
          attached.ended = () => {
            v.pause();
            v.currentTime = 0;
            setState((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
            release(playerId);
          };
          v.addEventListener('ended', attached.ended);
        };

        player.on('time', (data: TimeData) => {
          setState((s) => ({
            ...s,
            currentTime: data.currentTime,
            duration: data.duration,
            bufferedAhead: computeBufferedAhead(player.videoElement, data.currentTime, data.duration),
          }));
        });

        player.on('duration', (data: TimeData) => {
          setState((s) => ({ ...s, duration: data.duration }));
        });

        player.on('play', () => {
          // Engine event fires only after the element has been created AND
          // playback actually started — first safe attach point. Then claim
          // the singleton so any other player (audio chip, sibling video)
          // pauses. The pause callback drives only the engine's
          // `videoElement.pause()` — the engine emits `pause` back to us
          // and the registered listener flips state.
          attachVideoListeners();
          setState((s) => ({ ...s, isPlaying: true, isBuffering: false }));
          takeover({ id: playerId, pause: () => playerRef.current?.videoElement?.pause() });
        });

        player.on('pause', () => {
          setState((s) => ({ ...s, isPlaying: false }));
          // Don't `release()` here — a brief pause shouldn't hand the
          // singleton slot to nobody. Other players will displace us via
          // their own `play` callback when they need to.
        });

        player.on('waiting', () => {
          setState((s) => ({ ...s, isBuffering: true }));
        });

        player.on('canplay', () => {
          setState((s) => ({ ...s, isBuffering: false }));
        });

        player.on('volume', (data: VolumeState) => {
          setState((s) => ({ ...s, volume: data.volume, isMuted: data.muted }));
        });

        player.on('mute', (data: VolumeState) => {
          setState((s) => ({ ...s, isMuted: data.muted }));
        });

        player.on('ready', () => {
          // `ready` fires once the engine is set up and the source is
          // reachable. videoElement is guaranteed to exist here, even if
          // playback hasn't started yet. Attach the element-level
          // listeners now so PiP / progress / ratechange events fire even
          // before the user hits play.
          attachVideoListeners();
          setState((s) => ({ ...s, isReady: true }));
        });

        player.on('error', () => {
          setState((s) => ({ ...s, error: 'Playback error' }));
          release(playerId);
        });
      } catch (e) {
        setState((s) => ({ ...s, error: (e as Error).message }));
      }
    }).catch(() => {
      if (!disposed) setState((s) => ({ ...s, error: 'Failed to load video player' }));
    });

    return () => {
      disposed = true;
      release(playerId);
      const v = attached.v;
      if (v) {
        if (attached.pip) v.removeEventListener('enterpictureinpicture', attached.pip);
        if (attached.pipLeave) v.removeEventListener('leavepictureinpicture', attached.pipLeave);
        if (attached.rate) v.removeEventListener('ratechange', attached.rate);
        if (attached.progress) v.removeEventListener('progress', attached.progress);
        if (attached.ended) v.removeEventListener('ended', attached.ended);
      }
      try {
        playerRef.current?.dispose();
      } catch {
        // Ignore — element might already be detached.
      }
      playerRef.current = null;
    };
  }, [config.src, config.title, config.image, config.autoPlay]);

  // ── Action callbacks ────────────────────────────────────────────────
  // All read videoElement on demand. They're called from user clicks, by
  // which time the engine has long since materialised the element — no
  // need to memoise a stale reference.

  const play = useCallback(() => {
    playerRef.current?.videoElement?.play?.().catch(() => {
      // play() returns a Promise that rejects on autoplay-blocked /
      // permission-denied; nothing useful to do — the user will click
      // again, or our error handler will surface a message.
    });
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.videoElement?.pause?.();
  }, []);

  const togglePlay = useCallback(() => {
    const v = playerRef.current?.videoElement;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => { /* see play() */ });
    } else {
      v.pause();
    }
  }, []);

  const seek = useCallback((time: number) => {
    const v = playerRef.current?.videoElement;
    if (v) v.currentTime = time;
  }, []);

  const skip = useCallback((delta: number) => {
    const v = playerRef.current?.videoElement;
    if (!v) return;
    const next = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    v.currentTime = next;
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const v = playerRef.current?.videoElement;
    if (v) v.playbackRate = rate;
  }, []);

  const togglePip = useCallback(() => {
    const v = playerRef.current?.videoElement;
    if (!v) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => { });
    } else {
      v.requestPictureInPicture?.().catch(() => { });
    }
  }, []);

  const setVolume = useCallback((vol: number) => {
    const v = playerRef.current?.videoElement;
    if (!v) return;
    v.volume = vol / 100;
    if (vol > 0) v.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const v = playerRef.current?.videoElement;
    if (v) v.muted = !v.muted;
  }, []);

  const requestFullscreen = useCallback((wrapper?: HTMLElement | null) => {
    const videoTarget =
      (playerRef.current?.videoElement as HTMLElement | undefined) ??
      containerRef.current?.querySelector('video') ??
      null;
    // Mobile WebView (Android): host's onShowCustomView hook only fires when
    // requestFullscreen targets the <video> element itself — wrapper-based
    // fullscreen breaks the native immersive transition.
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
