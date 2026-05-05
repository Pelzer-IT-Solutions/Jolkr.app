import { wsClient } from '../api/ws';
import { useUnreadStore } from '../stores/unread';
import { useAuthStore } from '../stores/auth';
import type { Message } from '../api/types';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { decryptChannelMessage } from '../crypto/channelKeys';
import { isE2EEReady, getLocalKeys } from './e2ee';

// Simple notification sound using Web Audio API (no external file needed)
let audioCtx: AudioContext | null = null;

function readPrefBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw !== 'false';
  } catch { return fallback; }
}

function playNotificationSound() {
  if (!readPrefBool(STORAGE_KEYS.SOUND_ENABLED, true)) return;
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
  if (!readPrefBool(STORAGE_KEYS.DESKTOP_NOTIF, true)) return;
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

/** Request notification permission if not already decided. */
export async function requestNotificationPermission(): Promise<void> {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

/**
 * Re-prompt for notification permission when the user toggles desktop
 * notifications on. Returns the resulting permission state so the UI can
 * show a toast if it ends up `denied` (the user must then re-enable in
 * browser/OS settings).
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

/**
 * Detect a mention of the current user in plaintext message content. Matches
 * either the literal `@username` form (what the composer inserts) or the
 * `<@user_id>` form (Discord-style ID mention). Case-insensitive on the
 * username, since the composer doesn't enforce case.
 */
function mentionsUser(plaintext: string, username: string, userId: string): boolean {
  if (!plaintext) return false;
  const lower = plaintext.toLowerCase();
  if (lower.includes(`@${username.toLowerCase()}`)) return true;
  if (plaintext.includes(`<@${userId}>`)) return true;
  return false;
}

/**
 * Decrypt the message content if it carries a nonce and channel keys are
 * available. Returns null when decryption isn't possible (no keys, no
 * channel ID, or failure) so the caller can skip the mention check.
 */
async function decryptIfPossible(
  content: string,
  nonce: string | null | undefined,
  channelId: string,
  isDm: boolean,
): Promise<string | null> {
  if (!nonce) return content;
  if (!isE2EEReady()) return null;
  const localKeys = getLocalKeys();
  if (!localKeys) return null;
  try {
    return await decryptChannelMessage(channelId, localKeys, content, nonce, isDm);
  } catch {
    return null;
  }
}

// ── WS subscription (module-init, matches stores/* convention) ──
// Stays attached for the app lifetime. On logout the WS is disconnected
// and no events flow through; on re-login the same listener resumes.
wsClient.on(async (event) => {
  if (event.op !== 'MessageCreate') return;

  const raw = event.d.message;
  if (!raw) return;
  // Normalize: DM messages have dm_channel_id instead of channel_id
  const rawAny = raw as Message & { dm_channel_id?: string };
  const channelId = rawAny.channel_id ?? rawAny.dm_channel_id;
  if (!channelId) return;
  const isDm = !!rawAny.dm_channel_id;
  const msg: Message = { ...rawAny, channel_id: channelId };

  // Don't notify for own messages
  const me = useAuthStore.getState().user;
  if (!me) return;
  if (msg.author_id === me.id) return;

  const { activeChannel } = useUnreadStore.getState();
  if (channelId === activeChannel) return;

  // Determine whether this message should produce a notification.
  // Mention overrides the per-trigger toggles; DM/channel messages obey them.
  const dmAllowed = readPrefBool(STORAGE_KEYS.DM_NOTIF, true);
  const mentionAllowed = readPrefBool(STORAGE_KEYS.MENTION_NOTIF, true);

  let plaintext: string | null = null;
  if (msg.content) {
    plaintext = await decryptIfPossible(msg.content, msg.nonce, channelId, isDm);
  }
  const hasMention = !!plaintext && mentionsUser(plaintext, me.username, me.id);

  let shouldNotify = false;
  if (hasMention) {
    // Mentions always notify, regardless of the mention/DM gates.
    shouldNotify = true;
  } else if (isDm) {
    shouldNotify = dmAllowed;
  } else {
    // Channel message without a mention. Honour the @mentions toggle as
    // "any channel activity" gate — matches the existing UX label.
    shouldNotify = mentionAllowed;
  }

  if (!shouldNotify) return;

  playNotificationSound();

  const notifContent = plaintext
    ? plaintext.slice(0, 100)
    : (msg.nonce ? 'Sent an encrypted message' : (msg.content?.slice(0, 100) || 'New message'));
  showDesktopNotification(hasMention ? 'You were mentioned' : 'New Message', notifContent);
});
