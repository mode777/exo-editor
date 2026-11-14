import { describe, expect, it } from 'vitest'
import type { RegisteredEditor } from './registration'
import { EditorRegistry } from './registry'

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

describe('editor registry', () => {
  it('has no candidates for an unmatched path', () => {
    const registry = new EditorRegistry()
    registry.add('a', 0, [editor()])
    expect(registry.match('/src/readme.md')).toEqual([])
  })

  it('returns one candidate for a match', () => {
    const registry = new EditorRegistry()
    registry.add('a', 0, [editor()])
    expect(registry.match('/src/a.ts')).toEqual([
      {
        identity: 'a',
        pluginOrder: 0,
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
    registry.add('low', 0, [editor({ priority: 0, label: 'Low' })])
    registry.add('high', 1, [editor({ priority: 10, label: 'High' })])
    expect(registry.match('/a.ts').map((candidate) => candidate.label)).toEqual(['High', 'Low'])
  })

  it('breaks a priority tie by declaration order, not add order', () => {
    const registry = new EditorRegistry()
    registry.add('second', 1, [editor({ label: 'Second' })])
    registry.add('first', 0, [editor({ label: 'First' })])
    expect(registry.match('/a.ts').map((candidate) => candidate.identity)).toEqual([
      'first',
      'second',
    ])
  })

  it('breaks a declaration tie by registration order', () => {
    const registry = new EditorRegistry()
    registry.add('plugin', 0, [
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
    registry.add('a', 0, [editor({ label: 'A' })])
    registry.add('b', 1, [editor({ label: 'B' })])
    expect(registry.match('/a.ts')).toHaveLength(2)
    expect(registry.match('/a.ts')[0].label).toBe('A')
  })

  it('removes a plugin and replaces a re-added plugin', () => {
    const registry = new EditorRegistry()
    registry.add('a', 0, [editor({ label: 'Old' })])
    registry.add('a', 0, [editor({ label: 'New' })])
    expect(registry.match('/a.ts').map((candidate) => candidate.label)).toEqual(['New'])
    registry.remove('a')
    expect(registry.match('/a.ts')).toEqual([])
  })

  it('clears every registration', () => {
    const registry = new EditorRegistry()
    registry.add('a', 0, [editor()])
    registry.add('b', 1, [editor({ glob: '**/*.md' })])
    expect(registry.all()).toHaveLength(2)
    registry.clear()
    expect(registry.all()).toEqual([])
    expect(registry.match('/a.ts')).toEqual([])
  })
})
