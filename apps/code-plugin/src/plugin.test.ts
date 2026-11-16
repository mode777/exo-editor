import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

interface Manifest {
  schemaVersion: number
  engines: { exo: string }
  permissions: string[]
  runtime: { entry: string }
  contributes: {
    fileEditors: Array<{
      glob: string
      entry: string
      label: string
      priority?: number
      rendering?: string
    }>
  }
}

describe('code plugin manifest', () => {
  const manifest = JSON.parse(read('public/exo-manifest.json')) as Manifest

  it('declares the supported code and markdown globs', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.engines.exo).toBe('>=0.1.0')
    expect(manifest.permissions).toContain('workspace:read')
    expect(manifest.permissions).toContain('workspace:write')
    expect(manifest.permissions).toContain('events:subscribe')
    expect(existsSync(join(root, manifest.runtime.entry))).toBe(true)

    const globs = manifest.contributes.fileEditors.map((editor) => editor.glob)
    expect(globs).toContain('**/*.{ts,tsx}')
    expect(globs).toContain('**/*.{js,jsx}')
    expect(globs).toContain('**/*.json')
    expect(globs).toContain('**/*.md')
  })

  it('declares an existing, frame-rendering editor page', () => {
    for (const editor of manifest.contributes.fileEditors) {
      expect(existsSync(join(root, editor.entry))).toBe(true)
      expect(editor.rendering).toBe('frame')
      expect(editor.priority).toBeGreaterThan(0)
    }
  })
})

describe('code plugin protocol code', () => {
  const sources = [
    'src/controller.ts',
    'src/editor.ts',
    'src/languages.ts',
    'src/dirty.ts',
    'plugin.html',
    'editor.html',
  ]

  it('contains no hand-written protocol plumbing', () => {
    const violations = sources.flatMap((path) => {
      const source = read(path)
      const banned = ['postMessage', "addEventListener('message')", 'exo: 1', 'plugin/ready']
      return banned
        .filter((marker) => source.includes(marker))
        .map((marker) => `${path}: ${marker}`)
    })
    expect(violations).toEqual([])
  })

  it('does not import shell code', () => {
    const violations = sources.filter((path) => {
      const source = read(path)
      return source.includes('apps/shell') || source.includes('@exo/shell')
    })
    expect(violations).toEqual([])
  })

  it('binds Ctrl/Cmd+S to the SDK save intent', () => {
    const source = read('src/editor.ts')
    expect(source).toContain('monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS')
    expect(source).toContain('client.requestSave()')
    expect(source).toContain('!dirty || !client.capabilities.write')
  })

  it('never constructs save content outside the shell request', () => {
    const source = read('src/editor.ts')
    expect(source).not.toContain('plugin/save-content')
    expect(source).not.toContain('plugin/request-save')
    expect(source).not.toContain('ifVersion')
  })
})
