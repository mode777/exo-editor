import { defineConfig } from 'vitest/config'

// GitHub Pages serves the built template from a child path of the shell site.
// Development keeps the root base so the second-origin server is simple.
export default defineConfig(({ command }) => ({
  base:
    process.env.EXO_TEMPLATE_BASE_PATH ??
    (command === 'build' ? '/exo-editor/plugin-template/' : '/'),
  server: {
    port: 5175,
    strictPort: true,
    cors: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: ['plugin.html', 'editor.html', 'negative/protocol-mismatch.html'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}))
