import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXO_MANIFEST_URL_PATTERN } from '../plugins/config'
import {
  MARKETPLACE_FEED_ID_PATTERN,
  MARKETPLACE_FEED_MAX_BYTES,
  MARKETPLACE_MAX_CATEGORY,
  MARKETPLACE_MAX_DESCRIPTION,
  MARKETPLACE_MAX_FEEDS,
  MARKETPLACE_MAX_KEYWORDS,
  MARKETPLACE_MAX_KEYWORD,
  MARKETPLACE_MAX_LICENSE,
  MARKETPLACE_MAX_NAME,
  MARKETPLACE_MAX_PLUGINS,
  MARKETPLACE_MAX_URL,
  MARKETPLACE_SCHEMA_VERSION,
  MARKETPLACE_SOURCES_MAX_BYTES,
} from './feed'

describe('marketplace schema parity', () => {
  it('pins the parser constants to the shared schema', () => {
    let directory = process.cwd()
    let schemaText: string | null = null
    for (let depth = 0; depth < 6 && schemaText === null; depth += 1) {
      const candidate = join(directory, 'schema/marketplace.schema.json')
      if (existsSync(candidate)) schemaText = readFileSync(candidate, 'utf8')
      directory = dirname(directory)
    }
    if (schemaText === null) throw new Error('schema/marketplace.schema.json was not found')

    const schema = JSON.parse(schemaText) as {
      oneOf: Array<{ $ref: string }>
      $defs: {
        marketplaceUrl: { pattern: string; maxLength: number }
        feedPlugin: {
          additionalProperties: boolean
          required: string[]
          properties: {
            keywords: { maxItems: number; uniqueItems: boolean; items: { $ref: string } }
            name: { $ref: string }
            description: { $ref: string }
            license: { $ref: string }
            category: { $ref: string }
          }
        }
        marketplaceSources: {
          additionalProperties: boolean
          required: string[]
          properties: {
            schemaVersion: { const: number }
            feeds: {
              minItems: number
              maxItems: number
              uniqueItems: boolean
              items: { $ref: string }
            }
          }
        }
        marketplaceFeed: {
          additionalProperties: boolean
          required: string[]
          properties: {
            schemaVersion: { const: number }
            id: { pattern: string }
            name: { $ref: string }
            plugins: { maxItems: number; items: { $ref: string } }
          }
        }
        displayName: { maxLength: number }
        description: { maxLength: number }
        license: { maxLength: number }
        category: { maxLength: number }
        keyword: { maxLength: number }
      }
    }

    expect(schema.oneOf).toEqual([
      { $ref: '#/$defs/marketplaceSources' },
      { $ref: '#/$defs/marketplaceFeed' },
    ])
    expect(schema.$defs.marketplaceSources.additionalProperties).toBe(false)
    expect(schema.$defs.marketplaceSources.required).toEqual(['schemaVersion', 'feeds'])
    expect(schema.$defs.marketplaceSources.properties.schemaVersion.const).toBe(
      MARKETPLACE_SCHEMA_VERSION,
    )
    expect(schema.$defs.marketplaceSources.properties.feeds.minItems).toBe(1)
    expect(schema.$defs.marketplaceSources.properties.feeds.maxItems).toBe(MARKETPLACE_MAX_FEEDS)
    expect(schema.$defs.marketplaceSources.properties.feeds.uniqueItems).toBe(true)

    expect(schema.$defs.marketplaceFeed.additionalProperties).toBe(false)
    expect(schema.$defs.marketplaceFeed.required).toEqual([
      'schemaVersion',
      'id',
      'name',
      'owner',
      'plugins',
    ])
    expect(schema.$defs.marketplaceFeed.properties.schemaVersion.const).toBe(
      MARKETPLACE_SCHEMA_VERSION,
    )
    expect(schema.$defs.marketplaceFeed.properties.id.pattern).toBe(MARKETPLACE_FEED_ID_PATTERN)
    expect(schema.$defs.marketplaceFeed.properties.plugins.maxItems).toBe(MARKETPLACE_MAX_PLUGINS)

    expect(schema.$defs.feedPlugin.additionalProperties).toBe(false)
    expect(schema.$defs.feedPlugin.required).toEqual(['name', 'manifest'])
    expect(schema.$defs.feedPlugin.properties.keywords.maxItems).toBe(MARKETPLACE_MAX_KEYWORDS)
    expect(schema.$defs.feedPlugin.properties.keywords.uniqueItems).toBe(true)

    expect(schema.$defs.marketplaceUrl.pattern).toBe(EXO_MANIFEST_URL_PATTERN)
    expect(schema.$defs.marketplaceUrl.maxLength).toBe(MARKETPLACE_MAX_URL)
    expect(schema.$defs.displayName.maxLength).toBe(MARKETPLACE_MAX_NAME)
    expect(schema.$defs.description.maxLength).toBe(MARKETPLACE_MAX_DESCRIPTION)
    expect(schema.$defs.keyword.maxLength).toBe(MARKETPLACE_MAX_KEYWORD)
    expect(schema.$defs.license.maxLength).toBe(MARKETPLACE_MAX_LICENSE)
    expect(schema.$defs.category.maxLength).toBe(MARKETPLACE_MAX_CATEGORY)
    expect(MARKETPLACE_SOURCES_MAX_BYTES).toBe(64 * 1024)
    expect(MARKETPLACE_FEED_MAX_BYTES).toBe(512 * 1024)
  })
})
