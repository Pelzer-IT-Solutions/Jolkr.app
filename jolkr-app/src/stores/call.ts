import { create } from 'zustand';
import * as api from '../api/client';
import { useVoiceStore } from './voice';
import { stopRingSound } from '../hooks/useCallEvents';

interface IncomingCall {
  dmId: string;
  callerId: string;
  callerUsername: string;
}

interface OutgoingCall {
  dmId: string;
  recipientName: string;
  recipientUserId?: string;
}

interface CallState {
  incomingCall: IncomingCall | null;
  outgoingCall: OutgoingCall | null;
  activeCallDmId: string | null;

  startCall: (dmId: string, recipientName: string, recipientUserId?: string) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  cancelOutgoing: () => Promise<void>;
  endActiveCall: () => Promise<void>;

  // WS event handlers
  handleRing: (dmId: string, callerId: string, callerUsername: string) => void;
  handleAccepted: (dmId: string) => void;
  handleRejected: (dmId: string) => void;
  handleEnded: (dmId: string) => void;

  reset: () => void;
}

const RING_TIMEOUT_MS = 60_000;
let ringTimer: ReturnType<typeof setTimeout> | null = null;

function clearRingTimer() {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
}

export const useCallStore = create<CallState>((set, get) => ({
  incomingCall: null,
  outgoingCall: null,
  activeCallDmId: null,

  startCall: async (dmId, recipientName, recipientUserId) => {
    const { activeCallDmId, outgoingCall, incomingCall } = get();
    if (activeCallDmId || outgoingCall || incomingCall) return;

    try {
      await api.initiateCall(dmId);
      set({ outgoingCall: { dmId, recipientName, recipientUserId } });

      // Auto-cancel after 60s if no answer
      clearRingTimer();
      ringTimer = setTimeout(() => {
        const state = get();
        if (state.outgoingCall?.dmId === dmId) {
          api.endCall(dmId).catch(() => {});
          set({ outgoingCall: null });
        }
      }, RING_TIMEOUT_MS);
    } catch (e) {
      console.warn('Failed to initiate call:', e);
    }
  },

  acceptIncoming: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    clearRingTimer();
    stopRingSound();
    const { dmId, callerUsername } = incomingCall;
    set({ incomingCall: null });

    try {
      await api.acceptCall(dmId);
      set({ activeCallDmId: dmId });

      // Join voice channel (dmId as channelId, serverId=null for DM calls)
      await useVoiceStore.getState().joinChannel(dmId, null, callerUsername, incomingCall.callerId);
    } catch (e) {
      console.warn('Failed to accept call:', e);
      set({ incomingCall: null, activeCallDmId: null });
    }
  },

  rejectIncoming: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    clearRingTimer();
    stopRingSound();
    try {
      await api.rejectCall(incomingCall.dmId);
    } catch (e) {
      console.warn('Failed to reject call:', e);
    }
    set({ incomingCall: null });
  },

  cancelOutgoing: async () => {
    const { outgoingCall } = get();
    if (!outgoingCall) return;

    clearRingTimer();
    try {
      await api.endCall(outgoingCall.dmId);
    } catch (e) {
      console.warn('Failed to cancel call:', e);
    }
    set({ outgoingCall: null });
  },

  endActiveCall: async () => {
    const { activeCallDmId } = get();
    if (!activeCallDmId) return;

    try {
      await api.endCall(activeCallDmId);
    } catch (e) {
      console.warn('Failed to end call:', e);
    }
    await useVoiceStore.getState().leaveChannel();
    set({ activeCallDmId: null });
  },

  // ── WS event handlers ──────────────────────────────────────────────

  handleRing: (dmId, callerId, callerUsername) => {
    const { activeCallDmId, incomingCall, outgoingCall } = get();
    // Ignore if already in a call or already ringing
    if (activeCallDmId || incomingCall || outgoingCall) return;

    set({ incomingCall: { dmId, callerId, callerUsername } });

    // Auto-reject after 60s
    clearRingTimer();
    ringTimer = setTimeout(() => {
      const state = get();
      if (state.incomingCall?.dmId === dmId) {
        stopRingSound();
        api.rejectCall(dmId).catch(() => {});
        set({ incomingCall: null });
      }
    }, RING_TIMEOUT_MS);
  },

  handleAccepted: (dmId) => {
    const { outgoingCall } = get();
    if (!outgoingCall || outgoingCall.dmId !== dmId) return;

    clearRingTimer();
    const { recipientName, recipientUserId } = outgoingCall;
    set({ outgoingCall: null, activeCallDmId: dmId });

    // Join voice channel
    useVoiceStore.getState().joinChannel(dmId, null, recipientName, recipientUserId).catch((e) => {
      console.warn('Failed to join voice after call accepted:', e);
      set({ activeCallDmId: null });
    });
  },

  handleRejected: (dmId) => {
    const { outgoingCall } = get();
    if (!outgoingCall || outgoingCall.dmId !== dmId) return;

    clearRingTimer();
    set({ outgoingCall: null });
  },

  handleEnded: (dmId) => {
    const { activeCallDmId, incomingCall, outgoingCall } = get();

    if (activeCallDmId === dmId) {
      useVoiceStore.getState().leaveChannel();
      set({ activeCallDmId: null });
      return;
    }
    if (incomingCall?.dmId === dmId) {
      clearRingTimer();
      stopRingSound();
      set({ incomingCall: null });
      return;
    }
    if (outgoingCall?.dmId === dmId) {
      clearRingTimer();
      set({ outgoingCall: null });
    }
  },

  reset: () => {
    clearRingTimer();
    stopRingSound();
    set({ incomingCall: null, outgoingCall: null, activeCallDmId: null });
  },
}));

// Sync: when voice disconnects externally (e.g. VoiceConnectionBar), clear activeCallDmId
useVoiceStore.subscribe((state, prev) => {
  if (prev.connectionState !== 'disconnected' && state.connectionState === 'disconnected') {
    const { activeCallDmId } = useCallStore.getState();
    if (activeCallDmId) {
      api.endCall(activeCallDmId).catch(() => {});
      useCallStore.setState({ activeCallDmId: null });
    }
  }
});
