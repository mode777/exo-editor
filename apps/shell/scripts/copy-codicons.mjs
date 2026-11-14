import { copyFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// @vscode-elements expects a real stylesheet link with the id
// "vscode-codicon-stylesheet" and the font next to it. Copy both into the
// public directory so Vite serves them and the deployed base path applies.
const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('@vscode/codicons/package.json'))
const publicDir = fileURLToPath(new URL('../public/codicons/', import.meta.url))

await mkdir(publicDir, { recursive: true })

for (const file of ['codicon.css', 'codicon.ttf']) {
  await copyFile(join(packageRoot, 'dist', file), join(publicDir, file))
}

console.log('Copied codicon assets into public/codicons/')
