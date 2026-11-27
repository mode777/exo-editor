#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FEED_MAX_BYTES,
  SOURCES_MAX_BYTES,
  normalizeMarketplaceUrl,
  parseJson,
  validateFeed,
  validateSources,
} from './marketplace-validation.mjs'

const distDir = resolve(process.argv[2] ?? 'apps/shell/dist')

function printIssues(label, issues) {
  for (const issue of issues) {
    const where = issue.field ? ` at ${issue.field}` : ''
    console.error(`${label}: ${issue.code}${where}${issue.message ? ` - ${issue.message}` : ''}`)
  }
}

async function readDocument(name, maxBytes, code) {
  const path = resolve(distDir, name)
  let bytes
  try {
    bytes = await readFile(path)
  } catch {
    throw new Error(`Missing ${path}. Run "npm run deploy:copy-marketplace" first.`)
  }
  if (bytes.byteLength > maxBytes) throw new Error(`${path} exceeds ${maxBytes} bytes.`)
  const parsed = parseJson(new TextDecoder().decode(bytes), code)
  if (!parsed.ok) {
    printIssues(path, parsed.issues)
    throw new Error(`${path} is not valid JSON.`)
  }
  return parsed.value
}

async function main() {
  const sources = await readDocument(
    'marketplace-sources.json',
    SOURCES_MAX_BYTES,
    'invalid-sources',
  )
  const sourcesResult = validateSources(sources)
  if (!sourcesResult.ok) {
    printIssues('marketplace-sources.json', sourcesResult.issues)
    throw new Error('marketplace-sources.json failed validation.')
  }

  const feed = await readDocument('marketplace.json', FEED_MAX_BYTES, 'invalid-feed')
  const feedResult = validateFeed(feed)
  if (!feedResult.ok) {
    printIssues('marketplace.json', feedResult.issues)
    throw new Error('marketplace.json failed validation.')
  }

  const manifestUrls = new Set()
  for (const plugin of feed.plugins) {
    const normalized = normalizeMarketplaceUrl(plugin.manifest)
    if (normalized === null) throw new Error(`Invalid manifest URL for ${plugin.name}.`)
    if (manifestUrls.has(normalized)) throw new Error(`Duplicate manifest URL: ${normalized}`)
    manifestUrls.add(normalized)
  }

  console.log(
    `Marketplace artifact is valid: ${sources.feeds.length} source(s), ${feed.plugins.length} plugin(s).`,
  )
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
