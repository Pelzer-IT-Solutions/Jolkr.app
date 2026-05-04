import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/scroll-fade.css'
import App from './App'
import { isTauri, isMobile } from './platform/detect'
import { migrateLegacyStorageKeys, STORAGE_KEYS } from './utils/storageKeys'

// Apply one-time storage-key migrations before any other code reads localStorage.
migrateLegacyStorageKeys()

// Tauri WebView2 on Windows doesn't reliably reflect the OS dark-mode
// preference via `prefers-color-scheme` — the inline theme-init script in
// index.html therefore can't tell, and apps booted in 'system' mode flash
// white before AppShell mounts. Query Tauri's window-theme API at startup,
// push the value into the colorMode module so useColorMode picks it up,
// and reconcile the .dark class so first paint matches the OS. Subscribe
// to theme-change events too so the app follows the OS at runtime.
if ('__TAURI_INTERNALS__' in window) {
  Promise.all([
    import('@tauri-apps/api/window'),
    import('./utils/colorMode'),
  ]).then(async ([{ getCurrentWindow }, { setTauriSystemDark }]) => {
    const win = getCurrentWindow()
    const apply = (dark: boolean): void => {
      setTauriSystemDark(dark)
      // Only override the .dark class when the user is in system mode —
      // explicit light/dark prefs are honoured by useColorMode.
      const stored = localStorage.getItem(STORAGE_KEYS.COLOR_MODE)
      if (stored === null || stored === 'system') {
        const hasDark = document.documentElement.classList.contains('dark')
        if (hasDark !== dark) {
          document.documentElement.classList.toggle('dark', dark)
        }
      }
    }
    try {
      const theme = await win.theme()
      apply(theme === 'dark')
    } catch {
      /* fall back to whatever theme-init.js inferred */
    }
    try {
      await win.onThemeChanged(({ payload }) => apply(payload === 'dark'))
    } catch {
      /* runtime subscription unavailable — startup value still applied */
    }
  })
}

declare global {
  interface Window {
    /** Injected by MainActivity.onWebViewCreate on Tauri Android only. */
    JolkrNative?: {
      enterFullscreen(): void
      exitFullscreen(): void
    }
  }
}

// Tauri Android/iOS: tag <html> so CSS can apply hardcoded safe-area
// fallbacks. The WebView doesn't propagate env(safe-area-inset-*) values
// even though the host activity uses enableEdgeToEdge(), so we provide
// sensible defaults (status bar / gesture bar) for this platform only.
if (isTauri && isMobile()) {
  document.documentElement.classList.add('tauri-mobile')

  // Cross-origin iframe embeds (VidMount, YouTube, Vimeo, …) request
  // fullscreen on their own elements inside the iframe; Android WebView
  // CSS-fullscreens the iframe but doesn't notify the host activity, so
  // the system status / nav bars stay visible. Drive native immersive
  // mode + landscape lock via a direct JS→Kotlin bridge installed by
  // MainActivity.onWebViewCreate. (Tauri/Wry intercepts console messages
  // via its own Rust path, so the console side-channel isn't reachable.)
  // For <video> elements we let MainActivity's onShowCustomView path
  // handle it natively — no bridge call needed.
  //
  // Defense-in-depth: only the top-level frame is allowed to invoke the
  // bridge. Android's addJavascriptInterface already scopes the binding to
  // the main frame, but if an attacker ever convinces a same-origin iframe
  // to import this module the guard keeps the privileged channel closed.
  // Privilege rule: never extend the bridge with file/process/credential
  // access — the surface MUST stay limited to UI-scope operations.
  if (window.self === window.top) {
    document.addEventListener('fullscreenchange', () => {
      const el = document.fullscreenElement
      if (el?.tagName === 'IFRAME') {
        window.JolkrNative?.enterFullscreen()
      } else if (!el) {
        window.JolkrNative?.exitFullscreen()
      }
    })
  }
}

// Block UI zoom in the Tauri desktop and mobile apps. Webview zoom (pinch,
// double-tap, Ctrl+Wheel, Ctrl+/-/0) breaks the layout — the app already
// manages its own scaling. Web users keep normal browser zoom for
// accessibility.
if (isTauri) {
  // CSS-level: disable pinch and double-tap zoom on touch devices while
  // preserving scrolling. Most reliable cross-platform approach for Android.
  document.documentElement.style.touchAction = 'pan-x pan-y'
  // Pinch zoom (Safari/iOS — Android WebView ignores these but harmless)
  window.addEventListener('gesturestart', (e) => e.preventDefault())
  window.addEventListener('gesturechange', (e) => e.preventDefault())
  window.addEventListener('gestureend', (e) => e.preventDefault())
  // Ctrl+Wheel zoom (desktop)
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault() }, { passive: false })
  // Ctrl+= / Ctrl+- / Ctrl+0 (desktop)
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_', '0'].includes(e.key)) e.preventDefault()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Show window after first paint to avoid white flash
if ('__TAURI_INTERNALS__' in window) {
  import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
    requestAnimationFrame(() => {
      getCurrentWindow().show();
    });
  });
}
