#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The template is built separately and copied in after the shell budget, CSP
// and custom-element checks. Keeping the copy last means the budget continues
// to measure the shell, not the plugin.

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const source = resolve(repoRoot, 'packages/plugin-template/dist')
const target = resolve(repoRoot, 'apps/shell/dist/plugin-template')

function assertDirectory(path, label) {
  let stat
  try {
    stat = lstatSync(path)
  } catch {
    throw new Error(`${label} not found at ${path}. Run the template build first.`)
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symlink: ${path}`)
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${path}`)
}

function assertNoSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Refusing to copy symlink ${path}`)
    if (stat.isDirectory()) assertNoSymlinks(path)
  }
}

function main() {
  assertDirectory(source, 'Template build')
  assertDirectory(resolve(repoRoot, 'apps/shell/dist'), 'Shell build')
  if (!existsSync(join(source, 'exo-manifest.json'))) {
    throw new Error(`Template build has no exo-manifest.json at ${source}`)
  }
  assertNoSymlinks(source)

  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })

  if (!existsSync(join(target, 'exo-manifest.json'))) {
    throw new Error('The copied template has no exo-manifest.json.')
  }
  console.log(`Copied plugin template to ${target}`)
}

main()
