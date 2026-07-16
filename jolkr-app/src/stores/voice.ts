import { create } from 'zustand';
import { getAccessToken, getVoiceToken } from '../api/client';
import { tStatic } from '../hooks/useT';
import { getMediaWsUrl } from '../platform/config';
import { VoiceService } from '../voice/voiceService';
import { useToast } from './toast';
import type { VoiceParticipant, VoiceConnectionState } from '../voice/voiceService';

/**
 * Establish the symmetric E2EE key for a DM call. Throws when a key that both
 * peers will converge on cannot be produced — the caller MUST then abort the
 * call (fail closed: never transmit unencrypted voice).
 */
async function establishVoiceKey(
  recipientUserId: string,
  e2eeSupported: boolean,
): Promise<Uint8Array> {
  // This browser can't encrypt WebRTC frames at all → we cannot guarantee E2EE.
  if (!e2eeSupported) throw new Error('voice-e2ee-unsupported');

  const { isE2EEReady, getLocalKeys, getRecipientBundle } = await import('../services/e2ee');
  const { deriveConvergentVoiceKeyBytes, verifySignedPreKey, verifyPQSignedPreKey } =
    await import('../crypto/keys');

  if (!isE2EEReady()) throw new Error('voice-e2ee-not-ready');
  const localKeys = getLocalKeys();
  const bundle = await getRecipientBundle(recipientUserId);
  if (!localKeys || !bundle) throw new Error('voice-e2ee-no-keys');

  // Verify the recipient's signed prekey against their identity key.
  if (!verifySignedPreKey(bundle.identityKey, bundle.signedPrekey, bundle.signedPrekeySignature)) {
    throw new Error('voice-e2ee-bad-signed-prekey');
  }

  // Include the post-quantum layer only when BOTH peers published a validly
  // signed ML-KEM prekey. This condition is symmetric across the two peers, so
  // they make the same hybrid-vs-classical choice and converge either way.
  let localPq: Uint8Array | undefined;
  let remotePq: Uint8Array | undefined;
  if (
    localKeys.pqSignedPreKey &&
    bundle.pqSignedPrekey &&
    bundle.pqSignedPrekeySignature &&
    verifyPQSignedPreKey(bundle.identityKey, bundle.pqSignedPrekey, bundle.pqSignedPrekeySignature)
  ) {
    localPq = localKeys.pqSignedPreKey.keyPair.encapsulationKey;
    remotePq = bundle.pqSignedPrekey;
  }

  return deriveConvergentVoiceKeyBytes({
    localSignedPrekeyPriv: localKeys.signedPreKey.keyPair.privateKey,
    remoteSignedPrekeyPub: bundle.signedPrekey,
    localPqEncapsulationKey: localPq,
    remotePqEncapsulationKey: remotePq,
  });
}

interface VoiceState {
  connectionState: VoiceConnectionState;
  channelId: string | null;
  serverId: string | null;
  channelName: string | null;
  /** `'video'` for DM video calls, `'voice'` otherwise. `null` when disconnected. */
  callType: 'voice' | 'video' | null;
  isMuted: boolean;
  isDeafened: boolean;
  isCameraOn: boolean;
  isCameraUnavailable: boolean;
  cameraFacing: 'user' | 'environment';
  /** Local camera stream (for self-preview). `null` when no camera or voice-only call. */
  localVideoStream: MediaStream | null;
  /** Remote video streams keyed by userId. */
  remoteVideoStreams: Map<string, MediaStream>;
  participants: VoiceParticipant[];
  error: string | null;
  joinChannel: (channelId: string, serverId: string | null, channelName: string, recipientUserId?: string, opts?: { withVideo?: boolean }) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => void;
  switchCamera: () => Promise<void>;
  clearError: () => void;
  /** Reset voice state (logout, store reset). Tears down VoiceService singleton too. */
  reset: () => void;
}

let _voiceService: VoiceService | null = null;
function getVoiceService(): VoiceService {
  if (!_voiceService) {
    _voiceService = new VoiceService(getMediaWsUrl());
    // Wire VoiceService events to Zustand store
    _voiceService.onStateChange((state) => {
      const update: Partial<VoiceState> = { connectionState: state };
      // When VoiceService internally goes to disconnected, clear channel info
      if (state === 'disconnected') {
        update.channelId = null;
        update.serverId = null;
        update.channelName = null;
        update.callType = null;
        update.isMuted = false;
        update.isDeafened = false;
        update.participants = [];
      }
      useVoiceStore.setState(update);
    });
    _voiceService.onParticipantsChange((participantsMap) => {
      useVoiceStore.setState({
        participants: Array.from(participantsMap.values()),
      });
    });
    _voiceService.onError((message) => {
      useVoiceStore.setState({ error: message });
    });
    _voiceService.onRemoteVideo((userId, stream) => {
      const current = new Map(useVoiceStore.getState().remoteVideoStreams);
      if (stream) {
        current.set(userId, stream);
      } else {
        current.delete(userId);
      }
      useVoiceStore.setState({ remoteVideoStreams: current });
    });
    _voiceService.onLocalVideo((stream) => {
      useVoiceStore.setState({
        localVideoStream: stream,
        isCameraOn: stream != null,
      });
    });
  }
  return _voiceService;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  connectionState: 'disconnected',
  channelId: null,
  serverId: null,
  channelName: null,
  callType: null,
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isCameraUnavailable: false,
  cameraFacing: 'user',
  localVideoStream: null,
  remoteVideoStreams: new Map(),
  participants: [],
  error: null,

  joinChannel: async (channelId, serverId, channelName, recipientUserId, opts) => {
    set({ error: null });
    const token = getAccessToken();
    if (!token) {
      set({ error: 'Not authenticated' });
      return;
    }

    const svc = getVoiceService();

    // Fail closed: for DM calls, establish the shared E2EE key BEFORE any media
    // is sent. If it cannot be established (unsupported browser, missing keys,
    // bad signatures, derivation failure), abort the entire call — voice must
    // never fall back to plaintext.
    let voiceKeyBytes: Uint8Array | null = null;
    if (recipientUserId) {
      try {
        voiceKeyBytes = await establishVoiceKey(recipientUserId, svc.e2eeSupported);
      } catch {
        set({
          error: tStatic('voice.e2eeUnavailable'),
          connectionState: 'disconnected',
          channelId: null,
          serverId: null,
          channelName: null,
          callType: null,
        });
        useToast.getState().show(tStatic('voice.e2eeUnavailable'), 'error');
        // Surface to the call store so it tears down its own call state.
        throw new Error(tStatic('voice.e2eeUnavailable'));
      }
    }

    try {
      // F01: fetch the channel-authorization token. The media server rejects
      // any Join without a valid one, so a failure here also fails closed.
      const { token: voiceToken } = await getVoiceToken(channelId);
      await svc.joinChannel(channelId, token, voiceToken, { withVideo: opts?.withVideo ?? false });
      if (voiceKeyBytes) svc.setVoiceKey(voiceKeyBytes);
      set({ channelId, serverId, channelName, callType: opts?.withVideo ? 'video' : 'voice' });
    } catch (e) {
      set({
        error: (e as Error).message || 'Failed to join voice channel',
        connectionState: 'disconnected',
        channelId: null,
        serverId: null,
        channelName: null,
        callType: null,
      });
    }
  },

  leaveChannel: async () => {
    await getVoiceService().leaveChannel();
    set({
      connectionState: 'disconnected',
      channelId: null,
      serverId: null,
      channelName: null,
      callType: null,
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isCameraUnavailable: false,
      cameraFacing: 'user',
      localVideoStream: null,
      remoteVideoStreams: new Map(),
      participants: [],
      error: null,
    });
  },

  toggleMute: () => {
    const svc = getVoiceService();
    svc.toggleMute();
    set({ isMuted: svc.isMuted, isDeafened: svc.isDeafened });
  },

  toggleDeafen: () => {
    const svc = getVoiceService();
    svc.toggleDeafen();
    set({ isMuted: svc.isMuted, isDeafened: svc.isDeafened });
  },

  toggleCamera: () => {
    const svc = getVoiceService();
    svc.toggleCamera();
    set({ isCameraOn: svc.isCameraOn });
  },

  switchCamera: async () => {
    const svc = getVoiceService();
    await svc.switchCamera();
    set({ cameraFacing: svc.cameraFacing });
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    // Order matters: detach listeners first (synchronously), THEN kick off the
    // async leaveChannel. dispose() would also call cleanup() which closes the
    // signal-WS, breaking the leave-notice that leaveChannel() needs to send.
    // With listeners detached, the in-flight leave's own cleanup + setState
    // emits land in a void — no zombie writes into the just-reset store.
    if (_voiceService) {
      const svc = _voiceService;
      _voiceService = null;
      svc.detachListeners();
      svc.leaveChannel().catch(() => { /* noop */ });
    }
    set({
      connectionState: 'disconnected',
      channelId: null,
      serverId: null,
      channelName: null,
      callType: null,
      isMuted: false,
      isDeafened: false,
      isCameraOn: false,
      isCameraUnavailable: false,
      cameraFacing: 'user',
      localVideoStream: null,
      remoteVideoStreams: new Map(),
      participants: [],
      error: null,
    });
  },
}));

