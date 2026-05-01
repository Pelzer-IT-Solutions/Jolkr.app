import { useEffect, useRef, useState, useCallback } from 'react';
import type { TimeData, VolumeState } from '@nomercy-entertainment/nomercy-video-player';

interface NMPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isReady: boolean;
  isBuffering: boolean;
  error: string | null;
}

interface NMPlayerActions {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  requestFullscreen: (fallback?: HTMLElement | null) => void;
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
          }));
        });

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

  // Android WebView only triggers WebChromeClient.onShowCustomView (the
  // host's native fullscreen path) when requestFullscreen is called on
  // the actual <video> element. The SDK's `videoElement` field may not
  // be wired immediately, so fall back to a DOM query.
  const requestFullscreen = useCallback((fallback?: HTMLElement | null) => {
    const target =
      (playerRef.current?.videoElement as HTMLElement | undefined) ??
      containerRef.current?.querySelector('video') ??
      fallback ??
      null;
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
    setVolume,
    toggleMute,
    requestFullscreen,
  };
}
