import { describe, expect, it } from 'vitest'
import {
  MARKETPLACE_MAX_FEEDS,
  MARKETPLACE_MAX_KEYWORDS,
  MARKETPLACE_MAX_PLUGINS,
  parseMarketplaceFeed,
  parseMarketplaceSources,
  validateMarketplaceFeed,
  validateMarketplaceSources,
} from './feed'

function feed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'example-market',
    name: 'Example Market',
    description: 'A small catalog.',
    owner: { name: 'Example', url: 'https://example.com' },
    homepage: 'https://example.com/market',
    plugins: [
      {
        name: 'Example Editor',
        manifest: 'https://plugins.example.com/editor/exo-manifest.json',
        description: 'Edits example files.',
        version: '1.2.3',
        publisher: { name: 'Example' },
        homepage: 'https://example.com/editor',
        repository: 'https://example.com/editor.git',
        license: 'MIT',
        icon: 'https://example.com/icon.png',
        keywords: ['editor', 'example'],
        category: 'Editors',
      },
    ],
    ...overrides,
  }
}

describe('marketplace sources', () => {
  it('accepts the deployed shape', () => {
    const result = validateMarketplaceSources({
      schemaVersion: 1,
      feeds: [
        'https://mode777.github.io/exo-editor/marketplace.json',
        'http://localhost:5173/feed.json',
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sources.feeds).toEqual([
      'https://mode777.github.io/exo-editor/marketplace.json',
      'http://localhost:5173/feed.json',
    ])
  })

  it('rejects an unknown version', () => {
    expect(
      validateMarketplaceSources({ schemaVersion: 2, feeds: ['https://example.com/f.json'] }),
    ).toEqual({
      ok: false,
      issues: [
        {
          code: 'unsupported-version',
          field: '/schemaVersion',
          message: 'Unsupported marketplace schema version',
        },
      ],
    })
  })

  it('rejects unknown fields, empty lists and non-URLs', () => {
    const result = validateMarketplaceSources({
      schemaVersion: 1,
      feeds: ['/relative.json', 'http://example.com/f.json'],
      extra: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toEqual(['/extra', '/feeds/0', '/feeds/1'])
  })

  it('rejects duplicate feed URLs after normalization', () => {
    const result = validateMarketplaceSources({
      schemaVersion: 1,
      feeds: ['https://example.com/feed.json', 'https://example.com/feed.json'],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toEqual(['/feeds/1'])
  })

  it('enforces the feed limit', () => {
    const result = validateMarketplaceSources({
      schemaVersion: 1,
      feeds: Array.from(
        { length: MARKETPLACE_MAX_FEEDS + 1 },
        (_, index) => `https://example.com/${index}.json`,
      ),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.field).toBe('/feeds')
  })

  it('rejects invalid JSON', () => {
    expect(parseMarketplaceSources('{')).toEqual({
      ok: false,
      issues: [{ code: 'invalid-json' }],
    })
  })
})

describe('marketplace feed', () => {
  it('accepts a complete entry', () => {
    const result = validateMarketplaceFeed(feed())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.plugins[0]).toEqual({
      name: 'Example Editor',
      manifest: 'https://plugins.example.com/editor/exo-manifest.json',
      description: 'Edits example files.',
      version: '1.2.3',
      publisher: { name: 'Example' },
      homepage: 'https://example.com/editor',
      repository: 'https://example.com/editor.git',
      license: 'MIT',
      icon: 'https://example.com/icon.png',
      keywords: ['editor', 'example'],
      category: 'Editors',
    })
  })

  it('accepts the minimal entry and an empty catalog', () => {
    expect(
      validateMarketplaceFeed({
        schemaVersion: 1,
        id: 'minimal-market',
        name: 'Minimal',
        owner: { name: 'Example' },
        plugins: [{ name: 'Minimal', manifest: 'http://localhost:5174/exo-manifest.json' }],
      }).ok,
    ).toBe(true)
    expect(validateMarketplaceFeed(feed({ plugins: [] })).ok).toBe(true)
  })

  it('rejects a future schema version', () => {
    const result = validateMarketplaceFeed(feed({ schemaVersion: 2 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual({
      code: 'unsupported-version',
      field: '/schemaVersion',
      message: 'Unsupported marketplace schema version',
    })
  })

  it('rejects unknown fields at every level', () => {
    const result = validateMarketplaceFeed(
      feed({
        injected: true,
        owner: { name: 'Example', injected: true },
        plugins: [
          {
            name: 'Example',
            manifest: 'https://example.com/exo-manifest.json',
            injected: true,
            publisher: { name: 'Example', injected: true },
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toEqual([
      '/injected',
      '/owner/injected',
      '/plugins/0/injected',
      '/plugins/0/publisher/injected',
    ])
  })

  it.each([
    ['relative.json', 'relative'],
    ['http://example.com/exo-manifest.json', 'plain HTTP'],
    ['https://user:pass@example.com/exo-manifest.json', 'credentials'],
    ['https://example.com/exo-manifest.json#fragment', 'fragment'],
  ])('rejects an invalid manifest URL (%s)', (manifest) => {
    const result = validateMarketplaceFeed(feed({ plugins: [{ name: 'Bad', manifest }] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.field).toBe('/plugins/0/manifest')
  })

  it('rejects a duplicate manifest URL', () => {
    const result = validateMarketplaceFeed(
      feed({
        plugins: [
          { name: 'One', manifest: 'https://example.com/exo-manifest.json' },
          { name: 'Two', manifest: 'https://example.com/exo-manifest.json' },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toContainEqual({
      code: 'invalid-feed',
      field: '/plugins/1/manifest',
      message: 'Duplicate manifest URL',
    })
  })

  it('enforces text and collection limits', () => {
    const result = validateMarketplaceFeed(
      feed({
        name: 'n'.repeat(81),
        description: 'd'.repeat(501),
        plugins: Array.from({ length: MARKETPLACE_MAX_PLUGINS + 1 }, (_, index) => ({
          name: `Plugin ${index}`,
          manifest: `https://example.com/${index}/exo-manifest.json`,
        })),
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toContain('/name')
    expect(result.issues.map((issue) => issue.field)).toContain('/description')
    expect(result.issues.map((issue) => issue.field)).toContain('/plugins')
  })

  it('enforces keyword limits and uniqueness', () => {
    const tooMany = validateMarketplaceFeed(
      feed({
        plugins: [
          {
            name: 'Keywords',
            manifest: 'https://example.com/exo-manifest.json',
            keywords: Array.from(
              { length: MARKETPLACE_MAX_KEYWORDS + 1 },
              (_, index) => `k${index}`,
            ),
          },
        ],
      }),
    )
    expect(tooMany.ok).toBe(false)

    const duplicate = validateMarketplaceFeed(
      feed({
        plugins: [
          {
            name: 'Keywords',
            manifest: 'https://example.com/exo-manifest.json',
            keywords: ['same', 'same'],
          },
        ],
      }),
    )
    expect(duplicate.ok).toBe(false)
    if (duplicate.ok) return
    expect(duplicate.issues[0]?.field).toBe('/plugins/0/keywords/1')
  })

  it('keeps hostile display text as text', () => {
    const hostile = '<script>alert(1)</script>'
    const result = validateMarketplaceFeed(
      feed({
        name: hostile,
        plugins: [
          {
            name: hostile,
            manifest: 'https://example.com/exo-manifest.json',
            description: hostile,
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.feed.name).toBe(hostile)
    expect(result.feed.plugins[0]?.name).toBe(hostile)
    expect(result.feed.plugins[0]?.description).toBe(hostile)
  })

  it('rejects invalid publisher, icon and version values', () => {
    const result = validateMarketplaceFeed(
      feed({
        owner: { name: '', url: 'http://example.com' },
        plugins: [
          {
            name: 'Bad',
            manifest: 'https://example.com/exo-manifest.json',
            version: '1.0',
            icon: 'http://example.com/icon.png',
            publisher: { name: '', url: 'javascript:alert(1)' },
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.field)).toEqual([
      '/owner/name',
      '/owner/url',
      '/plugins/0/version',
      '/plugins/0/publisher/name',
      '/plugins/0/publisher/url',
      '/plugins/0/icon',
    ])
  })

  it('rejects invalid JSON without throwing', () => {
    expect(parseMarketplaceFeed('{')).toEqual({
      ok: false,
      issues: [{ code: 'invalid-json' }],
    })
  })
})
