#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Guards a verified failure mode: with vscode-workbench 0.1.3 the kit's
// side-effect element imports are tree-shaken out of the production bundle, so
// every vscode-* tag stays unregistered and icons plus the palette input break.
// The shell registers the peer package's tags explicitly; this check fails if a
// bundler upgrade drops them again.
const distDir = resolve(process.argv[2] ?? 'dist')
const assetsDir = join(distDir, 'assets')

const bundles = readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(join(assetsDir, name), 'utf8'))

if (bundles.length === 0) {
  console.error(`No JavaScript bundles found in ${assetsDir}. Run "npm run build" first.`)
  process.exitCode = 1
} else if (!bundles.some((source) => source.includes('customElements'))) {
  console.error(
    'No customElements registration found in the bundle; vscode-* elements will not upgrade.',
  )
  process.exitCode = 1
} else {
  console.log('Custom element registration present in the bundle.')
}
