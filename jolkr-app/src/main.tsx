import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/scroll-fade.css'
import App from './App'
import { isTauri, isMobile } from './platform/detect'

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
  document.addEventListener('fullscreenchange', () => {
    const el = document.fullscreenElement
    if (el?.tagName === 'IFRAME') {
      window.JolkrNative?.enterFullscreen()
    } else if (!el) {
      window.JolkrNative?.exitFullscreen()
    }
  })
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
