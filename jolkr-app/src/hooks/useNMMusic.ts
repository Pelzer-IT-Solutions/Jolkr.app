import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import { takeover, release } from './playerRegistry';
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
  // Stable id for registry handoff. Random per-mount so two chips for the
  // same `src` don't collide if both are visible at once.
  const playerIdRef = useRef(`nmmusic-${Math.random().toString(36).slice(2, 9)}`);
  // Our own AudioMotion instance. Built lazily on the user's first play
  // because creating a MediaElementSource (which AudioMotion does under
  // the hood) before the audio element is ready causes errors, and the
  // AudioContext can't unsuspend without a user gesture anyway.
  const motionRef = useRef<AudioMotionAnalyzerType | null>(null);
  // Which `HTMLAudioElement` the visualiser is bound to. PlayerCore swaps
  // its `_currentAudio` instance after a track ends, so the second play
  // can hand us a fresh element while the analyser is still wired to the
  // old one — that was the cause of "visualiser goes dead on replay". On
  // each `play` event we compare and rebind when the element has changed.
  const motionAudioElRef = useRef<HTMLAudioElement | null>(null);
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
  // Set on `ended`, cleared on the next user-initiated play. Two jobs:
  //   1. Lets the engine's `play` listener detect a same-tick auto-replay
  //      attempt and suppress it (the engine sometimes ignores
  //      `disableAutoPlayback` for single-item queues and tries to loop).
  //   2. Tells `togglePlay` to call `playTrack(track)` instead of
  //      `togglePlayback()` so the engine fully reloads the source —
  //      that gives the visualiser a fresh `<audio>` element to bind
  //      to, fixing the "no bars on replay" symptom.
  const justEndedRef = useRef(false);

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
    // Snapshot the registry id at effect-mount time so the cleanup function
    // works with a stable value — calling `release()` from cleanup against
    // a `.current` lookup runs the lint rule "ref value will likely have
    // changed", and is wrong in principle: the id we registered with is
    // the one we should release.
    const playerId = playerIdRef.current;

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
          // `src` is already absolute (`useAuthedRedirectUrl` promotes it
          // for Tauri), so an empty baseUrl is correct — `path` is used
          // as-is. Keeping baseUrl = '' avoids the engine prepending
          // anything funky for any code path inside.
          baseUrl: '',
          siteTitle: 'Jolkr',
          expose: false,
          // Keep crossfade / auto-advance off — single-item "queue" for
          // a chat attachment. Engine won't fire `next` and tear down
          // the track at the very end.
          disableAutoPlayback: true,
        });

        playerRef.current = player;

        // Override any persisted repeat mode from a prior session.
        player.repeat?.('off');
        // Don't call `setAutoPlayback`: the lib assigns the param straight
        // into `disableAutoPlayback`, so `(false)` re-enables auto-play.

        const track: BasePlaylistItem = {
          name: filename,
          path: src,
          album_track: [],
          artist_track: [],
        };
        trackRef.current = track;
        trackStartedRef.current = false;
        // Don't `setQueue([track])` — `prepareCrossfade()` fires on
        // queue.length > 0 and crossfades into queue[0], looping us.

        // First user-driven play → spin up our spectrum visualiser. We
        // grab the actual HTMLAudioElement that PlayerCore is driving and
        // hand it (with our canvas) to a fresh AudioMotionAnalyzer. The
        // library creates a MediaElementSource on it, which is fine
        // because we disabled the music player's own AudioContext path
        // via the localStorage flag set above — there's no conflict.
        const setupVisualizer = async () => {
          const canvas = visualizerCanvasRef?.current;
          if (!canvas) return;
          const audioEl = (player as unknown as {
            _currentAudio?: { _audioElement?: HTMLAudioElement };
          })._currentAudio?._audioElement;
          if (!audioEl) return;
          // PlayerCore can hand us a fresh `<audio>` instance after the
          // previous track ended (its `_currentAudio` reference flips).
          // The existing AudioMotion instance is bound to the OLD element
          // via a MediaElementSource that no longer carries audio, so the
          // canvas would go silent on the replay. Rebind by tearing down
          // and recreating the analyser whenever the element identity
          // changes.
          if (motionRef.current && motionAudioElRef.current === audioEl) return;
          if (motionRef.current) {
            try { motionRef.current.destroy(); } catch { /* analyser may be half torn-down already */ }
            motionRef.current = null;
          }
          try {
            const { default: AudioMotionAnalyzer } = await import('audiomotion-analyzer');
            if (disposed || motionRef.current) return;
            motionRef.current = new AudioMotionAnalyzer({
              canvas,
              source: audioEl,
              connectSpeakers: true,
              // `overlay: true` is the difference between a transparent
              // canvas and one painted black on every resize. Without it
              // AudioMotion does `_ctx.fillRect(0, 0, w, h)` with #000
              // (see audioMotion-analyzer.js:2634-2638), which obliterates
              // our chip background — even though `bgAlpha:0` already
              // suggests transparency.
              overlay: true,
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
            // Record which element this analyser is bound to so the next
            // play can detect a swap and rebind.
            motionAudioElRef.current = audioEl;
          } catch { /* visualiser is optional — silent fallback */ }
        };

        // Belt-and-braces: force `loop = false` on the underlying audio
        // element as soon as it's materialised. PlayerCore doesn't expose
        // a public no-loop config and `disableAutoPlayback` only suppresses
        // queue advancement — without this, anything in the chain that
        // flips the `loop` attribute would silently cause a chat track to
        // restart at the end. Belongs on the `play` callback because the
        // audio element only exists after the first `playTrack(...)`.
        const enforceNoLoop = () => {
          const audioEl = (player as unknown as {
            _currentAudio?: { _audioElement?: HTMLAudioElement };
          })._currentAudio?._audioElement;
          if (audioEl) audioEl.loop = false;
        };

        player.on('play', () => {
          // Engine auto-replay guard: if `ended` fired moments ago and
          // the engine is now starting playback again on its own, this
          // is the loop we want to suppress. `togglePlay` clears the
          // flag before calling `playTrack`, so user-initiated replays
          // bypass this branch.
          if (justEndedRef.current) {
            try { playerRef.current?.pause?.(); } catch { /* ignore */ }
            return;
          }
          isPlayingRef.current = true;
          setState((s) => ({ ...s, isPlaying: true, isReady: true }));
          enforceNoLoop();
          // Singleton handoff: claim the active-player slot — every other
          // player (other audio chip, sibling video, NMVideoPlayer in this
          // chat) gets paused. The pause-callback closes over `playerRef`
          // because the engine instance might get re-set across hot-reload
          // boundaries; we always read the current ref at fire time.
          takeover({
            id: playerId,
            pause: () => playerRef.current?.pause(),
          });
          // Resume the AudioMotionAnalyzer's AudioContext if it got
          // suspended while paused. Browsers auto-suspend AudioContexts
          // after extended silence which leaves the analyser alive but
          // not painting; explicit resume() unsticks it.
          try { motionRef.current?.audioCtx?.resume?.(); } catch { /* ignore */ }
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
          //
          // `data.buffered` is a 0-100 percentage per the upstream API
          // docs, NOT seconds. Previous code divided by `duration`, which
          // produced wildly wrong fill widths on the scrubber buffered
          // overlay (a ~3min track would show ~33% buffer at 1s loaded).
          const pos = Number(data.position) || 0;
          const dur = Number(data.duration) || 0;
          const bufPct = Number(data.buffered) || 0;
          setState((s) => ({
            ...s,
            currentTime: pos,
            duration: dur,
            bufferedAhead: Math.max(0, Math.min(1, bufPct / 100)),
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
          // Mark "we just ended" so the engine's auto-replay attempt
          // (if any) gets caught by the `play` listener and paused
          // back. Cleared by `togglePlay` on the next user click —
          // there it ALSO calls `playTrack(track)` to fully reload
          // the source instead of using `togglePlayback`, so the
          // audio element gets recreated and the visualiser rebinds.
          justEndedRef.current = true;
          // Hard stop: tell the engine to pause AND reset the underlying
          // audio element's currentTime to 0 so the next click starts
          // clean from the beginning. State-only reset (the previous
          // version) left the audio element wherever it ended up — fine
          // visually but it meant a stray engine internal could restart
          // playback. Explicit pause()+rewind closes that loop.
          try { player.pause?.(); } catch { /* ignore */ }
          const audioEl = (player as unknown as {
            _currentAudio?: { _audioElement?: HTMLAudioElement };
          })._currentAudio?._audioElement;
          if (audioEl) {
            audioEl.loop = false;
            audioEl.currentTime = 0;
          }
          setState((s) => ({ ...s, isPlaying: false, currentTime: 0 }));
          release(playerId);
        });
      } catch (e) {
        setState((s) => ({ ...s, error: (e as Error).message }));
      }
    }).catch(() => {
      if (!disposed) setState((s) => ({ ...s, error: 'Failed to load music player' }));
    });

    return () => {
      disposed = true;
      release(playerId);
      try {
        // Pause first so an in-flight track stops audibly, then call the
        // engine's official `dispose()` (now part of the public API per
        // upstream docs) so it tears down its own listeners and audio
        // graph instead of relying on GC.
        playerRef.current?.pause?.();
        playerRef.current?.dispose?.();
      } catch { /* ignore */ }
      try { motionRef.current?.destroy?.(); } catch { /* ignore */ }
      motionRef.current = null;
      motionAudioElRef.current = null;
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
    const track = trackRef.current;
    if (!p) return;
    if (!trackStartedRef.current) {
      ensureTrackLoaded();
      return;
    }
    // First click after `ended`: fully reload the source instead of
    // resuming. `playTrack(track)` makes the engine create a fresh
    // audio element, which in turn lets `setupVisualizer` notice the
    // identity change and rebind the AudioMotion analyser to it. Plain
    // `togglePlayback()` would leave the analyser staring at the old
    // (now silent) element — the "no bars on replay" symptom.
    if (justEndedRef.current && track) {
      justEndedRef.current = false;
      p.playTrack(track);
      return;
    }
    // Use the engine's official togglePlayback() instead of branching on
    // our local isPlayingRef — keeps us in sync with state changes the
    // engine made internally (e.g. autoplay-blocked recovery, ended event
    // races) that we might not have observed yet.
    p.togglePlayback?.();
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
    // Use the engine's official mute()/unmute() pair instead of the old
    // setVolume(0) trick. The engine restores the prior volume internally
    // and emits the `mute` event our state listener relies on.
    const p = playerRef.current;
    if (!p) return;
    if (isPlayingRef.current) {
      // No clean state mirror for muted from here — rely on the `mute`
      // event we already subscribed to and call toggleMute().
      p.toggleMute?.();
      return;
    }
    // Even when paused the engine accepts toggleMute and queues the
    // change; calling it covers both cases.
    p.toggleMute?.();
  }, []);

  return { ...state, play, pause, togglePlay, seek, skip, setVolume, toggleMute };
}
