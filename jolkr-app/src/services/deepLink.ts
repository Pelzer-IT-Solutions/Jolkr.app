import { isTauri } from '../platform/detect';

type DeepLinkHandler = (path: string, params: Record<string, string>) => void;

let handler: DeepLinkHandler | null = null;

function parseDeepLink(url: string): { path: string; params: Record<string, string> } | null {
  try {
    const stripped = url.replace(/^jolkr:\/\//, '');
    const segments = stripped.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    const path = segments[0];
    const params: Record<string, string> = {};

    if (path === 'invite' && segments[1]) {
      params.code = segments[1];
    }

    return { path, params };
  } catch {
    return null;
  }
}

function processUrls(urls: string[]) {
  for (const url of urls) {
    const parsed = parseDeepLink(url);
    if (parsed && handler) {
      handler(parsed.path, parsed.params);
    }
  }
}

/** Register a handler for deep-link navigation. */
export function onDeepLink(fn: DeepLinkHandler) {
  handler = fn;
}

/** Initialize deep-link listening. Call once on app startup after onDeepLink(). */
export async function initDeepLinks() {
  if (!isTauri) return;

  try {
    const { onOpenUrl, getCurrent } = await import('@tauri-apps/plugin-deep-link');

    // Cold start: app opened via jolkr:// URL
    const currentUrls = await getCurrent();
    if (currentUrls && currentUrls.length > 0) {
      setTimeout(() => processUrls(currentUrls), 100);
    }

    // Warm start: URL received while app is running
    await onOpenUrl((urls: string[]) => {
      processUrls(urls);
    });
  } catch (e) {
    console.warn('Deep link initialization failed:', e);
  }
}
