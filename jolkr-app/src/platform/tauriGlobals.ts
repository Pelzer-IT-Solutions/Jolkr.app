/**
 * Tauri-injected window globals — centralised so the `as unknown as` cast lives in one place.
 *
 * Tauri injects these at the WebView level before any script runs, but their types are not
 * part of the public `@tauri-apps/api` surface (or are documented inconsistently across
 * platforms). Keeping the cast localised avoids scattered `(window as any)` access.
 */
interface TauriWindowExtensions {
  /** Truthy presence indicates the page is running inside a Tauri WebView. */
  __TAURI_INTERNALS__?: unknown
  /** OS-level dark-mode state, mirrored from the Rust-side Tauri window theme listener. */
  __TAURI_OS_DARK?: boolean
  /** Build/runtime platform identifier injected by Tauri (`android` | `ios` | `windows` | ...). */
  __TAURI_ENV_PLATFORM__?: string
}

function tauriWindow(): TauriWindowExtensions {
  return window as unknown as TauriWindowExtensions
}

export function hasTauriInternals(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function getTauriOsDark(): boolean | undefined {
  return tauriWindow().__TAURI_OS_DARK
}

export function setTauriOsDark(value: boolean): void {
  tauriWindow().__TAURI_OS_DARK = value
}

export function getTauriEnvPlatform(): string | undefined {
  return tauriWindow().__TAURI_ENV_PLATFORM__
}
