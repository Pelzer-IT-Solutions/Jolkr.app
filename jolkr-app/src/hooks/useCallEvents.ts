import { useEffect } from 'react';
import { wsClient } from '../api/ws';
import { useCallStore } from '../stores/call';

let ringAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;
let ringInterval: ReturnType<typeof setInterval> | null = null;
let currentOsc: OscillatorNode | null = null;
let currentGain: GainNode | null = null;
let secondOsc: OscillatorNode | null = null;
let ringing = false;

export function getRingtoneType(): string {
  return localStorage.getItem('jolkr_ringtone') ?? 'classic';
}

function startRingSound() {
  if (ringing) return;
  ringing = true;

  const type = getRingtoneType();
  if (type === 'classic') {
    startClassicRing();
  } else {
    startToneRing();
  }
}

function startClassicRing() {
  try {
    if (!ringAudio) {
      ringAudio = new Audio(`${import.meta.env.BASE_URL}ringtone.ogg`);
      ringAudio.loop = true;
    }
    ringAudio.currentTime = 0;
    ringAudio.play().catch(() => { /* audio not available */ });
  } catch { /* audio not available */ }
}

function startToneRing() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();

    const ring = () => {
      if (!ringing || !audioCtx) return;
      const now = audioCtx.currentTime;

      currentGain = audioCtx.createGain();
      currentGain.connect(audioCtx.destination);
      currentGain.gain.setValueAtTime(0, now);
      currentGain.gain.linearRampToValueAtTime(0.08, now + 0.05);
      currentGain.gain.setValueAtTime(0.08, now + 0.35);
      currentGain.gain.linearRampToValueAtTime(0, now + 0.4);
      currentGain.gain.setValueAtTime(0, now + 0.6);
      currentGain.gain.linearRampToValueAtTime(0.08, now + 0.65);
      currentGain.gain.setValueAtTime(0.08, now + 0.95);
      currentGain.gain.linearRampToValueAtTime(0, now + 1.0);

      currentOsc = audioCtx.createOscillator();
      currentOsc.type = 'sine';
      currentOsc.frequency.setValueAtTime(440, now);
      currentOsc.connect(currentGain);
      currentOsc.start(now);
      currentOsc.stop(now + 1.0);

      secondOsc = audioCtx.createOscillator();
      secondOsc.type = 'sine';
      secondOsc.frequency.setValueAtTime(480, now);
      secondOsc.connect(currentGain);
      secondOsc.start(now);
      secondOsc.stop(now + 1.0);
    };

    ring();
    ringInterval = setInterval(ring, 3000);
  } catch { /* audio not available */ }
}

function cleanupOsc() {
  if (currentOsc) {
    try { currentOsc.stop(); } catch { /* already stopped */ }
    try { currentOsc.disconnect(); } catch { /* ok */ }
    currentOsc = null;
  }
  if (secondOsc) {
    try { secondOsc.stop(); } catch { /* already stopped */ }
    try { secondOsc.disconnect(); } catch { /* ok */ }
    secondOsc = null;
  }
  if (currentGain) {
    try { currentGain.disconnect(); } catch { /* ok */ }
    currentGain = null;
  }
}

export function stopRingSound() {
  ringing = false;
  if (ringAudio) {
    ringAudio.pause();
    ringAudio.currentTime = 0;
  }
  if (ringInterval) {
    clearInterval(ringInterval);
    ringInterval = null;
  }
  cleanupOsc();
}

export function useCallEvents() {
  const incomingCall = useCallStore((s) => s.incomingCall);

  // Start/stop ring sound based on incomingCall state
  useEffect(() => {
    if (incomingCall) {
      startRingSound();
    } else {
      stopRingSound();
    }
  }, [incomingCall]);

  // Clean up ring sound on unmount
  useEffect(() => {
    return () => stopRingSound();
  }, []);

  // Listen for WS call events
  useEffect(() => {
    const unsub = wsClient.on((op, d) => {
      const store = useCallStore.getState();

      switch (op) {
        case 'DmCallRing':
          store.handleRing(
            d.dm_id as string,
            d.caller_id as string,
            d.caller_username as string,
            (d.is_video as boolean | undefined) ?? false,
          );
          break;
        case 'DmCallAccept':
          store.handleAccepted(d.dm_id as string);
          break;
        case 'DmCallReject':
          store.handleRejected(d.dm_id as string);
          break;
        case 'DmCallEnd':
          store.handleEnded(d.dm_id as string);
          break;
      }
    });

    return unsub;
  }, []);
}
