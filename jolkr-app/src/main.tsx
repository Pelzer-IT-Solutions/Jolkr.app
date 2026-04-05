import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/scroll-fade.css'
import App from './App'

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
