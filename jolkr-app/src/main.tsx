import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/scroll-fade.css'
import App from './App'
import { isTauri, isMobile } from './platform/detect'

// Tauri Android/iOS: tag <html> so CSS can apply hardcoded safe-area
// fallbacks. The WebView doesn't propagate env(safe-area-inset-*) values
// even though the host activity uses enableEdgeToEdge(), so we provide
// sensible defaults (status bar / gesture bar) for this platform only.
if (isTauri && isMobile()) {
  document.documentElement.classList.add('tauri-mobile')
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
