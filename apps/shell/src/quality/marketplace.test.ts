import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMarketplaceFeed, parseMarketplaceSources } from '../marketplace/feed'

function repoRoot(): string {
  let directory = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, 'marketplace/marketplace.json'))) return directory
    directory = dirname(directory)
  }
  throw new Error('Could not find marketplace/marketplace.json.')
}

const root = repoRoot()
const feed = JSON.parse(readFileSync(join(root, 'marketplace/marketplace.json'), 'utf8')) as {
  schemaVersion: number
  id: string
  name: string
  owner: { name: string }
  plugins: Array<{
    name: string
    manifest: string
    version?: string
    publisher?: { name: string }
  }>
}
const sources = JSON.parse(readFileSync(join(root, 'marketplace/sources.json'), 'utf8')) as {
  schemaVersion: number
  feeds: string[]
}

function manifest(path: string): {
  id: string
  name: string
  version: string
  publisher: { name: string }
} {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as {
    id: string
    name: string
    version: string
    publisher: { name: string }
  }
}

const code = manifest('apps/code-plugin/public/exo-manifest.json')
const template = manifest('packages/plugin-template/public/exo-manifest.json')

describe('official marketplace assets', () => {
  it('validates both documents through the shell parser', () => {
    expect(
      parseMarketplaceSources(readFileSync(join(root, 'marketplace/sources.json'), 'utf8')).ok,
    ).toBe(true)
    expect(
      parseMarketplaceFeed(readFileSync(join(root, 'marketplace/marketplace.json'), 'utf8')).ok,
    ).toBe(true)
  })

  it('deploys the feed as the first source', () => {
    expect(sources.schemaVersion).toBe(1)
    expect(sources.feeds[0]).toBe('https://mode777.github.io/exo-editor/marketplace.json')
    expect(new Set(sources.feeds).size).toBe(sources.feeds.length)
  })

  it('declares the official envelope', () => {
    expect(feed.schemaVersion).toBe(1)
    expect(feed.id).toBe('exo-official')
    expect(feed.name).toBe('Exo Plugins')
    expect(feed.owner.name).toBe('Exo Editor')
  })

  it('lists each deployed reference plugin exactly once', () => {
    const urls = feed.plugins.map((plugin) => plugin.manifest)
    expect(urls).toEqual([
      'https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json',
      'https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json',
    ])
    expect(new Set(urls).size).toBe(urls.length)
  })

  it.each([
    ['https://mode777.github.io/exo-editor/code-plugin/exo-manifest.json', code],
    ['https://mode777.github.io/exo-editor/plugin-template/exo-manifest.json', template],
  ])('keeps %s in sync with its manifest', (url, source) => {
    const entry = feed.plugins.find((plugin) => plugin.manifest === url)
    expect(entry).toBeDefined()
    expect(entry?.name).toBe(source.name)
    expect(entry?.version).toBe(source.version)
    expect(entry?.publisher?.name).toBe(source.publisher.name)
  })
})
