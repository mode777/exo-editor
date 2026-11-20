import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CONSENT_STORAGE_KEY,
  ConsentStore,
  computeFingerprint,
  consentKey,
  fingerprintInput,
  type ConsentRecord,
  type ConsentStorage,
  type Digest,
} from './consent'
import type { PluginManifest } from './manifest'

const digest: Digest = async (bytes) => {
  const hash = createHash('sha256').update(bytes).digest()
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
}

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    schemaVersion: 1,
    manifestUrl: 'https://plugins.example.com/monaco/exo-manifest.json',
    manifestOrigin: 'https://plugins.example.com',
    controllerUrl: 'https://plugins.example.com/monaco/plugin.html',
    pluginRoot: '/monaco/',
    id: 'com.example.monaco',
    name: 'Monaco Code Editor',
    version: '1.2.0',
    description: 'Source code editing.',
    publisher: { name: 'Example Corp', url: 'https://example.com' },
    homepage: 'https://example.com/monaco',
    license: 'MIT',
    icon: 'icon.png',
    engines: { exo: '^0.1.0' },
    permissions: ['workspace:read', 'workspace:write'],
    fileEditors: [
      {
        glob: '**/*.ts',
        entry: 'editors/code.html',
        entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
        label: 'Code',
        priority: 10,
      },
    ],
    panels: [],
    contentViews: [],
    ...overrides,
  }
}

class FakeStorage implements ConsentStorage {
  readonly values = new Map<string, string>()
  failWrites = false

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded')
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const record: ConsentRecord = {
  manifestOrigin: 'https://plugins.example.com',
  pluginId: 'com.example.monaco',
  manifestUrl: 'https://plugins.example.com/monaco/exo-manifest.json',
  version: '1.2.0',
  fingerprint: 'v1:abc',
  grantedAt: '2026-11-14T00:00:00.000Z',
}

describe('consent fingerprint', () => {
  it('uses the contract input order', () => {
    expect(fingerprintInput(manifest())).toEqual({
      id: 'com.example.monaco',
      entryOrigin: 'https://plugins.example.com',
      root: '/monaco/',
      permissions: ['workspace:read', 'workspace:write'],
      fileEditors: [{ glob: '**/*.ts', priority: 10 }],
    })
  })

  it('sorts permissions, globs and priorities', async () => {
    const left = manifest({
      permissions: ['workspace:write', 'workspace:read'],
      fileEditors: [
        {
          glob: '**/*.ts',
          entry: 'a.html',
          entryUrl: 'https://plugins.example.com/monaco/a.html',
          label: 'A',
          priority: 10,
        },
        {
          glob: '**/*.js',
          entry: 'b.html',
          entryUrl: 'https://plugins.example.com/monaco/b.html',
          label: 'B',
          priority: 0,
        },
      ],
    })
    const right = manifest({
      permissions: ['workspace:read', 'workspace:write'],
      fileEditors: [
        {
          glob: '**/*.js',
          entry: 'c.html',
          entryUrl: 'https://plugins.example.com/monaco/c.html',
          label: 'C',
          priority: 0,
        },
        {
          glob: '**/*.ts',
          entry: 'd.html',
          entryUrl: 'https://plugins.example.com/monaco/d.html',
          label: 'D',
          priority: 10,
        },
      ],
    })
    expect(await computeFingerprint(left, digest)).toBe(await computeFingerprint(right, digest))
  })

  it('ignores display metadata and page paths', async () => {
    const base = await computeFingerprint(manifest(), digest)
    const cosmetic = await computeFingerprint(
      manifest({
        name: 'Renamed',
        description: 'Different description',
        version: '9.9.9',
        icon: 'other.png',
        publisher: { name: 'Other Corp' },
        homepage: 'https://other.example.com',
        license: 'Apache-2.0',
        fileEditors: [
          {
            glob: '**/*.ts',
            entry: 'editors/renamed.html',
            entryUrl: 'https://plugins.example.com/monaco/editors/renamed.html',
            label: 'Renamed',
            priority: 10,
          },
        ],
      }),
      digest,
    )
    expect(cosmetic).toBe(base)
  })

  it('includes frame rendering but not hidden rendering', async () => {
    const hidden = fingerprintInput(manifest())
    const frame = fingerprintInput(
      manifest({
        fileEditors: [
          {
            glob: '**/*.ts',
            entry: 'editors/code.html',
            entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
            label: 'Code',
            priority: 10,
            rendering: 'frame',
          },
        ],
      }),
    )
    expect(hidden.fileEditors).toEqual([{ glob: '**/*.ts', priority: 10 }])
    expect(frame.fileEditors).toEqual([{ glob: '**/*.ts', priority: 10, rendering: 'frame' }])
  })

  it('ignores contributed configuration', async () => {
    const base = await computeFingerprint(manifest(), digest)
    const configured = await computeFingerprint(
      manifest({
        configuration: {
          properties: {
            'editor.fontSize': { type: 'number', default: 13, scope: 'workspace' },
            'editor.theme': {
              type: 'string',
              default: 'auto',
              enum: ['auto', 'dark'],
              scope: 'workspace',
            },
          },
        },
      }),
      digest,
    )
    expect(configured).toBe(base)
  })

  it('ignores panels and content views', async () => {
    const base = await computeFingerprint(manifest(), digest)
    const withViews = await computeFingerprint(
      manifest({
        panels: [
          {
            id: 'outline',
            title: 'Outline',
            icon: 'list-tree',
            location: 'primary',
            entry: 'views/outline.html',
            entryUrl: 'https://plugins.example.com/monaco/views/outline.html',
          },
        ],
        contentViews: [
          {
            id: 'tutorial',
            title: 'Tutorial',
            entry: 'views/tutorial.html',
            entryUrl: 'https://plugins.example.com/monaco/views/tutorial.html',
          },
        ],
      }),
      digest,
    )
    expect(withViews).toBe(base)
  })

  it('re-prompts when listing is added and keeps read-only consent stable', async () => {
    const readOnly = manifest({ permissions: ['workspace:read'] })
    const withList = manifest({ permissions: ['workspace:read', 'workspace:list'] })

    // The sorted permission input includes listing, so adding it re-prompts.
    expect(fingerprintInput(withList).permissions).toEqual(['workspace:list', 'workspace:read'])
    expect(await computeFingerprint(withList, digest)).not.toBe(
      await computeFingerprint(readOnly, digest),
    )

    // A plugin that never adds listing keeps the fingerprint of its stored consent.
    const stored = await computeFingerprint(readOnly, digest)
    expect(await computeFingerprint(manifest({ permissions: ['workspace:read'] }), digest)).toBe(
      stored,
    )
    expect(
      await computeFingerprint(
        manifest({ permissions: ['workspace:write', 'workspace:read'] }),
        digest,
      ),
    ).not.toBe(await computeFingerprint(manifest({ permissions: ['workspace:read'] }), digest))
  })

  it('changes on every capability field', async () => {
    const base = await computeFingerprint(manifest(), digest)
    const variants = [
      manifest({ id: 'com.example.other' }),
      manifest({ manifestOrigin: 'https://cdn.example.com' }),
      manifest({ pluginRoot: '/other/' }),
      manifest({ permissions: ['workspace:read'] }),
      manifest({
        fileEditors: [
          {
            glob: '**/*.tsx',
            entry: 'editors/code.html',
            entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
            label: 'Code',
            priority: 10,
          },
        ],
      }),
      manifest({
        fileEditors: [
          {
            glob: '**/*.ts',
            entry: 'editors/code.html',
            entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
            label: 'Code',
            priority: 9,
          },
        ],
      }),
    ]
    for (const variant of variants) {
      expect(await computeFingerprint(variant, digest)).not.toBe(base)
    }
  })

  it('formats a versioned lowercase hex digest', async () => {
    const fingerprint = await computeFingerprint(manifest(), digest)
    expect(fingerprint).toMatch(/^v1:[0-9a-f]{64}$/)
  })
})

describe('consent store', () => {
  it('reads an empty store', () => {
    expect(new ConsentStore({ storage: new FakeStorage() }).read()).toEqual({})
  })

  it('discards malformed JSON without rewriting it', () => {
    const storage = new FakeStorage()
    storage.values.set(CONSENT_STORAGE_KEY, '{not json')
    const store = new ConsentStore({ storage })
    expect(store.read()).toEqual({})
    expect(storage.values.get(CONSENT_STORAGE_KEY)).toBe('{not json')
  })

  it('ignores a non-object root', () => {
    const storage = new FakeStorage()
    storage.values.set(CONSENT_STORAGE_KEY, '[]')
    expect(new ConsentStore({ storage }).read()).toEqual({})
  })

  it('keeps valid records and ignores malformed records', () => {
    const storage = new FakeStorage()
    const key = consentKey(record.manifestOrigin, record.pluginId)
    storage.values.set(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        [key]: record,
        'https://other.example.com::bad': { manifestOrigin: 'https://other.example.com' },
        'https://other.example.com::mismatch': { ...record, pluginId: 'different' },
      }),
    )
    expect(new ConsentStore({ storage }).read()).toEqual({ [key]: record })
  })

  it('grants, reads and revokes by origin and id', () => {
    const storage = new FakeStorage()
    const store = new ConsentStore({ storage })
    expect(store.grant(record)).toBe(true)
    expect(store.get(record.manifestOrigin, record.pluginId)).toEqual(record)
    expect(storage.values.get(CONSENT_STORAGE_KEY)).toContain(record.fingerprint)

    expect(store.revoke(record.manifestOrigin, record.pluginId)).toBe(true)
    expect(store.get(record.manifestOrigin, record.pluginId)).toBeNull()
  })

  it('reports write failures without throwing', () => {
    const storage = new FakeStorage()
    storage.failWrites = true
    const store = new ConsentStore({ storage })
    expect(store.grant(record)).toBe(false)
    expect(store.revoke(record.manifestOrigin, record.pluginId)).toBe(false)
  })

  it('treats unavailable storage as empty and unwritable', () => {
    const store = new ConsentStore({ storage: null })
    expect(store.read()).toEqual({})
    expect(store.get(record.manifestOrigin, record.pluginId)).toBeNull()
    expect(store.grant(record)).toBe(false)
    expect(store.revoke(record.manifestOrigin, record.pluginId)).toBe(false)
  })
})
