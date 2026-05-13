import { VoiceClient } from './voiceClient';
import { voicePrefs, type VoicePrefs } from './voicePrefs';

export interface VoiceParticipant {
  userId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isSpeaking: boolean;
  hasVideo: boolean;
}

/** Callback fired when a remote video stream becomes available (or ends). */
export type RemoteVideoListener = (userId: string, stream: MediaStream | null) => void;

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
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  private _leaving = false;

  /** Web Audio chain that lets the user scale captured mic level. */
  private inputAudioCtx: AudioContext | null = null;
  private inputGainNode: GainNode | null = null;
  /** Track sent to the peer connection — derived from `inputGainNode`. */
  private processedAudioTrack: MediaStreamTrack | null = null;
  /** Original (unscaled) capture track, kept so we can stop it on cleanup. */
  private rawAudioTrack: MediaStreamTrack | null = null;

  /** Unsubscribes from `voicePrefs` change notifications when leaving. */
  private prefsUnsub: (() => void) | null = null;

  private _state: VoiceConnectionState = 'disconnected';
  private _channelId: string | null = null;
  private _isMuted = false;
  private _isDeafened = false;
  private _withVideo = false;
  private _isCameraOn = false;
  private _isCameraUnavailable = false;
  private _cameraFacing: 'user' | 'environment' = 'user';
  private _participants = new Map<string, VoiceParticipant>();
  /** Maps a server-assigned Mid (string) to the userId whose track arrives on it. */
  private midToUserId = new Map<string, string>();

  private stateListeners = new Set<StateListener>();
  private participantsListeners = new Set<ParticipantsListener>();
  private errorListeners = new Set<ErrorListener>();
  private remoteVideoListeners = new Set<RemoteVideoListener>();
  private localVideoListeners = new Set<(stream: MediaStream | null) => void>();

  /** Web Worker for voice frame encryption/decryption (voice E2EE). */
  private encryptionWorker: Worker | null = null;

  constructor(wsUrl: string) {
    this.client = new VoiceClient(wsUrl);
  }

  get state() { return this._state; }
  get channelId() { return this._channelId; }
  get isMuted() { return this._isMuted; }
  get isDeafened() { return this._isDeafened; }
  get isCameraOn() { return this._isCameraOn; }
  get isCameraUnavailable() { return this._isCameraUnavailable; }
  get cameraFacing() { return this._cameraFacing; }
  get withVideo() { return this._withVideo; }
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

  onRemoteVideo(fn: RemoteVideoListener): () => void {
    this.remoteVideoListeners.add(fn);
    return () => { this.remoteVideoListeners.delete(fn); };
  }

  onLocalVideo(fn: (stream: MediaStream | null) => void): () => void {
    this.localVideoListeners.add(fn);
    return () => { this.localVideoListeners.delete(fn); };
  }

  private connectingTimer: ReturnType<typeof setTimeout> | null = null;

  async joinChannel(channelId: string, token: string, opts?: { withVideo?: boolean }) {
    if (this._state !== 'disconnected') {
      await this.leaveChannel();
    }

    this.setState('connecting');
    this._channelId = channelId;
    this._withVideo = opts?.withVideo ?? false;

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
      this.client.join(channelId, { withVideo: this._withVideo });
    } catch (e) {
      if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
      this.setState('disconnected');
      this._channelId = null;
      this._withVideo = false;
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
   * Toggle the local camera on/off without renegotiating. Stays in the call;
   * the remote side sees the avatar fallback (track stays in PC, just disabled).
   */
  toggleCamera() {
    if (!this._withVideo) return;
    const tracks = this.localStream?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    this._isCameraOn = !this._isCameraOn;
    for (const t of tracks) t.enabled = this._isCameraOn;
  }

  /**
   * Switch front/back camera on mobile. Acquires a new track with opposite
   * `facingMode` and replaces the existing video sender's track without
   * renegotiating. Falls back silently on failure (e.g., desktop with one cam).
   */
  async switchCamera() {
    if (!this._withVideo || !this.pc || !this.localStream) return;
    const opposite = this._cameraFacing === 'user' ? 'environment' : 'user';

    try {
      const constraints = voicePrefs.buildConstraints(true, opposite);
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: constraints.video,
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      const videoSender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (!videoSender) {
        newTrack.stop();
        return;
      }

      const oldTrack = videoSender.track;
      await videoSender.replaceTrack(newTrack);
      oldTrack?.stop();

      // Swap the track on the local stream so the local preview sees the new feed.
      if (oldTrack) this.localStream.removeTrack(oldTrack);
      this.localStream.addTrack(newTrack);
      this._cameraFacing = opposite;
      this.emitLocalVideo(this.localStream);
    } catch (e) {
      console.warn('[Voice] switchCamera failed:', (e as Error).message);
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

  /** Drop every external listener without touching the WS/RTC connection.
   *  Used during logout so a still-running async `leaveChannel()` can finish
   *  its server-side leave-notice + cleanup without any of its `setState`
   *  emits ending up back in a store that has just been reset. */
  detachListeners() {
    this.stateListeners.clear();
    this.participantsListeners.clear();
    this.errorListeners.clear();
    this.remoteVideoListeners.clear();
    this.localVideoListeners.clear();
  }

  dispose() {
    this.cleanup();
    this.detachListeners();
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
          hasVideo: (p.has_video as boolean) ?? false,
        });
        // Map server-assigned Mids back to userId so ontrack can route streams.
        const audioMid = p.audio_mid as string | undefined;
        const videoMid = p.video_mid as string | undefined;
        if (audioMid) this.midToUserId.set(audioMid, userId);
        if (videoMid) this.midToUserId.set(videoMid, userId);
      }
      this.notifyParticipants();
    }));

    this.cleanups.push(this.client.on('offer', async (d) => {
      const sdp = d.sdp as string;
      try {
        await this.ensurePeerConnection();
        await this.pc!.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
        const answer = await this.pc!.createAnswer();
        await this.pc!.setLocalDescription(answer);
        this.client.sendAnswer(answer.sdp!);
        if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
        // Don't set 'connected' yet — wait for PeerConnection to actually connect
        // The onconnectionstatechange handler will set it to 'connected'
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

    this.cleanups.push(this.client.on('iceCandidate', (d) => {
      const candidate = d.candidate as string;
      if (this.pc && candidate) {
        this.pc.addIceCandidate(new RTCIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 }))
          .catch((e) => console.warn('[Voice] Failed to add remote ICE candidate:', e));
      }
    }));

    this.cleanups.push(this.client.on('participantJoined', (d) => {
      const userId = d.user_id as string;
      this._participants.set(userId, {
        userId,
        isMuted: false,
        isDeafened: false,
        isSpeaking: false,
        hasVideo: (d.has_video as boolean) ?? false,
      });
      const audioMid = d.audio_mid as string | undefined;
      const videoMid = d.video_mid as string | undefined;
      if (audioMid) this.midToUserId.set(audioMid, userId);
      if (videoMid) this.midToUserId.set(videoMid, userId);
      this.notifyParticipants();
    }));

    this.cleanups.push(this.client.on('participantLeft', (d) => {
      const userId = d.user_id as string;
      this._participants.delete(userId);
      // Drop all mid mappings that pointed at this user.
      for (const [mid, uid] of this.midToUserId) {
        if (uid === userId) this.midToUserId.delete(mid);
      }
      // Tell consumers their video stream is gone.
      this.emitRemoteVideo(userId, null);
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

    // Acquire local media: always audio, video only when this is a video call.
    // Camera failure does NOT abort — we still try audio so voice keeps working.
    let camWorks = false;
    if (this._withVideo) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(
          voicePrefs.buildConstraints(true, this._cameraFacing),
        );
        camWorks = true;
      } catch (camErr) {
        console.warn('[Voice] Camera unavailable, falling back to audio only:', (camErr as Error).message);
        this._isCameraUnavailable = true;
      }
    }
    if (!this.localStream) {
      // Audio-only path (voice call OR video call with camera failure).
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(
          voicePrefs.buildConstraints(false),
        );
      } catch (micErr) {
        console.warn('[Voice] No microphone available, joining in listen-only mode:', (micErr as Error).message);
        this._isMuted = true;
      }
    }

    if (this.localStream) {
      // Route the audio track through a GainNode so the user-controlled
      // input volume slider is applied live without renegotiating.
      const audioTrack = this.localStream.getAudioTracks()[0];
      const tracksToSend: MediaStreamTrack[] = [];
      if (audioTrack) {
        const processed = this.buildProcessedAudioTrack(audioTrack);
        // Replace the raw audio track on the local stream so consumers
        // (including muted-state toggles) operate on the processed one.
        this.localStream.removeTrack(audioTrack);
        this.localStream.addTrack(processed);
        tracksToSend.push(processed);
      }
      for (const track of this.localStream.getVideoTracks()) tracksToSend.push(track);

      for (const track of tracksToSend) {
        const sender = this.pc.addTrack(track, this.localStream);
        // Attach encryption transform for any outgoing media (audio + video).
        if (supportsVoiceE2EE && this.encryptionWorker) {
          sender.transform = new RTCRtpScriptTransform(
            this.encryptionWorker,
            { operation: 'encrypt' },
          );
        }
      }
      this._isCameraOn = camWorks;
      if (camWorks) {
        this.emitLocalVideo(this.localStream);
      }
    }

    // Subscribe to live preference changes so volume / output sink /
    // constraints take effect during an active call.
    this.prefsUnsub?.();
    this.prefsUnsub = voicePrefs.subscribe((next) => this.applyPrefs(next));
    this.applyPrefs(voicePrefs.get());

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.client.sendIceCandidate(ev.candidate.candidate);
      }
    };

    this.pc.ontrack = (ev) => {
      // Attach decryption transform for incoming media (audio + video).
      if (supportsVoiceE2EE && this.encryptionWorker) {
        ev.receiver.transform = new RTCRtpScriptTransform(
          this.encryptionWorker,
          { operation: 'decrypt' },
        );
      }

      const mid = ev.transceiver.mid;
      const userId = mid ? this.midToUserId.get(mid) : undefined;

      if (ev.track.kind === 'audio') {
        // Headless <audio> — auto-played, never mounted in the DOM.
        const audio = new Audio();
        audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
        audio.autoplay = true;
        const prefs = voicePrefs.get();
        audio.volume = clampVolume(prefs.outputVolume);
        applySinkId(audio, prefs.audioOutputDeviceId);
        // Autoplay can be blocked by browser policy when no user gesture has
        // happened yet — that's recoverable (user clicks anything → unblock)
        // and not worth a console line. Intentional silent catch.
        audio.play().catch(() => {});
        this.audioElements.push(audio);
      } else if (ev.track.kind === 'video' && userId) {
        // Push the stream up to the React layer keyed by the originating user.
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        this.emitRemoteVideo(userId, stream);
        ev.track.onended = () => { this.emitRemoteVideo(userId, null); };
      }
    };

    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if (s === 'connected') {
        clearTimeout(this.disconnectTimer);
        if (this._state === 'connecting') {
          if (this.connectingTimer) { clearTimeout(this.connectingTimer); this.connectingTimer = null; }
          this.setState('connected');
        }
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
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
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
    clearTimeout(this.disconnectTimer);
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];

    this.prefsUnsub?.();
    this.prefsUnsub = null;

    this.audioElements.forEach((a) => { a.pause(); a.srcObject = null; });
    this.audioElements = [];

    // Notify subscribers that local video is gone before stopping tracks.
    if (this.localStream?.getVideoTracks().length) {
      this.emitLocalVideo(null);
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.rawAudioTrack?.stop();
    this.processedAudioTrack?.stop();
    this.rawAudioTrack = null;
    this.processedAudioTrack = null;
    this.inputGainNode?.disconnect();
    this.inputGainNode = null;
    if (this.inputAudioCtx) {
      // Closing an already-closed AudioContext throws InvalidStateError; this
      // path is reached on cleanup-after-cleanup. Intentional silent catch.
      this.inputAudioCtx.close().catch(() => {});
      this.inputAudioCtx = null;
    }
    this.localStream = null;
    this.midToUserId.clear();
    this._withVideo = false;
    this._isCameraOn = false;
    this._isCameraUnavailable = false;
    this._cameraFacing = 'user';

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

  private emitRemoteVideo(userId: string, stream: MediaStream | null) {
    this.remoteVideoListeners.forEach((fn) => fn(userId, stream));
  }

  private emitLocalVideo(stream: MediaStream | null) {
    this.localVideoListeners.forEach((fn) => fn(stream));
  }

  private notifyParticipants() {
    const snapshot = new Map(this._participants);
    this.participantsListeners.forEach((fn) => fn(snapshot));
  }

  /**
   * Wrap the raw capture track in a Web Audio chain so the user-controlled
   * input volume slider can scale the signal live without renegotiating.
   * The processed track is what we actually send to the peer.
   */
  private buildProcessedAudioTrack(rawTrack: MediaStreamTrack): MediaStreamTrack {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      const gain = ctx.createGain();
      gain.gain.value = clampVolume(voicePrefs.get().inputVolume);
      const dest = ctx.createMediaStreamDestination();
      source.connect(gain).connect(dest);

      const processed = dest.stream.getAudioTracks()[0];
      // Mirror the raw track's enabled state so existing mute logic (which
      // toggles `track.enabled` on local stream tracks) keeps working.
      processed.enabled = rawTrack.enabled;
      this.inputAudioCtx = ctx;
      this.inputGainNode = gain;
      this.rawAudioTrack = rawTrack;
      this.processedAudioTrack = processed;
      return processed;
    } catch (e) {
      console.warn('[Voice] Failed to build input gain chain — sending raw mic:', (e as Error).message);
      return rawTrack;
    }
  }

  /** Apply the latest preference snapshot to the active call. */
  private applyPrefs(p: VoicePrefs): void {
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = clampVolume(p.inputVolume);
    }
    const remoteVol = clampVolume(p.outputVolume);
    for (const audio of this.audioElements) {
      audio.volume = remoteVol;
      applySinkId(audio, p.audioOutputDeviceId);
    }
  }
}

/** Clamp a 0–100 slider value to a [0, 1] linear gain factor. */
function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(100, v)) / 100;
}

/** Best-effort `setSinkId` — silently no-ops on unsupported browsers. */
function applySinkId(audio: HTMLAudioElement, deviceId: string): void {
  if (!('setSinkId' in audio)) return;
  const sinkId = deviceId || 'default';
  // Type assertion: setSinkId is on the prototype only in supporting browsers.
  const setter = (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId;
  setter.call(audio, sinkId).catch(() => { /* permissions or invalid id */ });
}
