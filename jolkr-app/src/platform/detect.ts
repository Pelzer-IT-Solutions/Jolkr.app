export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Build-time constant (always reliable in Tauri builds, undefined in web)
const tauriPlatform = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;

export function isMobile(): boolean {
  // Build-time check (most reliable — Vite inlines this as a constant)
  if (tauriPlatform === 'android' || tauriPlatform === 'ios') return true;
  // Runtime fallback
  if (!isTauri) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platform = (window as any).__TAURI_ENV_PLATFORM__ as string | undefined;
  return platform === 'android' || platform === 'ios';
}

export const isDesktop = isTauri && !isMobile();
export const isWeb = !isTauri;
