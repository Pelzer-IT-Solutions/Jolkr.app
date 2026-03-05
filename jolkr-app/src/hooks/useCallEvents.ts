import { useEffect } from 'react';
import { wsClient } from '../api/ws';
import { useCallStore } from '../stores/call';

let audioCtx: AudioContext | null = null;
let ringInterval: ReturnType<typeof setInterval> | null = null;
let currentOsc: OscillatorNode | null = null;
let currentGain: GainNode | null = null;
let ringing = false;

function startRingSound() {
  if (ringing) return;
  ringing = true;
  try {
    if (!audioCtx) audioCtx = new AudioContext();

    let on = true;
    const pulse = () => {
      if (!ringing || !audioCtx) {
        cleanupOsc();
        return;
      }
      if (on) {
        cleanupOsc();
        currentGain = audioCtx.createGain();
        currentGain.connect(audioCtx.destination);
        currentGain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        currentOsc = audioCtx.createOscillator();
        currentOsc.connect(currentGain);
        currentOsc.type = 'sine';
        currentOsc.frequency.setValueAtTime(440, audioCtx.currentTime);
        currentOsc.start();
      } else {
        cleanupOsc();
      }
      on = !on;
    };

    pulse();
    ringInterval = setInterval(pulse, 500);
  } catch { /* audio not available */ }
}

function cleanupOsc() {
  if (currentOsc) {
    try { currentOsc.stop(); } catch { /* already stopped */ }
    try { currentOsc.disconnect(); } catch { /* ok */ }
    currentOsc = null;
  }
  if (currentGain) {
    try { currentGain.disconnect(); } catch { /* ok */ }
    currentGain = null;
  }
}

export function stopRingSound() {
  ringing = false;
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
