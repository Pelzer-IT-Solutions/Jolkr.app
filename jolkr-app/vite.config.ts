import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// Dev proxy: live server by default, VITE_API_TARGET=local to use localhost:8080
const apiTarget = process.env.VITE_API_TARGET === 'local'
  ? 'http://localhost:8080'
  : 'https://jolkr.app';
const wsTarget = process.env.VITE_API_TARGET === 'local'
  ? 'ws://localhost:8080'
  : 'wss://jolkr.app';

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
          '/api': { target: apiTarget, changeOrigin: true, secure: true },
          '/ws': { target: wsTarget, ws: true, changeOrigin: true, secure: true },
          '/s3': { target: apiTarget, changeOrigin: true, secure: true },
          '/media': { target: wsTarget, ws: true, changeOrigin: true, secure: true },
        },
      },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
