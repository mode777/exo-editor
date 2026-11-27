import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import { exoCspPlugin } from './src/csp.ts'

// GitHub Pages project site: https://<owner>.github.io/exo-editor/
// Forks can override the base without touching the source.
const base = process.env.EXO_BASE_PATH ?? '/exo-editor/'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Serve the marketplace documents from the top-level marketplace/ directory in
 * development only. The production build receives them from the explicit
 * deploy:copy-marketplace step, so the deploy-time contract is unchanged.
 */
function marketplaceDevPlugin(): Plugin {
  return {
    name: 'exo-marketplace-dev',
    apply: 'serve',
    configureServer(server) {
      const prefix = base.endsWith('/') ? base.slice(0, -1) : base
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0]
        let source: string | null = null
        if (pathname === `${prefix}/marketplace.json`) {
          source = resolve(repoRoot, 'marketplace/marketplace.json')
        } else if (pathname === `${prefix}/marketplace-sources.json`) {
          source = resolve(repoRoot, 'marketplace/sources.json')
        }
        if (!source) {
          next()
          return
        }
        try {
          const body = readFileSync(source)
          response.statusCode = 200
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.setHeader('cache-control', 'no-store')
          response.end(body)
        } catch {
          response.statusCode = 404
          response.setHeader('content-type', 'text/plain; charset=utf-8')
          response.end('Not found')
        }
      })
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), exoCspPlugin(), marketplaceDevPlugin()],
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
