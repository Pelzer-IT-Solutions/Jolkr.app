import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react()],
  base: isTauri ? '/' : '/app/',
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Heavy crypto libs — not needed for first paint
            if (id.includes('@noble/')) return 'crypto'
            // React core — cached long-term
            if (id.includes('react-dom') || id.includes('react-router')) return 'react'
            // DnD kit
            if (id.includes('@dnd-kit/')) return 'dnd'
            // Emoji picker
            if (id.includes('emoji-picker')) return 'emoji'
            // Highlight.js
            if (id.includes('highlight.js')) return 'hljs'
            // QR code libs
            if (id.includes('qrcode') || id.includes('html5-qrcode')) return 'qr'
          }
        },
      },
    },
  },
  server: isTauri
    ? { port: 1420, strictPort: true }
    : {
        proxy: {
          '/api': 'http://localhost:8080',
          '/ws': { target: 'ws://localhost:8080', ws: true },
        },
      },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
