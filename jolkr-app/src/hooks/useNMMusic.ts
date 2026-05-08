import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import type {
  PlayerCore as PlayerCoreType,
  BasePlaylistItem,
  TimeState,
} from '@nomercy-entertainment/nomercy-music-player';
import type AudioMotionAnalyzerType from 'audiomotion-analyzer';

interface NMMusicState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  bufferedAhead: number;
  volume: number;
  isMuted: boolean;
  isReady: boolean;
  error: string | null;
}

interface NMMusicActions {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (delta: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
}

export interface NMMusicResult extends NMMusicState, NMMusicActions {}

interface UseNMMusicConfig {
  src: string;
  filename: string;
  /**
   * Optional canvas to render the spectrum visualisation into. The
   * underlying PlayerCore feeds it through audiomotion-analyzer; pass a
   * canvas ref from the surrounding component to enable, leave undefined
   * to opt out.
   */
  visualizerCanvasRef?: RefObject<HTMLCanvasElement | null>;
}

/**
 * Single-track wrapper around the headless `@nomercy-entertainment/nomercy-music-player`
 * PlayerCore. Each chat audio attachment instantiates one PlayerCore loaded
 * with a one-item playlist. The hook lifts the parts of player state our
 * Jolkr-themed inline chip cares about; the surrounding music-player
 * features (queue, EQ, crossfade) are deliberately untouched — they're not
 * relevant to a chat attachment.
 */
export function useNMMusic({ src, filename, visualizerCanvasRef }: UseNMMusicConfig): NMMusicResult {
  const playerRef = useRef<PlayerCoreType<BasePlaylistItem> | null>(null);
  // Our own AudioMotion instance. Built lazily on the user's first play
  // because creating a MediaElementSource (which AudioMotion does under
  // the hood) before the audio element is ready causes errors, and the
  // AudioContext can't unsuspend without a user gesture anyway.
  const motionRef = useRef<AudioMotionAnalyzerType | null>(null);
  // Mirror isPlaying into a ref so togglePlay's stable callback can read
  // the current value without re-creating on every render. The library
  // also exposes an `isPlaying()` method, but TS can't disambiguate it
  // from the `isPlaying: boolean` property in the same class hierarchy.
  const isPlayingRef = useRef(false);
  // The PlayerCore engine doesn't load the source URL into its audio
  // element until `playTrack(item)` is called — `setQueue` alone leaves
  // the queue prepared but cold, so a bare `play()` before that happens
  // is a no-op. We hold the queue item here and lazy-call playTrack on
  // the first toggle so the user-initiated click is what actually starts
  // playback (no autoplay, no pre-fetch on mount).
  const trackRef = useRef<BasePlaylistItem | null>(null);
  const trackStartedRef = useRef(false);

  const [state, setState] = useState<NMMusicState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    bufferedAhead: 0,
    volume: 100,
    isMuted: false,
    isReady: false,
    error: null,
  });

  useEffect(() => {
    let disposed = false;

    // Bypass the music player's built-in spectrum analyser. The wrapper
    // ignores our canvas option in some paths and ends up appending its
    // own analyzer canvas to <body>, hidden via inline opacity:0. We
    // own the visualisation instead — see the visualizer effect below
    // — so we tell the engine to skip its own AudioContext setup
    // entirely. (This also keeps the music player out of the
    // MediaElementSource business so we can claim the audio element
    // ourselves without the "already connected" InvalidStateError.)
    try { localStorage.setItem('nmplayer-music-supports-audio-context', 'false'); } catch { /* ignore */ }

    import('@nomercy-entertainment/nomercy-music-player').then((mod) => {
      if (disposed) return;
      try {
        const player = new mod.PlayerCore<BasePlaylistItem>({
          // Use absolute paths in playlist.path (the chat blob: URLs are
          // already absolute) so an empty baseUrl is correct.
          baseUrl: '',
          siteTitle: 'Jolkr',
          expose: false,
          // Keep crossfade/auto-advance off — single-item playlist, no
          // queue. Avoids the player firing `next` and tearing down the
          // track at the very end.
          disableAutoPlayback: true,
        });

        playerRef.current = player;

        const track: BasePlaylistItem = {
          name: filename,
          path: src,
          album_track: [],
          artist_track: [],
        };
        trackRef.current = track;
        trackStartedRef.current = false;
        player.setQueue([track]);

        // First user-driven play → spin up our spectrum visualiser. We
        // grab the actual HTMLAudioElement that PlayerCore is driving and
        // hand it (with our canvas) to a fresh AudioMotionAnalyzer. The
        // library creates a MediaElementSource on it, which is fine
        // because we disabled the music player's own AudioContext path
        // via the localStorage flag set above — there's no conflict.
        const setupVisualizer = async () => {
          if (motionRef.current) return;
          const canvas = visualizerCanvasRef?.current;
          if (!canvas) return;
          const audioEl = (player as unknown as {
            _currentAudio?: { _audioElement?: HTMLAudioElement };
          })._currentAudio?._audioElement;
          if (!audioEl) return;
          try {
            const { default: AudioMotionAnalyzer } = await import('audiomotion-analyzer');
            if (disposed || motionRef.current) return;
            motionRef.current = new AudioMotionAnalyzer({
              canvas,
              source: audioEl,
              connectSpeakers: true,
              mode: 2,
              bgAlpha: 0,
              showBgColor: false,
              showScaleX: false,
              showScaleY: false,
              showPeaks: false,
              alphaBars: true,
              fillAlpha: 0.6,
              barSpace: 0.4,
              smoothing: 0.7,
              reflexRatio: 0.25,
              reflexAlpha: 0.2,
              gradient: 'classic',
            });
          } catch { /* visualiser is optional — silent fallback */ }
        };

        player.on('play', () => {
          isPlayingRef.current = true;
          setState((s) => ({ ...s, isPlaying: true, isReady: true }));
          // Lazy-init on the first play so the AudioContext gets the
          // user gesture it needs to leave the suspended state.
          void setupVisualizer();
        });
        player.on('pause', () => {
          isPlayingRef.current = false;
          setState((s) => ({ ...s, isPlaying: false }));
        });
        player.on('time', (data: TimeState) => {
          // The library types `position`/`duration` as `any`; coerce to
          // number defensively (a transient NaN during seek would otherwise
          // poison the React state).
          const pos = Number(data.position) || 0;
          const dur = Number(data.duration) || 0;
          setState((s) => ({
            ...s,
            currentTime: pos,
            duration: dur,
            bufferedAhead: dur > 0 ? Math.min(1, (Number(data.buffered) || 0) / dur) : 0,
          }));
        });
        player.on('volume', (vol: number) => {
          setState((s) => ({ ...s, volume: vol }));
        });
        player.on('mute', (m: boolean) => {
          setState((s) => ({ ...s, isMuted: m }));
        });
        player.on('ready', () => {
          setState((s) => ({ ...s, isReady: true }));
        });
        player.on('ended', () => {
          isPlayingRef.current = false;
          setState((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
        });
      } catch (e) {
        setState((s) => ({ ...s, error: (e as Error).message }));
      }
    }).catch(() => {
      if (!disposed) setState((s) => ({ ...s, error: 'Failed to load music player' }));
    });

    return () => {
      disposed = true;
      try {
        // PlayerCore's dispose isn't part of the public surface; the
        // underlying audio element is reclaimed by GC once the ref drops.
        // Pause first so an in-flight track stops audibly.
        playerRef.current?.pause?.();
      } catch { /* ignore */ }
      try { motionRef.current?.destroy?.(); } catch { /* ignore */ }
      motionRef.current = null;
      playerRef.current = null;
    };
    // visualizerCanvasRef is included for the lint rule; the ref object
    // itself is stable across renders so this never re-fires on `.current`
    // updates (which is the desired behaviour — the visualiser binds at
    // mount time and the canvas element doesn't get swapped underneath).
  }, [src, filename, visualizerCanvasRef]);

  // Pre-fetch the duration via a throwaway <audio preload="metadata"> so
  // the chip can show "0:00 / 3:42" before the user clicks play. The
  // PlayerCore engine doesn't load the source until playTrack() is
  // called (deliberate — we don't want autoplay), so without this probe
  // duration would stay at 0:00 / 0:00 until first interaction.
  useEffect(() => {
    const probe = new Audio();
    probe.preload = 'metadata';
    const onMeta = () => {
      const d = Number(probe.duration);
      if (isFinite(d) && d > 0) {
        setState((s) => (s.duration > 0 ? s : { ...s, duration: d }));
      }
    };
    probe.addEventListener('loadedmetadata', onMeta);
    probe.src = src;
    return () => {
      probe.removeEventListener('loadedmetadata', onMeta);
      probe.src = '';
    };
  }, [src]);

  const ensureTrackLoaded = useCallback(() => {
    if (trackStartedRef.current) return;
    const p = playerRef.current;
    const track = trackRef.current;
    if (!p || !track) return;
    p.playTrack(track);
    trackStartedRef.current = true;
  }, []);
  const play = useCallback(() => {
    if (!trackStartedRef.current) ensureTrackLoaded();
    else playerRef.current?.play?.();
  }, [ensureTrackLoaded]);
  const pause = useCallback(() => { playerRef.current?.pause?.(); }, []);
  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (!trackStartedRef.current) {
      ensureTrackLoaded();
      return;
    }
    if (isPlayingRef.current) p.pause(); else p.play();
  }, [ensureTrackLoaded]);
  const seek = useCallback((time: number) => { playerRef.current?.seek?.(time); }, []);
  const skip = useCallback((delta: number) => {
    const p = playerRef.current;
    if (!p) return;
    const data = p.getTimeData?.();
    const cur = Number(data?.position) || 0;
    const dur = Number(data?.duration) || 0;
    const next = Math.max(0, Math.min(dur || cur + delta, cur + delta));
    p.seek?.(next);
  }, []);
  const setVolume = useCallback((vol: number) => { playerRef.current?.setVolume?.(vol); }, []);
  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    // Library exposes mute via volume → 0 toggle on most builds; fall back
    // safely if a `mute()` method isn't present.
    const cur = (p as unknown as { volume?: number }).volume ?? 100;
    if (cur > 0) {
      (p as unknown as { _lastVolume?: number })._lastVolume = cur;
      p.setVolume?.(0);
    } else {
      const last = (p as unknown as { _lastVolume?: number })._lastVolume ?? 100;
      p.setVolume?.(last);
    }
  }, []);

  return { ...state, play, pause, togglePlay, seek, skip, setVolume, toggleMute };
}
