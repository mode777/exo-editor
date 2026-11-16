import { defineConfig } from 'vitest/config'

// GitHub Pages serves the reference plugin from a child path of the shell.
// Development keeps the root base so the second-origin server stays simple.
export default defineConfig(({ command }) => ({
  base:
    process.env.EXO_CODE_PLUGIN_BASE_PATH ??
    (command === 'build' ? '/exo-editor/code-plugin/' : '/'),
  server: {
    port: 5176,
    strictPort: true,
    cors: true,
  },
  build: {
    target: 'es2022',
    worker: {
      format: 'es',
    },
    rollupOptions: {
      input: ['plugin.html', 'editor.html'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
