import { create } from 'zustand';
import { VoiceService } from '../voice/voiceService';
import type { VoiceParticipant, VoiceConnectionState } from '../voice/voiceService';
import { getMediaWsUrl } from '../platform/config';
import { getAccessToken } from '../api/client';

interface VoiceState {
  connectionState: VoiceConnectionState;
  channelId: string | null;
  serverId: string | null;
  channelName: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  participants: VoiceParticipant[];
  error: string | null;
  joinChannel: (channelId: string, serverId: string | null, channelName: string, recipientUserId?: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  clearError: () => void;
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
  }
  return _voiceService;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  connectionState: 'disconnected',
  channelId: null,
  serverId: null,
  channelName: null,
  isMuted: false,
  isDeafened: false,
  participants: [],
  error: null,

  joinChannel: async (channelId, serverId, channelName, recipientUserId) => {
    set({ error: null });
    const token = getAccessToken();
    if (!token) {
      set({ error: 'Not authenticated' });
      return;
    }
    try {
      const svc = getVoiceService();
      await svc.joinChannel(channelId, token);
      set({ channelId, serverId, channelName });

      // Voice E2EE for DM calls: pairwise X25519 DH shared key
      if (recipientUserId) {
        try {
          const { isE2EEReady, getLocalKeys, getRecipientBundle } = await import('../services/e2ee');
          const { x25519KeyAgreement, deriveMessageKey } = await import('../crypto/keys');
          if (isE2EEReady()) {
            const localKeys = getLocalKeys();
            const bundle = await getRecipientBundle(recipientUserId);
            if (localKeys && bundle) {
              const shared = x25519KeyAgreement(localKeys.signedPreKey.keyPair.privateKey, bundle.signedPrekey);
              const aesKey = await deriveMessageKey(shared);
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
      isMuted: false,
      isDeafened: false,
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

  clearError: () => {
    set({ error: null });
  },
}));

