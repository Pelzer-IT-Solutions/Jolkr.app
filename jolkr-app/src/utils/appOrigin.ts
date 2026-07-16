import { getApiBaseUrl } from '../platform/config';
import { isTauri } from '../platform/detect';

// The app's own origin. In web builds `getApiBaseUrl()` is the relative `/api`,
// so the origin is the page origin; in Tauri it's the absolute API host.
const apiOrigin = getApiBaseUrl().replace(/\/api$/, '');

/**
 * Resolve a stored content URL to something the current runtime can load.
 * Tauri's webview origin is `tauri.localhost`, so a relative `/api/...` URL
 * stored by a web client must be prefixed with the public API origin.
 */
export function resolveContentUrl(href: string): string {
  if (isTauri && href.startsWith('/api/')) return apiOrigin + href;
  return href;
}

/**
 * True when `raw` points at the app's own origin — our media/GIF proxy or an
 * uploaded asset served from `/api/...`. User-supplied external URLs are never
 * treated as images: loading them would leak the viewer's IP and enable
 * tracking pixels, exactly the surface the "no URL-as-image" rule bans.
 */
export function isAppOriginUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const resolved = resolveContentUrl(raw);
  // Same-origin relative path — but NOT a protocol-relative `//host/...`,
  // which resolves to a foreign origin.
  if (resolved.startsWith('/')) return !resolved.startsWith('//');
  try {
    const appOrigin = apiOrigin || window.location.origin;
    return new URL(resolved).origin === appOrigin;
  } catch {
    return false;
  }
}
