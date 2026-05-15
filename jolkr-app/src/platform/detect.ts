import { getTauriEnvPlatform, hasTauriInternals } from './tauriGlobals';

export const isTauri = hasTauriInternals();

// Build-time constant (always reliable in Tauri builds, undefined in web)
const tauriPlatform = import.meta.env.TAURI_ENV_PLATFORM as string | undefined;

export function isMobile(): boolean {
  // Build-time check (most reliable — Vite inlines this as a constant)
  if (tauriPlatform === 'android' || tauriPlatform === 'ios') return true;
  // Runtime fallback
  if (!isTauri) return false;
  const platform = getTauriEnvPlatform();
  return platform === 'android' || platform === 'ios';
}

export const isDesktop = isTauri && !isMobile();
export const isWeb = !isTauri;
