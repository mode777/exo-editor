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
      '0.5.0',
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
    expect(result.manifest.panels.map((panel) => panel.id)).toEqual([
      'fixture-panel',
      'fixture-inspector',
      'fixture-inspector-2',
    ])
    expect(result.manifest.contentViews.map((view) => view.id)).toEqual([
      'fixture-tutorial',
      'fixture-generator',
    ])
    expect(result.manifest.contentViews[0]?.companionPanel).toBe('fixture-inspector')
    expect(result.manifest.contentViews[1]?.companionPanel).toBeUndefined()
    expect(result.manifest.newFiles.map((template) => template.id)).toEqual([
      'fixture.text',
      'fixture.binary',
    ])
    expect(result.manifest.newFiles[1]).toMatchObject({
      fileName: 'fixture-pixel.bin',
      encoding: 'base64',
    })
    expect([...result.manifest.newFiles[1].bytes]).toEqual([0, 1, 2, 255])
    expect(result.manifest.commands).toEqual([
      {
        id: 'fixture.format',
        title: 'Format Fixture',
        category: 'Fixture',
        target: 'activeEditor',
        menus: ['commandPalette', 'editor/title'],
      },
      {
        id: 'fixture.generate',
        title: 'Generate Fixture Report',
        target: { kind: 'panel', id: 'fixture-panel' },
        menus: ['commandPalette', 'explorer/context'],
      },
      {
        id: 'fixture.inspect',
        title: 'Inspect Fixture View',
        target: { kind: 'contentView', id: 'fixture-tutorial' },
        menus: ['commandPalette'],
      },
      {
        id: 'fixture.generator',
        title: 'Open Fixture Generator',
        target: { kind: 'contentView', id: 'fixture-generator' },
        menus: ['commandPalette', 'explorer/context'],
      },
      {
        id: 'fixture.fail',
        title: 'Fail Fixture Command',
        target: 'activeEditor',
        menus: ['commandPalette'],
      },
      {
        id: 'fixture.timeout',
        title: 'Timeout Fixture Command',
        target: 'activeEditor',
        menus: ['commandPalette'],
      },
    ])
    for (const page of [
      ...result.manifest.panels.map((panel) => panel.entry),
      ...result.manifest.contentViews.map((view) => view.entry),
    ]) {
      expect(existsSync(resolve(fixtureDir, page)), page).toBe(true)
    }
    expect(existsSync(resolve(fixtureDir, 'view-common.js'))).toBe(true)
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

  it('registers every declared editor glob and view id', () => {
    const manifest = JSON.parse(readFileSync(resolve(fixtureDir, 'exo-manifest.json'), 'utf8')) as {
      contributes: {
        fileEditors: Array<{ glob: string; entry: string }>
        panels: Array<{ id: string }>
        contentViews: Array<{ id: string }>
        commands: Array<{ id: string }>
      }
    }
    const controller = readFileSync(resolve(fixtureDir, 'plugin.html'), 'utf8')
    for (const editor of manifest.contributes.fileEditors) {
      expect(controller).toContain(`glob: '${editor.glob}'`)
      expect(controller).toContain(`entry: '${editor.entry}'`)
    }
    for (const panel of manifest.contributes.panels) {
      expect(controller).toContain(`'${panel.id}'`)
    }
    for (const view of manifest.contributes.contentViews) {
      expect(controller).toContain(`'${view.id}'`)
    }
    for (const command of manifest.contributes.commands) {
      expect(controller).toContain(`'${command.id}'`)
    }
  })

  it('declares a second identity for cross-plugin local-event and view checks', () => {
    const raw = readFileSync(resolve(fixtureDir, 'other-manifest.json'), 'utf8')
    const result = validateManifest(
      JSON.parse(raw) as unknown,
      'https://mode777.github.io/exo-editor/plugin-host-fixture/other-manifest.json',
      '0.5.0',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.id).toBe('com.example.exo.fixture.other')
    expect(result.manifest.fileEditors).toEqual([
      expect.objectContaining({ glob: '**/*.local-other.txt', entry: 'editor-local-events.html' }),
    ])
    expect(result.manifest.contentViews).toEqual([
      expect.objectContaining({ id: 'other-tutorial', entry: 'view-content.html' }),
    ])
    expect(existsSync(resolve(fixtureDir, 'other-plugin.html'))).toBe(true)
    expect(existsSync(resolve(fixtureDir, 'editor-local-events.html'))).toBe(true)
  })
})
