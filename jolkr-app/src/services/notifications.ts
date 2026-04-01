import { wsClient } from '../api/ws';
import { useUnreadStore } from '../stores/unread';
import { useAuthStore } from '../stores/auth';
import type { Message } from '../api/types';

// Simple notification sound using Web Audio API (no external file needed)
let audioCtx: AudioContext | null = null;

function playNotificationSound() {
  if (localStorage.getItem('jolkr_sound') === 'false') return;
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
  if (localStorage.getItem('jolkr_desktop_notif') === 'false') return;
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
  unsubNotifications = wsClient.on((op, d) => {
    if (op !== 'MessageCreate') return;

    const raw = d.message as Record<string, unknown>;
    if (!raw) return;
    // Normalize: DM messages have dm_channel_id instead of channel_id
    const channelId = (raw.channel_id ?? raw.dm_channel_id) as string | undefined;
    if (!channelId) return;
    const msg = { ...raw, channel_id: channelId } as unknown as Message;

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
