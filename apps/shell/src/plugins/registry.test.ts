import { describe, expect, it } from 'vitest'
import type { PluginPermission } from './manifest'
import type { RegisteredEditor } from './registration'
import { EditorRegistry, type EditorPluginInfo } from './registry'

function editor(overrides: Partial<RegisteredEditor> = {}): RegisteredEditor {
  return {
    glob: '**/*.ts',
    entry: 'editor.html',
    entryUrl: 'https://plugins.example.com/a/editor.html',
    label: 'Code',
    priority: 0,
    registrationOrder: 0,
    ...overrides,
  }
}

function plugin(
  identity: string,
  pluginOrder: number,
  overrides: Partial<EditorPluginInfo> = {},
): EditorPluginInfo {
  return {
    identity,
    pluginOrder,
    pluginName: `Plugin ${identity}`,
    pluginId: `com.example.${identity}`,
    pluginVersion: '1.0.0',
    origin: 'https://plugins.example.com',
    permissions: ['workspace:read'] as PluginPermission[],
    ...overrides,
  }
}

describe('editor registry', () => {
  it('has no candidates for an unmatched path', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('a', 0), [editor()])
    expect(registry.match('/src/readme.md')).toEqual([])
  })

  it('carries plugin metadata on the candidate', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('a', 0, { pluginName: 'Code Plugin', permissions: ['workspace:write'] }), [
      editor(),
    ])
    expect(registry.match('/src/a.ts')).toEqual([
      {
        identity: 'a',
        pluginOrder: 0,
        pluginName: 'Code Plugin',
        pluginId: 'com.example.a',
        pluginVersion: '1.0.0',
        origin: 'https://plugins.example.com',
        permissions: ['workspace:write'],
        glob: '**/*.ts',
        entry: 'editor.html',
        entryUrl: 'https://plugins.example.com/a/editor.html',
        label: 'Code',
        priority: 0,
        registrationOrder: 0,
      },
    ])
  })

  it('orders by priority descending', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('low', 0), [editor({ priority: 0, label: 'Low' })])
    registry.add(plugin('high', 1), [editor({ priority: 10, label: 'High' })])
    expect(registry.match('/a.ts').map((candidate) => candidate.label)).toEqual(['High', 'Low'])
  })

  it('breaks a priority tie by declaration order, not add order', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('second', 1), [editor({ label: 'Second' })])
    registry.add(plugin('first', 0), [editor({ label: 'First' })])
    expect(registry.match('/a.ts').map((candidate) => candidate.identity)).toEqual([
      'first',
      'second',
    ])
  })

  it('breaks a declaration tie by registration order', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('plugin', 0), [
      editor({ label: 'Later', registrationOrder: 1 }),
      editor({ label: 'Earlier', registrationOrder: 0 }),
    ])
    expect(registry.match('/a.ts').map((candidate) => candidate.label)).toEqual([
      'Earlier',
      'Later',
    ])
  })

  it('returns every matching candidate in order', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('a', 0), [editor({ label: 'A' })])
    registry.add(plugin('b', 1), [editor({ label: 'B' })])
    expect(registry.match('/a.ts')).toHaveLength(2)
    expect(registry.match('/a.ts')[0].label).toBe('A')
  })

  it('removes a plugin and replaces a re-added plugin', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('a', 0), [editor({ label: 'Old' })])
    registry.add(plugin('a', 0), [editor({ label: 'New' })])
    expect(registry.match('/a.ts').map((candidate) => candidate.label)).toEqual(['New'])
    registry.remove('a')
    expect(registry.match('/a.ts')).toEqual([])
  })

  it('clears every registration', () => {
    const registry = new EditorRegistry()
    registry.add(plugin('a', 0), [editor()])
    registry.add(plugin('b', 1), [editor({ glob: '**/*.md' })])
    expect(registry.all()).toHaveLength(2)
    registry.clear()
    expect(registry.all()).toEqual([])
    expect(registry.match('/a.ts')).toEqual([])
  })
})
