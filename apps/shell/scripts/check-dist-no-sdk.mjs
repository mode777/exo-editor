#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The shell must never bundle the plugin SDK or the template. The composition
// guard catches source imports; this catches a build-time or vendored copy.

const SDK_MARKERS = ['ExoProtocolError', '@exo/plugin-sdk', 'EXO_TEMPLATE_']
const ASSET_EXTENSIONS = ['.js', '.mjs', '.css', '.html']

/**
 * @param {string} distDir
 * @returns {Array<{ path: string, marker: string }>}
 */
export function scanDistForSdk(distDir) {
  let stat
  try {
    stat = statSync(distDir)
  } catch {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`)
  }
  if (!stat.isDirectory()) throw new Error(`Build output at ${distDir} is not a directory.`)

  const violations = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        // The template is deliberately deployed as a child path; it is not
        // part of the shell bundle this check protects.
        if (entry.name === 'plugin-template') continue
        walk(path)
        continue
      }
      if (!ASSET_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue
      const source = readFileSync(path, 'utf8')
      for (const marker of SDK_MARKERS) {
        if (source.includes(marker)) violations.push({ path, marker })
      }
    }
  }
  walk(distDir)
  return violations
}

function main() {
  const distDir = resolve(process.argv[2] ?? 'dist')
  const violations = scanDistForSdk(distDir)
  if (violations.length === 0) {
    console.log('No plugin SDK or template code found in the shell build.')
    return
  }
  for (const violation of violations) {
    console.error(`SDK marker "${violation.marker}" found in ${violation.path}`)
  }
  process.exitCode = 1
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
