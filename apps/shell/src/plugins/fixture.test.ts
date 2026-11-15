import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateManifest } from './manifest'

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/plugin-host-fixture',
)

describe('deployed plugin fixture', () => {
  it('has a valid manifest whose editor pages exist', () => {
    const raw = readFileSync(resolve(fixtureDir, 'exo-manifest.json'), 'utf8')
    const result = validateManifest(
      JSON.parse(raw) as unknown,
      'https://mode777.github.io/exo-editor/plugin-host-fixture/exo-manifest.json',
      '0.1.0',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.fileEditors).toHaveLength(6)
    for (const editor of result.manifest.fileEditors) {
      const file = resolve(fixtureDir, editor.entry)
      expect(existsSync(file), editor.entry).toBe(true)
    }
    expect(existsSync(resolve(fixtureDir, 'editor-common.js'))).toBe(true)
  })

  it('declares the behaviour variants used by the deployed checks', () => {
    const raw = readFileSync(resolve(fixtureDir, 'exo-manifest.json'), 'utf8')
    const manifest = JSON.parse(raw) as {
      contributes: { fileEditors: Array<{ glob: string; entry: string; priority: number }> }
    }
    const byGlob = new Map(manifest.contributes.fileEditors.map((entry) => [entry.glob, entry]))
    expect(byGlob.get('**/*.events.txt')?.entry).toBe('editor-events.html')
    expect(byGlob.get('**/*.events.txt')?.priority).toBe(30)
    expect(byGlob.get('**/*.repeat.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.append.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.neverack.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.txt')?.entry).toBe('editor.html')
    expect(byGlob.get('**/*.sibling.txt')?.entry).toBe('sibling.html')
  })
})
