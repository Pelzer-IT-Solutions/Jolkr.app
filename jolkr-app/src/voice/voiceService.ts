import { VoiceClient } from './voiceClient';

export interface VoiceParticipant {
  userId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
}

export type VoiceConnectionState = 'disconnected' | 'connecting' | 'connected';

type StateListener = (state: VoiceConnectionState) => void;
type ParticipantsListener = (participants: Map<string, VoiceParticipant>) => void;
type ErrorListener = (message: string) => void;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/** Whether the browser supports RTCRtpScriptTransform (voice E2EE). */
const supportsVoiceE2EE = typeof RTCRtpScriptTransform !== 'undefined';

export class VoiceService {
  private client: VoiceClient;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private cleanups: Array<() => void> = [];
  private audioElements: HTMLAudioElement[] = [];
  private _leaving = false;

  private _state: VoiceConnectionState = 'disconnected';
  private _channelId: string | null = null;
  private _isMuted = false;
  private _isDeafened = false;
  private _participants = new Map<string, VoiceParticipant>();

  private stateListeners = new Set<StateListener>();
  private participantsListeners = new Set<ParticipantsListener>();
  private errorListeners = new Set<ErrorListener>();

  /** Web Worker for voice frame encryption/decryption (voice E2EE). */
  private encryptionWorker: Worker | null = null;

  constructor(wsUrl: string) {
    this.client = new VoiceClient(wsUrl);
  }

  get state() { return this._state; }
  get channelId() { return this._channelId; }
  get isMuted() { return this._isMuted; }
  get isDeafened() { return this._isDeafened; }
  get participants() { return new Map(this._participants); }

  onStateChange(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => { this.stateListeners.delete(fn); };
  }

  onParticipantsChange(fn: ParticipantsListener): () => void {
    this.participantsListeners.add(fn);
    return () => { this.participantsListeners.delete(fn); };
  }

  onError(fn: ErrorListener): () => void {
    this.errorListeners.add(fn);
    return () => { this.errorListeners.delete(fn); };
  }

  private connectingTimer: ReturnType<typeof setTimeout> | null = null;

  async joinChannel(channelId: string, token: string) {
    if (this._state !== 'disconnected') {
      await this.leaveChannel();
    }

    this.setState('connecting');
    this._channelId = channelId;

    // Timeout: if not connected within 15s, clean up
    if (this.connectingTimer) clearTimeout(this.connectingTimer);
    this.connectingTimer = setTimeout(() => {
      if (this._state === 'connecting') {
        console.warn('Voice connection timed out after 15s');
        this.emitError('Voice connection timed out');
        this.cleanup().then(() => {
          this.setState('disconnected');
          this._channelId = null;
          this._participants.clear();
          this.notifyParticipants();
        });
      }
    }, 15_000);

    try {
      await this.client.connect(token);
      this.setupListeners();
      this.client.join(channelId);
    } catch (e) {
      if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
      this.setState('disconnected');
      this._channelId = null;
      throw e;
    }
  }

  async leaveChannel() {
    if (this._leaving) return;
    this._leaving = true;
    try {
      this.client.leave();
      await this.cleanup();
      this.setState('disconnected');
      this._channelId = null;
      this._participants.clear();
      this.notifyParticipants();
    } finally {
      this._leaving = false;
    }
  }

  toggleMute() {
    this._isMuted = !this._isMuted;
    this.client.setMuted(this._isMuted);
    this.localStream?.getAudioTracks().forEach((t) => { t.enabled = !this._isMuted; });
  }

  toggleDeafen() {
    this._isDeafened = !this._isDeafened;
    this.client.setDeafened(this._isDeafened);

    if (this._isDeafened && !this._isMuted) {
      this._isMuted = true;
      this.client.setMuted(true);
      this.localStream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    } else if (!this._isDeafened && this._isMuted) {
      this._isMuted = false;
      this.client.setMuted(false);
      this.localStream?.getAudioTracks().forEach((t) => { t.enabled = true; });
    }
  }

  /**
   * Set the voice E2EE key. Pass raw AES-256 key bytes (32 bytes) to enable
   * frame encryption, or null to disable.
   */
  setVoiceKey(rawKeyBytes: Uint8Array | null) {
    if (!supportsVoiceE2EE || !this.encryptionWorker) return;

    if (rawKeyBytes) {
      // Transfer a copy of the buffer to the worker
      const copy = rawKeyBytes.slice().buffer;
      this.encryptionWorker.postMessage(
        { type: 'setKey', keyBytes: copy },
        [copy],
      );
    } else {
      this.encryptionWorker.postMessage({ type: 'clearKey' });
    }
  }

  dispose() {
    this.cleanup();
    this.stateListeners.clear();
    this.participantsListeners.clear();
    this.errorListeners.clear();
  }

  // -- Private --

  private setupListeners() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];

    this.cleanups.push(this.client.on('joined', (d) => {
      const list = (d.participants as Array<Record<string, unknown>>) ?? [];
      for (const p of list) {
        const userId = p.user_id as string;
        this._participants.set(userId, {
          userId,
          isMuted: (p.is_muted as boolean) ?? false,
          isDeafened: (p.is_deafened as boolean) ?? false,
          isSpeaking: false,
        });
      }
      this.notifyParticipants();
    }));

    this.cleanups.push(this.client.on('offer', async (d) => {
      const sdp = d.sdp as string;
      console.log('[Voice] Received SDP offer, setting up PeerConnection...');
      try {
        await this.ensurePeerConnection();
        console.log('[Voice] PeerConnection ready, setting remote description...');
        await this.pc!.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        console.log('[Voice] Remote description set, creating answer...');
        const answer = await this.pc!.createAnswer();
        await this.pc!.setLocalDescription(answer);
        console.log('[Voice] Local description set, sending answer...');
        this.client.sendAnswer(answer.sdp!);
        if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
        // Don't set 'connected' yet — wait for PeerConnection to actually connect
        // The onconnectionstatechange handler will set it to 'connected'
        console.log('[Voice] SDP answer sent, waiting for ICE to connect...');
      } catch (e) {
        const msg = (e as Error).message || 'Failed to establish voice connection';
        console.error('[Voice] Failed to handle SDP offer:', e);
        if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
        this.emitError(msg);
        this._channelId = null;
        await this.cleanup();
        this.setState('disconnected');
      }
    }));

    this.cleanups.push(this.client.on('participantJoined', (d) => {
      const userId = d.user_id as string;
      this._participants.set(userId, { userId, isMuted: false, isDeafened: false, isSpeaking: false });
      this.notifyParticipants();
    }));

    this.cleanups.push(this.client.on('participantLeft', (d) => {
      this._participants.delete(d.user_id as string);
      this.notifyParticipants();
    }));

    this.cleanups.push(this.client.on('muteUpdate', (d) => {
      const p = this._participants.get(d.user_id as string);
      if (p) { p.isMuted = d.muted as boolean; this.notifyParticipants(); }
    }));

    this.cleanups.push(this.client.on('deafenUpdate', (d) => {
      const p = this._participants.get(d.user_id as string);
      if (p) { p.isDeafened = d.deafened as boolean; this.notifyParticipants(); }
    }));

    this.cleanups.push(this.client.on('speaking', (d) => {
      const p = this._participants.get(d.user_id as string);
      if (p) { p.isSpeaking = d.speaking as boolean; this.notifyParticipants(); }
    }));

    this.cleanups.push(this.client.on('error', (d) => {
      console.warn('[Voice] WS error:', d.message, '| channelId:', this._channelId, '| state:', this._state, '| wsConnected:', this.client.isConnected, '| pcState:', this.pc?.connectionState);
      if (!this._channelId) return;
      // If the PeerConnection is still alive (connected/connecting), don't clean up.
      // The WS is only for signaling — media flows over UDP independently.
      const pcState = this.pc?.connectionState;
      if (pcState === 'connected' || pcState === 'connecting' || pcState === 'new') {
        console.log('[Voice] WS lost but PeerConnection still active, keeping voice alive');
        return;
      }
      // PeerConnection is dead or doesn't exist — clean up
      if (!this.client.isConnected && this._state !== 'disconnected') {
        this.emitError(`Voice connection lost: ${d.message}`);
        this.cleanup().then(() => {
          this.setState('disconnected');
          this._channelId = null;
          this._participants.clear();
          this.notifyParticipants();
        });
      }
    }));
  }

  private async ensurePeerConnection() {
    if (this.pc) return;

    // Create encryption worker for voice E2EE (if supported)
    if (supportsVoiceE2EE && !this.encryptionWorker) {
      try {
        this.encryptionWorker = new Worker(
          new URL('./encryptionWorker.ts', import.meta.url),
          { type: 'module' },
        );
      } catch {
        console.warn('[Voice] Failed to create encryption worker, voice E2EE disabled');
      }
    }

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Try to get microphone — if unavailable, join in listen-only mode
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of this.localStream.getAudioTracks()) {
        const sender = this.pc.addTrack(track, this.localStream);
        // Attach encryption transform for outgoing audio
        if (supportsVoiceE2EE && this.encryptionWorker) {
          sender.transform = new RTCRtpScriptTransform(
            this.encryptionWorker,
            { operation: 'encrypt' },
          );
        }
      }
    } catch (micErr) {
      console.warn('[Voice] No microphone available, joining in listen-only mode:', (micErr as Error).message);
      this._isMuted = true;
    }

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.client.sendIceCandidate(ev.candidate.candidate);
      }
    };

    this.pc.ontrack = (ev) => {
      // Attach decryption transform for incoming audio
      if (supportsVoiceE2EE && this.encryptionWorker) {
        ev.receiver.transform = new RTCRtpScriptTransform(
          this.encryptionWorker,
          { operation: 'decrypt' },
        );
      }

      const audio = new Audio();
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
      audio.autoplay = true;
      audio.play().catch(() => {});
      this.audioElements.push(audio);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log('[Voice] ICE connection state:', this.pc?.iceConnectionState);
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      console.log('[Voice] PeerConnection state:', s, '| voice state:', this._state);
      if (s === 'connected' && this._state === 'connecting') {
        if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
        this.setState('connected');
        console.log('[Voice] PeerConnection connected! Voice is live.');
      } else if (s === 'failed') {
        console.warn('PeerConnection failed');
        this.emitError('Voice connection failed');
        this.leaveChannel();
      } else if (s === 'closed') {
        console.warn('PeerConnection closed');
        this.leaveChannel();
      } else if (s === 'disconnected') {
        // 'disconnected' is often temporary (network hiccup) — wait 5s before cleanup
        console.warn('PeerConnection disconnected, waiting for recovery...');
        setTimeout(() => {
          if (this.pc?.connectionState === 'disconnected') {
            console.warn('PeerConnection still disconnected after 5s, cleaning up');
            this.emitError('Voice connection lost');
            this.leaveChannel();
          }
        }, 5000);
      }
    };
  }

  private async cleanup() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];

    this.audioElements.forEach((a) => { a.pause(); a.srcObject = null; });
    this.audioElements = [];

    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;

    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.close();
      this.pc = null;
    }

    this.client.disconnect();

    if (this.encryptionWorker) {
      this.encryptionWorker.terminate();
      this.encryptionWorker = null;
    }

    this._isMuted = false;
    this._isDeafened = false;
  }

  private setState(s: VoiceConnectionState) {
    this._state = s;
    this.stateListeners.forEach((fn) => fn(s));
  }

  private emitError(message: string) {
    this.errorListeners.forEach((fn) => fn(message));
  }

  private notifyParticipants() {
    const snapshot = new Map(this._participants);
    this.participantsListeners.forEach((fn) => fn(snapshot));
  }
}
