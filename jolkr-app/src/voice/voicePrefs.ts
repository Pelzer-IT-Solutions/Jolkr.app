import { useEffect, useState, useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { LOCAL_PREF_EVENT, notifyLocalPrefChange } from '../hooks/useLocalStorageBoolean';

/**
 * Persisted voice/video preferences. Stored in `localStorage` because device
 * IDs are inherently per-machine and shouldn't sync across sessions of the
 * same user on different devices.
 */
export interface VoicePrefs {
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  videoInputDeviceId: string;
  /** 0–100. Linear gain on the captured microphone signal. */
  inputVolume: number;
  /** 0–100. Linear gain on remote-audio playback. */
  outputVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
}

const DEFAULTS: VoicePrefs = {
  audioInputDeviceId: '',
  audioOutputDeviceId: '',
  videoInputDeviceId: '',
  inputVolume: 100,
  outputVolume: 100,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: false,
};

const KEYS: Record<keyof VoicePrefs, string> = {
  audioInputDeviceId:  STORAGE_KEYS.AUDIO_INPUT_DEVICE,
  audioOutputDeviceId: STORAGE_KEYS.AUDIO_OUTPUT_DEVICE,
  videoInputDeviceId:  STORAGE_KEYS.VIDEO_INPUT_DEVICE,
  inputVolume:         STORAGE_KEYS.INPUT_VOLUME,
  outputVolume:        STORAGE_KEYS.OUTPUT_VOLUME,
  noiseSuppression:    STORAGE_KEYS.NOISE_SUPPRESSION,
  echoCancellation:    STORAGE_KEYS.ECHO_CANCELLATION,
  autoGainControl:     STORAGE_KEYS.AUTO_GAIN_CONTROL,
};

function readKey<K extends keyof VoicePrefs>(key: K): VoicePrefs[K] {
  const storageKey = KEYS[key];
  const fallback = DEFAULTS[key];
  let raw: string | null = null;
  try { raw = localStorage.getItem(storageKey); } catch { /* disabled */ }
  if (raw === null) return fallback;
  if (typeof fallback === 'boolean') {
    return (raw !== 'false') as VoicePrefs[K];
  }
  if (typeof fallback === 'number') {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as VoicePrefs[K];
  }
  return raw as VoicePrefs[K];
}

function writeKey<K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]): void {
  try { localStorage.setItem(KEYS[key], String(value)); } catch { /* disabled */ }
}

type Listener = (prefs: VoicePrefs) => void;
const listeners = new Set<Listener>();

function snapshot(): VoicePrefs {
  return {
    audioInputDeviceId:  readKey('audioInputDeviceId'),
    audioOutputDeviceId: readKey('audioOutputDeviceId'),
    videoInputDeviceId:  readKey('videoInputDeviceId'),
    inputVolume:         readKey('inputVolume'),
    outputVolume:        readKey('outputVolume'),
    noiseSuppression:    readKey('noiseSuppression'),
    echoCancellation:    readKey('echoCancellation'),
    autoGainControl:     readKey('autoGainControl'),
  };
}

let cached: VoicePrefs = snapshot();

function emit(): void {
  cached = snapshot();
  for (const fn of listeners) fn(cached);
}

// Same-tab updates from the hook setter.
window.addEventListener(LOCAL_PREF_EVENT, (e: Event) => {
  if (!(e instanceof CustomEvent)) return;
  const k = e.detail?.key as string | undefined;
  if (!k) return;
  for (const storageKey of Object.values(KEYS)) {
    if (storageKey === k) { emit(); return; }
  }
});
// Cross-tab updates.
window.addEventListener('storage', (e) => {
  if (!e.key) return;
  for (const storageKey of Object.values(KEYS)) {
    if (storageKey === e.key) { emit(); return; }
  }
});

export const voicePrefs = {
  /** Read the latest snapshot synchronously. */
  get(): VoicePrefs { return cached; },

  /** Update one preference and broadcast the change. */
  set<K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]): void {
    writeKey(key, value);
    notifyLocalPrefChange(KEYS[key]);
    emit();
  },

  /** Subscribe to any change. Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  /**
   * Build `MediaStreamConstraints` matching the current user prefs. Pass
   * `withVideo` to include a video constraint.
   */
  buildConstraints(withVideo: boolean, facingMode: 'user' | 'environment' = 'user'): MediaStreamConstraints {
    const p = cached;
    return {
      audio: {
        deviceId: p.audioInputDeviceId ? { exact: p.audioInputDeviceId } : undefined,
        noiseSuppression: p.noiseSuppression,
        echoCancellation: p.echoCancellation,
        autoGainControl:  p.autoGainControl,
      },
      video: withVideo ? {
        deviceId: p.videoInputDeviceId ? { exact: p.videoInputDeviceId } : undefined,
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode,
      } : false,
    };
  },
};

/** React hook returning the current `VoicePrefs` snapshot. */
export function useVoicePrefs(): VoicePrefs {
  return useSyncExternalStore(voicePrefs.subscribe, voicePrefs.get, voicePrefs.get);
}

/**
 * React hook that enumerates available media devices and refreshes when the
 * device list changes. Returns empty arrays until the first enumeration
 * resolves; labels are only present after the user has granted permission
 * for at least one matching kind.
 */
export function useVoiceMediaDevices(): {
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
} {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;

    let cancelled = false;
    const refresh = () => {
      md.enumerateDevices().then((list) => {
        if (!cancelled) setDevices(list);
      }).catch(() => { /* ignore — usually permission denied */ });
    };
    refresh();
    md.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      md.removeEventListener('devicechange', refresh);
    };
  }, []);

  return {
    audioInputs:  devices.filter((d) => d.kind === 'audioinput'),
    audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
    videoInputs:  devices.filter((d) => d.kind === 'videoinput'),
  };
}

/** True when the browser supports `HTMLAudioElement.setSinkId`. */
export function useOutputSinkSupported(): boolean {
  return typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype;
}
