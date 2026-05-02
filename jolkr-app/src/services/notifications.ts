import { wsClient } from '../api/ws';
import { useUnreadStore } from '../stores/unread';
import { useAuthStore } from '../stores/auth';
import type { Message } from '../api/types';
import { STORAGE_KEYS } from '../utils/storageKeys';

// Simple notification sound using Web Audio API (no external file needed)
let audioCtx: AudioContext | null = null;

function playNotificationSound() {
  if (localStorage.getItem(STORAGE_KEYS.SOUND_ENABLED) === 'false') return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(660, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.3);
  } catch { /* audio not available */ }
}

function showDesktopNotification(title: string, body: string) {
  if (localStorage.getItem(STORAGE_KEYS.DESKTOP_NOTIF) === 'false') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // Don't notify if app is focused

  try {
    new Notification(title, {
      body,
      icon: `${import.meta.env.BASE_URL}icon.svg`,
      tag: 'jolkr-message', // Prevents duplicate notifications
    });
  } catch { /* notification not available */ }
}

let unsubNotifications: (() => void) | null = null;

/** Request notification permission if not already decided. */
export async function requestNotificationPermission(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

/** Initialize notification listeners. Call once on app startup. */
export function initNotifications() {
  if (unsubNotifications) unsubNotifications();
  unsubNotifications = wsClient.on((event) => {
    if (event.op !== 'MessageCreate') return;

    const raw = event.d.message;
    if (!raw) return;
    // Normalize: DM messages have dm_channel_id instead of channel_id
    const rawAny = raw as Message & { dm_channel_id?: string };
    const channelId = rawAny.channel_id ?? rawAny.dm_channel_id;
    if (!channelId) return;
    const msg: Message = { ...rawAny, channel_id: channelId };

    // Don't notify for own messages
    const currentUserId = useAuthStore.getState().user?.id;
    if (msg.author_id === currentUserId) return;

    const { activeChannel } = useUnreadStore.getState();
    if (channelId === activeChannel) return;

    // Play sound for messages in non-active channels
    playNotificationSound();

    // Show desktop notification
    // All messages are encrypted — show generic notification
    const notifContent = msg.nonce ? 'Sent an encrypted message' : (msg.content?.slice(0, 100) || 'New message');
    showDesktopNotification('New Message', notifContent);
  });
}

/** Clean up notification listener (e.g. on logout). */
export function stopNotifications() {
  if (unsubNotifications) {
    unsubNotifications();
    unsubNotifications = null;
  }
}
