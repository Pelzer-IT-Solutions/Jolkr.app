import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom is needed by anything that touches `crypto.subtle`, `TextEncoder`,
    // `URL`, etc. — pure-Node tests would still pass without it but the
    // adapters/store layer hits browser APIs, so default to jsdom for the
    // whole suite to keep test files uniform.
    environment: 'jsdom',
    // Globals (`describe`/`it`/`expect`) opt-out — explicit imports keep
    // tree-shaking and types simpler.
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Don't pick up Tauri build output or vendored bundles.
    exclude: ['node_modules', 'dist', 'dist-tauri', 'src-tauri'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/**/*.module.css.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
