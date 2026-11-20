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
    expect(result.manifest.fileEditors).toHaveLength(9)
    expect(result.manifest.configuration?.properties).toMatchObject({
      'fixture.greeting': { type: 'string', default: 'hello from fixture' },
      'fixture.repeat': { type: 'boolean', default: false },
      'fixture.size': { type: 'number', enum: [1, 2, 3], default: 1 },
    })
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
    expect(byGlob.get('**/*.local.txt')?.entry).toBe('editor-local-events.html')
    expect(byGlob.get('**/*.local.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.list.txt')?.entry).toBe('editor-list.html')
    expect(byGlob.get('**/*.list.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.picker.txt')?.entry).toBe('editor-picker.html')
    expect(byGlob.get('**/*.picker.txt')?.priority).toBeGreaterThan(30)
    expect(byGlob.get('**/*.events.txt')?.entry).toBe('editor-events.html')
    expect(byGlob.get('**/*.events.txt')?.priority).toBe(30)
    expect(byGlob.get('**/*.repeat.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.append.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.neverack.txt')?.priority).toBeGreaterThan(0)
    expect(byGlob.get('**/*.txt')?.entry).toBe('editor.html')
    expect(byGlob.get('**/*.sibling.txt')?.entry).toBe('sibling.html')
  })

  it('registers every declared editor glob', () => {
    const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'exo-manifest.json'), 'utf8')) as {
      contributes: { fileEditors: Array<{ glob: string; entry: string }> }
    }
    const controller = readFileSync(resolve(fixtureDir, 'plugin.html'), 'utf8')
    for (const editor of manifest.contributes.fileEditors) {
      expect(controller).toContain(`glob: '${editor.glob}'`)
      expect(controller).toContain(`entry: '${editor.entry}'`)
    }
  })

  it('declares a second identity for cross-plugin local-event isolation', () => {
    const raw = readFileSync(resolve(fixtureDir, 'other-manifest.json'), 'utf8')
    const result = validateManifest(
      JSON.parse(raw) as unknown,
      'https://mode777.github.io/exo-editor/plugin-host-fixture/other-manifest.json',
      '0.2.0',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('com.example.exo.fixture.other')
    expect(result.manifest.fileEditors).toEqual([
      expect.objectContaining({ glob: '**/*.local-other.txt', entry: 'editor-local-events.html' }),
    ])
    expect(existsSync(resolve(fixtureDir, 'editor-local-events.html'))).toBe(true)
  })
})
