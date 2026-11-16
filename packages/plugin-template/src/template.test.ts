import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { withSaveMarker } from './marker'

const root = fileURLToPath(new URL('..', import.meta.url))

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('save marker', () => {
  it('appends one visible marker per save', () => {
    expect(withSaveMarker('hello', 1)).toBe('hello\n[template save 1]')
    expect(withSaveMarker(withSaveMarker('hello', 1), 2)).toBe(
      'hello\n[template save 1]\n[template save 2]',
    )
  })
})

describe('template protocol code', () => {
  const sources = [
    'src/controller.ts',
    'src/editor.ts',
    'src/mismatch.ts',
    'src/observation.ts',
    'src/marker.ts',
    'plugin.html',
    'editor.html',
    'negative/protocol-mismatch.html',
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

  it('declares the manifest pages that exist', () => {
    const manifest = JSON.parse(read('public/exo-manifest.json')) as {
      schemaVersion: number
      engines: { exo: string }
      permissions: string[]
      runtime: { entry: string }
      contributes: { fileEditors: Array<{ glob: string; entry: string; priority?: number }> }
    }
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.engines.exo).toBe('>=0.1.0')
    expect(manifest.permissions).toContain('workspace:read')
    expect(manifest.permissions).toContain('workspace:write')
    expect(existsSync(join(root, manifest.runtime.entry))).toBe(true)
    for (const editor of manifest.contributes.fileEditors) {
      expect(existsSync(join(root, editor.entry))).toBe(true)
      expect(editor.glob).toBe('**/*.template.txt')
      expect(editor.priority).toBeGreaterThan(0)
    }

    const mismatch = JSON.parse(read('public/exo-manifest-mismatch.json')) as {
      runtime: { entry: string }
    }
    expect(existsSync(join(root, mismatch.runtime.entry))).toBe(true)
  })

  it('never registers from the protocol-mismatch diagnostic', () => {
    const source = read('src/mismatch.ts')
    expect(source).not.toContain('plugin/register')
    expect(source).not.toContain('.registration')
  })
})
