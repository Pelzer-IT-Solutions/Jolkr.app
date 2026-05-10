import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const useLocalProxy = process.env.VITE_API_TARGET === 'local';

/**
 * Strips external font URLs out of the NoMercy video player at build time.
 *
 * The library hard-codes two external sources in `createSubtitleFontFamily`:
 *   - `https://fonts.bunny.net/css?family=noto-sans-jp:500` (subtitle font
 *      for Japanese — irrelevant for our chat usage)
 *   - `https://raw.githubusercontent.com/NoMercy-Entertainment/media/.../Fonts/ReithSans/*.woff2`
 *      (player UI font)
 *
 * Both are blocked by our CSP and violate our "no external assets" rule.
 * We replace each `url(...)` reference with `local('sans-serif')` so the
 * @font-face declarations resolve to a system font with no network request.
 * The `@import` for noto-sans-jp is removed entirely.
 */
function stripExternalPlayerFonts(): Plugin {
  return {
    name: 'jolkr:nmp-strip-external-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('nomercy-video-player')) return null;
      if (!code.includes('fonts.bunny.net') && !code.includes('raw.githubusercontent.com/NoMercy-Entertainment')) {
        return null;
      }
      // Patterns target the published minified ESM bundle (the var holding
      // the fontBaseUrl is minified to a single letter like `${e}`); match
      // any identifier inside the template-string interpolation.
      const next = code
        .replace(/@import url\(https:\/\/fonts\.bunny\.net\/css\?family=noto-sans-jp:500\);?\\?n?\\?t?/g, '')
        .replace(
          /url\("\$\{[a-zA-Z_$][\w$]*\}\/Reith[A-Za-z]+\.woff2"\)\s*format\("woff2"\)/g,
          `local('sans-serif')`,
        )
        .replace(
          /url\("https:\/\/raw\.githubusercontent\.com\/NoMercy-Entertainment\/[^"]+"\)\s*format\("woff2"\)/g,
          `local('sans-serif')`,
        );
      return { code: next, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), stripExternalPlayerFonts()],
  base: isTauri ? '/' : '/app/',
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // hls.js itself is ~520 KB and not further splittable; main bundle is sensibly split via manualChunks below.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@noble/')) return 'crypto'
            if (id.includes('react-dom') || id.includes('react-router')) return 'react'
            if (id.includes('@dnd-kit/')) return 'dnd'
            if (id.includes('emoji-picker')) return 'emoji'
            if (id.includes('highlight.js')) return 'hljs'
            if (id.includes('qrcode') || id.includes('html5-qrcode')) return 'qr'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('dompurify')) return 'sanitize'
            if (id.includes('zustand')) return 'state'
          }
        },
      },
    },
  },
  server: isTauri
    ? { port: 1420, strictPort: true }
    : {
        // Proxy only when running with local backend (VITE_API_TARGET=local)
        // Otherwise the frontend hits jolkr.app directly via absolute URLs
        ...(useLocalProxy ? {
          proxy: {
            '/api': { target: 'http://localhost:8080', changeOrigin: true },
            '/ws': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
            '/s3': { target: 'http://localhost:8080', changeOrigin: true },
            '/media': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
          },
        } : {}),
      },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
