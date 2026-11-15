import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import {
  IndexedDbPluginSettingsStorage,
  MemoryPluginSettingsStorage,
  PluginSettingsStore,
  resolveSettings,
  validSettingValue,
  type PluginSettingsStorage,
  type RawSettingsByPlugin,
} from './settings'
import type { ManifestConfiguration, ManifestSetting } from './manifest'

const IDENTITY = 'https://plugins.example.com::com.example.monaco'
const OTHER_IDENTITY = 'https://other.example.com::com.example.monaco'

const configuration: ManifestConfiguration = {
  properties: {
    'editor.greeting': {
      type: 'string',
      default: 'hello',
      scope: 'workspace',
    },
    'editor.repeat': {
      type: 'boolean',
      default: false,
      scope: 'workspace',
    },
    'editor.size': {
      type: 'number',
      enum: [1, 2, 3],
      default: 1,
      scope: 'workspace',
    },
  },
}

function setting(overrides: Partial<ManifestSetting> = {}): ManifestSetting {
  return { type: 'string', default: 'x', scope: 'workspace', ...overrides }
}

describe('setting values', () => {
  it('accepts values that match the type and enum', () => {
    expect(validSettingValue(true, setting({ type: 'boolean', default: true }))).toBe(true)
    expect(validSettingValue('text', setting())).toBe(true)
    expect(validSettingValue(2, setting({ type: 'number', default: 1, enum: [1, 2] }))).toBe(true)
  })

  it('rejects wrong types, non-finite numbers, long strings and enum misses', () => {
    expect(validSettingValue('true', setting({ type: 'boolean', default: true }))).toBe(false)
    expect(validSettingValue(Number.NaN, setting({ type: 'number', default: 1 }))).toBe(false)
    expect(
      validSettingValue(Number.POSITIVE_INFINITY, setting({ type: 'number', default: 1 })),
    ).toBe(false)
    expect(validSettingValue('x'.repeat(4097), setting())).toBe(false)
    expect(validSettingValue(4, setting({ type: 'number', default: 1, enum: [1, 2] }))).toBe(false)
    expect(validSettingValue('other', setting({ enum: ['x'] }))).toBe(false)
  })
})

describe('setting resolution', () => {
  it('uses declared defaults when nothing is stored', () => {
    expect(resolveSettings(configuration, undefined)).toEqual({
      values: { 'editor.greeting': 'hello', 'editor.repeat': false, 'editor.size': 1 },
      issues: [],
    })
  })

  it('keeps valid stored values and ignores unknown keys', () => {
    expect(
      resolveSettings(configuration, {
        'editor.greeting': 'hi',
        'editor.repeat': true,
        'editor.size': 3,
        'editor.removed': 'stale',
      }),
    ).toEqual({
      values: { 'editor.greeting': 'hi', 'editor.repeat': true, 'editor.size': 3 },
      issues: [],
    })
  })

  it('falls back to defaults and warns for invalid stored values', () => {
    expect(
      resolveSettings(configuration, {
        'editor.greeting': 42,
        'editor.repeat': 'yes',
        'editor.size': 9,
      }),
    ).toEqual({
      values: { 'editor.greeting': 'hello', 'editor.repeat': false, 'editor.size': 1 },
      issues: [
        { key: 'editor.greeting', code: 'invalid-stored' },
        { key: 'editor.repeat', code: 'invalid-stored' },
        { key: 'editor.size', code: 'invalid-stored' },
      ],
    })
  })

  it('returns no settings for a missing declaration', () => {
    expect(resolveSettings(undefined, { unknown: true })).toEqual({ values: {}, issues: [] })
  })
})

describe('plugin settings storage', () => {
  it('round-trips values through the memory store', async () => {
    const storage = new MemoryPluginSettingsStorage()
    await storage.put('folder:demo', {
      'https://plugins.example.com::com.example.monaco': { 'editor.greeting': 'hi' },
    })
    expect(await storage.get('folder:demo')).toEqual({
      'https://plugins.example.com::com.example.monaco': { 'editor.greeting': 'hi' },
    })
    expect(await storage.get('folder:other')).toBeNull()
  })

  it('reports read and write failures', async () => {
    const storage = new MemoryPluginSettingsStorage()
    storage.failReads = true
    await expect(storage.get('folder:demo')).rejects.toThrow()
    storage.failReads = false
    storage.failWrites = true
    await expect(storage.put('folder:demo', {})).rejects.toThrow()
  })

  it('round-trips values through IndexedDB', async () => {
    const storage = new IndexedDbPluginSettingsStorage(new IDBFactory())
    await storage.put('folder:demo', {
      'https://plugins.example.com::com.example.monaco': { 'editor.size': 2 },
    })
    expect(await storage.get('folder:demo')).toEqual({
      'https://plugins.example.com::com.example.monaco': { 'editor.size': 2 },
    })
    expect(await storage.get('folder:other')).toBeNull()
  })
})

class DeferredStorage implements PluginSettingsStorage {
  readonly reads = new Map<string, (value: RawSettingsByPlugin | null) => void>()

  async get(workspaceId: string): Promise<RawSettingsByPlugin | null> {
    return new Promise((resolve) => {
      this.reads.set(workspaceId, resolve)
    })
  }

  async put(): Promise<void> {
    // No persistence needed for the generation test.
  }
}

describe('plugin settings store', () => {
  it('resolves declared defaults and is idempotent', async () => {
    const store = new PluginSettingsStore({ storage: new MemoryPluginSettingsStorage() })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)
    expect(store.values(IDENTITY)).toEqual({
      'editor.greeting': 'hello',
      'editor.repeat': false,
      'editor.size': 1,
    })
    const revision = store.getSnapshot().revision
    store.declare(IDENTITY, configuration)
    expect(store.getSnapshot().revision).toBe(revision)
  })

  it('keeps identities isolated and emits only the changed plugin values', async () => {
    const changed = vi.fn()
    const store = new PluginSettingsStore({
      storage: new MemoryPluginSettingsStorage(),
      onChange: changed,
    })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)
    store.declare(OTHER_IDENTITY, configuration)

    expect(store.set(IDENTITY, 'editor.greeting', 'hi')).toEqual({ ok: true, changed: true })
    expect(store.values(IDENTITY)['editor.greeting']).toBe('hi')
    expect(store.values(OTHER_IDENTITY)['editor.greeting']).toBe('hello')
    expect(changed).toHaveBeenCalledWith(IDENTITY, {
      'editor.greeting': 'hi',
      'editor.repeat': false,
      'editor.size': 1,
    })
  })

  it('rejects invalid values and unknown settings without changing state', async () => {
    const storage = new MemoryPluginSettingsStorage()
    const changed = vi.fn()
    const store = new PluginSettingsStore({ storage, onChange: changed })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)

    expect(store.set(IDENTITY, 'editor.size', 9)).toEqual({
      ok: false,
      code: 'invalid-value',
    })
    expect(store.set(IDENTITY, 'editor.missing', 'x')).toEqual({
      ok: false,
      code: 'not-declared',
    })
    expect(store.values(IDENTITY)['editor.size']).toBe(1)
    expect(changed).not.toHaveBeenCalled()
    expect(storage.records.get('folder:demo')).toBeUndefined()
  })

  it('falls back to defaults for invalid stored values and keeps the warning', async () => {
    const storage = new MemoryPluginSettingsStorage()
    storage.records.set('folder:demo', {
      [IDENTITY]: { 'editor.greeting': 42, 'editor.size': 9, 'editor.removed': 'stale' },
    })
    const store = new PluginSettingsStore({ storage })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)

    expect(store.values(IDENTITY)).toEqual({
      'editor.greeting': 'hello',
      'editor.repeat': false,
      'editor.size': 1,
    })
    expect(store.getSnapshot().plugins[IDENTITY].issues).toEqual([
      { key: 'editor.greeting', code: 'invalid-stored' },
      { key: 'editor.size', code: 'invalid-stored' },
    ])

    store.set(IDENTITY, 'editor.repeat', true)
    await vi.waitFor(() =>
      expect(storage.records.get('folder:demo')).toEqual({
        [IDENTITY]: { 'editor.greeting': 42, 'editor.repeat': true, 'editor.size': 9 },
      }),
    )
  })

  it('starts from defaults and warns when storage cannot be read', async () => {
    const storage = new MemoryPluginSettingsStorage()
    storage.failReads = true
    const store = new PluginSettingsStore({ storage })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)
    expect(store.values(IDENTITY)['editor.greeting']).toBe('hello')
    expect(store.getSnapshot().storage).toBe('read-failed')
  })

  it('keeps a value for the session and warns when storage cannot be written', async () => {
    const storage = new MemoryPluginSettingsStorage()
    storage.failWrites = true
    const store = new PluginSettingsStore({ storage })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)
    expect(store.set(IDENTITY, 'editor.greeting', 'hi')).toEqual({ ok: true, changed: true })
    expect(store.values(IDENTITY)['editor.greeting']).toBe('hi')
    await vi.waitFor(() => expect(store.getSnapshot().storage).toBe('write-failed'))
  })

  it('does not publish when a declaration resolves to the same values', async () => {
    const store = new PluginSettingsStore({ storage: new MemoryPluginSettingsStorage() })
    await store.attach('folder:demo')
    store.declare(IDENTITY, configuration)
    const listener = vi.fn()
    store.subscribe(listener)
    const revision = store.getSnapshot().revision
    store.declare(IDENTITY, configuration)
    expect(listener).not.toHaveBeenCalled()
    expect(store.getSnapshot().revision).toBe(revision)
  })

  it('ignores a late read from a released workspace', async () => {
    const storage = new DeferredStorage()
    const store = new PluginSettingsStore({ storage })
    const first = store.attach('folder:first')
    const second = store.attach('folder:second')
    store.declare(IDENTITY, configuration)

    storage.reads.get('folder:first')?.({ [IDENTITY]: { 'editor.greeting': 'first' } })
    await first
    storage.reads.get('folder:second')?.({ [IDENTITY]: { 'editor.greeting': 'second' } })
    await second

    expect(store.getSnapshot().workspaceId).toBe('folder:second')
    expect(store.values(IDENTITY)['editor.greeting']).toBe('second')
  })
})
