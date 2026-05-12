import { create } from 'zustand';
import { getAccessToken } from '../api/client';
import { getMediaWsUrl } from '../platform/config';
import { VoiceService } from '../voice/voiceService';
import type { VoiceParticipant, VoiceConnectionState } from '../voice/voiceService';

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
    try {
      const svc = getVoiceService();
      await svc.joinChannel(channelId, token, { withVideo: opts?.withVideo ?? false });
      set({ channelId, serverId, channelName, callType: opts?.withVideo ? 'video' : 'voice' });

      // Voice E2EE for DM calls: ephemeral X25519 DH + ML-KEM-768 hybrid key
      if (recipientUserId) {
        try {
          const { isE2EEReady, getLocalKeys, getRecipientBundle } = await import('../services/e2ee');
          const {
            x25519KeyAgreement, deriveHybridMessageKey, mlkemEncapsulate,
            verifySignedPreKey, verifyPQSignedPreKey,
          } = await import('../crypto/keys');
          const { x25519 } = await import('@noble/curves/ed25519.js');

          if (isE2EEReady()) {
            const localKeys = getLocalKeys();
            const bundle = await getRecipientBundle(recipientUserId);
            if (localKeys && bundle) {
              // Verify bundle signatures
              if (!verifySignedPreKey(bundle.identityKey, bundle.signedPrekey, bundle.signedPrekeySignature)) {
                throw new Error('Invalid signed prekey signature');
              }

              // Ephemeral X25519 DH (forward secrecy per call)
              const ephemeralPriv = x25519.utils.randomSecretKey();
              const classicalShared = x25519KeyAgreement(ephemeralPriv, bundle.signedPrekey);

              // ML-KEM-768 hybrid layer (quantum resistance)
              let aesKey: CryptoKey;
              if (bundle.pqSignedPrekey && bundle.pqSignedPrekeySignature) {
                if (!verifyPQSignedPreKey(bundle.identityKey, bundle.pqSignedPrekey, bundle.pqSignedPrekeySignature)) {
                  throw new Error('Invalid PQ signed prekey signature');
                }
                const { sharedSecret: pqShared } = mlkemEncapsulate(bundle.pqSignedPrekey);
                aesKey = await deriveHybridMessageKey(classicalShared, pqShared);
              } else {
                // Fallback: classical-only with ephemeral DH
                const { deriveMessageKey } = await import('../crypto/keys');
                aesKey = await deriveMessageKey(classicalShared);
              }

              const rawBytes = new Uint8Array(await crypto.subtle.exportKey('raw', aesKey));
              svc.setVoiceKey(rawBytes);
            }
          }
        } catch {
          // E2EE not available — voice continues unencrypted
        }
      }
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
    // Best-effort tear down active call; ignore errors during logout.
    if (_voiceService) {
      _voiceService.leaveChannel().catch(() => { /* noop */ });
      _voiceService = null;
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

