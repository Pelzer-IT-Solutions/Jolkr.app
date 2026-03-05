export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function isMobile(): boolean {
  if (!isTauri) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platform = (window as any).__TAURI_ENV_PLATFORM__ as string | undefined;
  return platform === 'android' || platform === 'ios';
}

export const isDesktop = isTauri && !isMobile();
export const isWeb = !isTauri;
