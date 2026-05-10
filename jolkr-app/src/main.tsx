import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/scroll-fade.css'
import App from './App'
import { isTauri, isMobile } from './platform/detect'
import { migrateLegacyStorageKeys } from './utils/storageKeys'

// Apply one-time storage-key migrations before any other code reads localStorage.
migrateLegacyStorageKeys()

declare global {
  interface Window {
    /** Injected by MainActivity.onWebViewCreate on Tauri Android only. */
    JolkrNative?: {
      enterFullscreen(): void
      exitFullscreen(): void
    }
  }
}

// Tauri WebView doesn't propagate env(safe-area-inset-*) so we tag <html> and let CSS apply hardcoded fallbacks.
if (isTauri && isMobile()) {
  document.documentElement.classList.add('tauri-mobile')

  // Cross-origin iframe fullscreen needs a JS→Kotlin bridge — Android WebView CSS-fullscreens but doesn't notify the host activity. <video> uses native onShowCustomView path.
  document.addEventListener('fullscreenchange', () => {
    const el = document.fullscreenElement
    if (el?.tagName === 'IFRAME') {
      window.JolkrNative?.enterFullscreen()
    } else if (!el) {
      window.JolkrNative?.exitFullscreen()
    }
  })
}

// Block all WebView zoom paths in Tauri — the app manages its own scaling and zoom breaks layout. Web users keep browser zoom for accessibility.
if (isTauri) {
  document.documentElement.style.touchAction = 'pan-x pan-y'
  window.addEventListener('gesturestart', (e) => e.preventDefault())
  window.addEventListener('gesturechange', (e) => e.preventDefault())
  window.addEventListener('gestureend', (e) => e.preventDefault())
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault() }, { passive: false })
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_', '0'].includes(e.key)) e.preventDefault()
  })
}

async function applyTauriOsTheme(): Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const w = getCurrentWindow()
    const apply = (t: 'light' | 'dark' | null) => {
      ;(window as unknown as { __TAURI_OS_DARK?: boolean }).__TAURI_OS_DARK = t === 'dark'
      window.dispatchEvent(new Event('jolkr-tauri-theme-change'))
      const pref = localStorage.getItem('jolkr-color-mode')
      if (pref === 'light' || pref === 'dark') return
      const root = document.documentElement
      if (t === 'dark') root.classList.add('dark')
      else if (t === 'light') root.classList.remove('dark')
    }
    apply(await w.theme())
    w.onThemeChanged(({ payload }) => apply(payload))
  } catch { /* not Tauri or API failed */ }
}

await applyTauriOsTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Window is created visible. The OS-level backgroundColor (dark) plus
// the inline theme-init script in index.html keep the first paint dark
// so there's no white flash even before main.tsx finishes its async
// theme query against the Tauri API.
