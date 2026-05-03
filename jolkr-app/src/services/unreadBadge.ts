import { useUnreadStore } from '../stores/unread';
import { useAuthStore } from '../stores/auth';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { LOCAL_PREF_EVENT } from '../hooks/useLocalStorageBoolean';
import { isTauri } from '../platform/detect';

/**
 * Reflect total unread count on the OS app icon (dock badge / tray overlay /
 * PWA badge). Two paths, feature-detected at runtime:
 *   - Tauri: `getCurrentWindow().setBadgeCount(n)` — supported on macOS,
 *     iOS, and most Linux DEs. Windows silently ignores it.
 *   - Web:   `navigator.setAppBadge(n)` — Chromium-based browsers when
 *     installed as a PWA.
 *
 * Gated by the `UNREAD_BADGE` localStorage toggle. Updates live as the
 * unread store changes, the toggle changes, or the user logs out.
 */

let lastApplied: number | 'cleared' | null = null;

function badgeEnabled(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.UNREAD_BADGE);
    return raw !== 'false';
  } catch { return true; }
}

function totalUnread(counts: Record<string, number>): number {
  let total = 0;
  for (const id in counts) total += counts[id] ?? 0;
  return total;
}

async function applyBadge(count: number): Promise<void> {
  if (lastApplied === count || (count === 0 && lastApplied === 'cleared')) return;

  if (isTauri) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (count > 0) {
        await win.setBadgeCount(count);
        lastApplied = count;
      } else {
        await win.setBadgeCount();
        lastApplied = 'cleared';
      }
      return;
    } catch (e) {
      // Some platforms (Windows) don't support setBadgeCount; fall through.
      console.warn('[unreadBadge] Tauri setBadgeCount failed:', (e as Error).message);
    }
  }

  if ('setAppBadge' in navigator) {
    try {
      if (count > 0) {
        await (navigator as Navigator & { setAppBadge: (n?: number) => Promise<void> }).setAppBadge(count);
        lastApplied = count;
      } else {
        await (navigator as Navigator & { clearAppBadge: () => Promise<void> }).clearAppBadge();
        lastApplied = 'cleared';
      }
    } catch { /* badging unavailable in this context */ }
  }
}

async function clearBadge(): Promise<void> {
  await applyBadge(0);
}

function recompute(): void {
  if (!badgeEnabled() || !useAuthStore.getState().user) {
    void clearBadge();
    return;
  }
  void applyBadge(totalUnread(useUnreadStore.getState().counts));
}

let started = false;

/** Subscribe the badge to unread/auth/preference changes. Call once at boot. */
export function startUnreadBadge(): void {
  if (started) return;
  started = true;

  // Initial paint.
  recompute();

  // React to unread changes.
  useUnreadStore.subscribe(recompute);

  // React to login/logout (clear badge on sign-out).
  useAuthStore.subscribe(recompute);

  // React to UNREAD_BADGE toggle changes from the same tab.
  window.addEventListener(LOCAL_PREF_EVENT, (e: Event) => {
    if (e instanceof CustomEvent && e.detail?.key !== STORAGE_KEYS.UNREAD_BADGE) return;
    recompute();
  });
  // …and from other tabs.
  window.addEventListener('storage', (e) => {
    if (e.key && e.key !== STORAGE_KEYS.UNREAD_BADGE) return;
    recompute();
  });
}
