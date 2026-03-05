import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isTauri = !!process.env.TAURI_ENV_PLATFORM;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: isTauri ? '/' : '/app/',
  clearScreen: false,
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
