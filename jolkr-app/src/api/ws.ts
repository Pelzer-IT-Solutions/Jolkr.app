import { getAccessToken, refreshAccessTokenIfNeeded, forceLogout } from './client';
import { getWsUrl } from '../platform/config';
import { signWithIdentity } from '../services/e2ee';
import { STORAGE_KEYS } from '../utils/storageKeys';
import type { WsListenerEvent } from './ws-events';

/** Decode a URL-safe-no-pad base64 string into bytes. */
function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes as URL-safe-no-pad base64. */
function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type WsListener = (event: WsListenerEvent) => void;

const HEARTBEAT_INTERVAL = 30_000;
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 60_000;
const MAX_ATTEMPTS = 10;

class WsClient {
  private ws: WebSocket | null = null;
  private seq = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<WsListener> = new Set();
  private subscribedChannels: Map<string, number> = new Map();
  private connected = false;

  connect() {
    if (this.ws) return;
    this.reconnectAttempts = 0;
    const token = getAccessToken();
    if (!token) return;

    try {
      this.ws = new WebSocket(getWsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // SEC-013: don't send Identify yet — wait for the server `Hello`
      // challenge. The handler in `handleEvent` signs the nonce with
      // the local ed25519 identity key and sends the signed Identify.
      // Bearer-only Identify is rejected server-side; clients without
      // E2EE keys must re-login to materialise their identity key.
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const op = msg.op as string;
        const d = (msg.d ?? {}) as Record<string, unknown>;
        this.handleEvent(op, d);
      } catch (e) { console.warn('WS message parse error:', e); }
    };

    this.ws.onclose = () => {
      this.cleanup();
      // Null the socket so a subsequent connect() doesn't no-op via `if (this.ws) return`.
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.reconnectAttempts = MAX_ATTEMPTS; // prevent reconnect
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.cleanup();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    this.subscribedChannels = new Map();
  }

  subscribe(channelId: string) {
    const count = this.subscribedChannels.get(channelId) ?? 0;
    this.subscribedChannels.set(channelId, count + 1);
    // Only send Subscribe to backend on first subscriber
    if (count === 0 && this.connected) {
      this.send('Subscribe', { channel_id: channelId });
    }
  }

  unsubscribe(channelId: string) {
    const count = this.subscribedChannels.get(channelId) ?? 0;
    if (count <= 1) {
      this.subscribedChannels.delete(channelId);
      if (this.connected) {
        this.send('Unsubscribe', { channel_id: channelId });
      }
    } else {
      this.subscribedChannels.set(channelId, count - 1);
    }
  }

  sendTyping(channelId: string) {
    this.send('TypingStart', { channel_id: channelId });
  }

  updatePresence(status: string) {
    this.send('PresenceUpdate', { status });
  }

  on(listener: WsListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private send(op: string, d: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ op, d }));
    }
  }

  private handleEvent(op: string, d: Record<string, unknown>) {
    switch (op) {
      case 'Hello': {
        // SEC-013 challenge-response. Sign the raw nonce bytes with the
        // local identity ed25519 private key and reply with Identify.
        // Bearer-only Identify is rejected server-side, so a missing
        // device_id, nonce, or identity key means the user must re-login
        // to materialise their E2EE state.
        const token = getAccessToken();
        if (!token) break;
        const nonceB64 = typeof d.nonce === 'string' ? d.nonce : null;
        const deviceId = localStorage.getItem(STORAGE_KEYS.E2EE_DEVICE_ID);
        if (!nonceB64 || !deviceId) {
          console.warn('[ws] Hello received but no nonce/deviceId — re-login required');
          break;
        }
        try {
          const nonceBytes = fromBase64Url(nonceB64);
          const sig = signWithIdentity(nonceBytes);
          if (!sig) {
            console.warn('[ws] signWithIdentity returned null — re-login required');
            break;
          }
          this.send('Identify', {
            token,
            device_id: deviceId,
            nonce: nonceB64,
            signature: toBase64Url(sig),
          });
        } catch (e) {
          console.warn('[ws] Identify signing failed:', e);
        }
        break;
      }
      case 'Ready':
        this.connected = true;
        this.startHeartbeat();
        // re-subscribe to channels
        for (const ch of this.subscribedChannels.keys()) {
          this.send('Subscribe', { channel_id: ch });
        }
        break;
      case 'HeartbeatAck':
        break;
      case 'Error': {
        // Auth-related rejections (operator JWT-baseline bump, blacklisted
        // token, sig check failure for clients without E2EE keys) bounce the
        // user to /login so the app doesn't sit silently broken until the
        // next API call. Non-auth errors (e.g. "Cannot subscribe: no access
        // to channel") fall through to the listener dispatch below.
        const msg = typeof d.message === 'string' ? d.message : '';
        if (msg === 'Authentication failed' || msg === 'Token has been revoked') {
          this.disconnect();
          forceLogout();
          return;
        }
        break;
      }
      default:
        break;
    }
    // The discriminated union is structural — runtime events that match a
    // known `op` literal will narrow correctly inside consumer `switch`
    // statements; unknown ops fall through to the UnknownWsEvent branch.
    const event = { op, d } as WsListenerEvent;
    this.listeners.forEach((fn) => fn(event));
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.seq++;
      this.send('Heartbeat', { seq: this.seq });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanup() {
    this.connected = false;
    this.stopHeartbeat();
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= MAX_ATTEMPTS) {
      // Notify listeners that reconnection has given up
      const event: WsListenerEvent = { op: 'Disconnected', d: { reason: 'max_reconnect_attempts' } };
      this.listeners.forEach((fn) => fn(event));
      return;
    }
    const delay = Math.min(
      // eslint-disable-next-line no-restricted-syntax -- jitter only, not crypto
      RECONNECT_BASE * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      RECONNECT_MAX,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(async () => {
      this.ws = null;
      // Refresh access token before reconnecting (it may have expired during backoff)
      await refreshAccessTokenIfNeeded();
      this.connect();
    }, delay);
  }
}

export const wsClient = new WsClient();
