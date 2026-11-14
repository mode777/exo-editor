import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { exoCspPlugin } from './src/csp.ts'

// GitHub Pages project site: https://<owner>.github.io/exo-editor/
// Forks can override the base without touching the source.
const base = process.env.EXO_BASE_PATH ?? '/exo-editor/'

export default defineConfig({
  base,
  plugins: [react(), exoCspPlugin()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    server: {
      deps: {
        // Inline the kit so vi.resetModules() returns a fresh store instance
        // when a test simulates a page reload.
        inline: [/vscode-workbench/],
      },
    },
  },
})
