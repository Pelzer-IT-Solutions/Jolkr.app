/** Voice signaling client — WebSocket connection to the media server's /ws/voice endpoint. */

export type VoiceEventType =
  | 'joined' | 'offer' | 'iceCandidate'
  | 'participantJoined' | 'participantLeft'
  | 'muteUpdate' | 'deafenUpdate' | 'speaking' | 'error';

type VoiceHandler = (data: Record<string, unknown>) => void;

const OP_MAP: Record<string, VoiceEventType> = {
  Joined: 'joined',
  Offer: 'offer',
  IceCandidate: 'iceCandidate',
  ParticipantJoined: 'participantJoined',
  ParticipantLeft: 'participantLeft',
  MuteUpdate: 'muteUpdate',
  DeafenUpdate: 'deafenUpdate',
  Speaking: 'speaking',
  Error: 'error',
};

export class VoiceClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<VoiceEventType, Set<VoiceHandler>>();
  private wsUrl: string;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(token: string): Promise<void> {
    // Close any existing connection first
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }

    // Clear any leftover timeout from a previous connection
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }

    return new Promise<void>((resolve, reject) => {
      // 10s connection timeout
      this.connectTimeoutId = setTimeout(() => {
        this.connectTimeoutId = null;
        this.disconnect();
        reject(new Error('Voice connection timed out'));
      }, 10_000);

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl);
        this.ws = ws;
      } catch {
        if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
        reject(new Error('Failed to create voice WebSocket'));
        return;
      }

      ws.onopen = () => {
        if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
        this.send('Identify', { token });
        resolve();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const event = OP_MAP[msg.op as string];
          if (event) {
            const d = (msg.d ?? {}) as Record<string, unknown>;
            this.listeners.get(event)?.forEach((fn) => fn(d));
          }
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {
        if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
        reject(new Error('Voice WebSocket error'));
      };
      ws.onclose = (ev) => {
        // Only null out if this is still the active WebSocket
        if (this.ws === ws) this.ws = null;
        // Fire an error event so VoiceService can detect unexpected disconnections
        if (ev.code !== 1000) {
          this.listeners.get('error')?.forEach((fn) => fn({ message: `WebSocket closed: ${ev.code} ${ev.reason || 'unexpected'}` }));
        }
      };
    });
  }

  join(channelId: string) { this.send('Join', { channel_id: channelId }); }
  sendAnswer(sdp: string) { this.send('Answer', { sdp }); }
  sendIceCandidate(candidate: string) { this.send('IceCandidate', { candidate }); }
  leave() { this.send('Leave', {}); }
  setMuted(muted: boolean) { this.send('Mute', { muted }); }
  setDeafened(deafened: boolean) { this.send('Deafen', { deafened }); }

  on(event: VoiceEventType, handler: VoiceHandler): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => { this.listeners.get(event)?.delete(handler); };
  }

  disconnect() {
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
    if (this.ws) {
      // Null handlers BEFORE closing to prevent stale onclose/onerror from firing
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private send(op: string, d: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }
}
