import * as api from '../api/client';
import { isTauri } from '../platform/detect';
import { STORAGE_KEYS } from '../utils/storageKeys';

// Module-scoped guards make registerPush idempotent: even if it's called
// twice in the same tick (StrictMode double-mount, future re-arming on
// visibilitychange, etc.) we won't issue a second pushManager.subscribe()
// or a second backend device-create.
let registered = false;
let inFlight: Promise<void> | null = null;

/**
 * Register for Web Push notifications.
 * Skipped on Tauri (desktop uses WS notifications via system tray).
 *
 * Idempotent: subsequent calls return the in-flight promise, or no-op
 * once registration has succeeded. Call resetPushRegistration() on
 * logout if the next user should re-register.
 */
export async function registerPush(): Promise<void> {
  if (registered) return;
  if (inFlight) return inFlight;
  inFlight = doRegisterPush().then(
    () => { registered = true; },
  ).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Clear the idempotency guard so the next user's session can register. */
export function resetPushRegistration(): void {
  registered = false;
  inFlight = null;
}

async function doRegisterPush(): Promise<void> {
  if (isTauri) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const reg = await navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' });

  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    const { public_key } = await api.getVapidKey();
    if (!public_key || public_key.length < 10) {
      console.warn('Push: VAPID key not configured on server, skipping push registration');
      return;
    }
    const applicationServerKey = urlBase64ToUint8Array(public_key);
    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer.slice(applicationServerKey.byteOffset, applicationServerKey.byteOffset + applicationServerKey.byteLength) as ArrayBuffer,
      });
    } catch (e) {
      // Push service unreachable (firewall, OS settings, or stale subscription).
      // Surface the underlying error code/message so a developer can tell
      // "permission denied" from "service worker scope mismatch" etc.
      const code = (e as { code?: string }).code;
      const message = e instanceof Error ? e.message : String(e);
      console.warn('[push] subscribe failed — service may be blocked by firewall or OS settings.', { code, message });
      return;
    }
  }

  const subscriptionJson = JSON.stringify(subscription.toJSON());

  // Reuse stored device_id to avoid creating duplicate device rows on each load
  const storedDeviceId = localStorage.getItem(STORAGE_KEYS.PUSH_DEVICE_ID);
  const device = await api.registerDevice({
    device_id: storedDeviceId || undefined,
    device_name: getBrowserName(),
    device_type: 'web',
    push_token: subscriptionJson,
  });
  if (device?.id) {
    localStorage.setItem(STORAGE_KEYS.PUSH_DEVICE_ID, device.id);
  }
}

/**
 * Unsubscribe from Web Push and remove device from backend.
 */
export async function unregisterPush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const reg = await navigator.serviceWorker.getRegistration('/app/');
  if (!reg) return;

  const subscription = await reg.pushManager.getSubscription();
  if (subscription) {
    await subscription.unsubscribe();
  }

  // Remove stored device from backend
  const storedDeviceId = localStorage.getItem(STORAGE_KEYS.PUSH_DEVICE_ID);
  if (storedDeviceId) {
    try {
      await api.deleteDevice(storedDeviceId);
    } catch {
      // Best effort cleanup
    }
    localStorage.removeItem(STORAGE_KEYS.PUSH_DEVICE_ID);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
}

function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  return 'Browser';
}
