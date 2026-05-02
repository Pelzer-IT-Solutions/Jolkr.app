import { isTauri } from '../platform/detect';
import * as api from '../api/client';
import { STORAGE_KEYS } from '../utils/storageKeys';

/**
 * Register for Web Push notifications.
 * Skipped on Tauri (desktop uses WS notifications via system tray).
 */
export async function registerPush(): Promise<void> {
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
      // Push service unreachable (firewall, OS settings, or stale subscription)
      console.warn('Push: registration failed — push service may be blocked by firewall or OS settings. Skipping.');
      return;
    }
  }

  const subscriptionJson = JSON.stringify(subscription.toJSON());

  // Reuse stored device_id to avoid creating duplicate device rows on each load
  const storedDeviceId = localStorage.getItem(STORAGE_KEYS.PUSH_DEVICE_ID);
  const result = await api.registerDevice({
    device_id: storedDeviceId || undefined,
    device_name: getBrowserName(),
    device_type: 'web',
    push_token: subscriptionJson,
  });
  if (result?.device?.id) {
    localStorage.setItem(STORAGE_KEYS.PUSH_DEVICE_ID, result.device.id);
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
