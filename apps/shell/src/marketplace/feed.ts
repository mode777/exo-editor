import valid from 'semver/functions/valid.js'
import { normalizeManifestUrl } from '../plugins/config'

/**
 * Mirror of `schema/marketplace.schema.json` plus the semantic rules in
 * `docs/contracts/marketplace.md`. The schema remains the shared shape; a parity
 * test pins the constants used here so this module cannot drift silently.
 */

export const MARKETPLACE_SCHEMA_VERSION = 1
export const MARKETPLACE_SOURCES_MAX_BYTES = 64 * 1024
export const MARKETPLACE_MAX_FEEDS = 10
export const MARKETPLACE_FEED_MAX_BYTES = 512 * 1024
export const MARKETPLACE_MAX_PLUGINS = 500
export const MARKETPLACE_FETCH_TIMEOUT_MS = 10_000
export const MARKETPLACE_MAX_NAME = 80
export const MARKETPLACE_MAX_DESCRIPTION = 500
export const MARKETPLACE_MAX_KEYWORDS = 10
export const MARKETPLACE_MAX_KEYWORD = 32
export const MARKETPLACE_MAX_LICENSE = 40
export const MARKETPLACE_MAX_CATEGORY = 40
export const MARKETPLACE_MAX_URL = 2048
export const MARKETPLACE_FEED_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,63}$'

export type MarketplaceIssueCode =
  | 'network'
  | 'cors'
  | 'timeout'
  | 'http-status'
  | 'too-large'
  | 'invalid-json'
  | 'invalid-sources'
  | 'invalid-feed'
  | 'unsupported-version'

export interface MarketplaceIssue {
  code: MarketplaceIssueCode
  /** JSON Pointer into the document when the problem belongs to a field. */
  field?: string
  message?: string
  status?: number
}

export interface MarketplaceSourceConfig {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  feeds: string[]
}

export interface MarketplacePublisher {
  name: string
  url?: string
}

export interface MarketplaceFeedPlugin {
  name: string
  manifest: string
  description?: string
  version?: string
  publisher?: MarketplacePublisher
  homepage?: string
  repository?: string
  license?: string
  icon?: string
  keywords?: string[]
  category?: string
}

export interface MarketplaceFeed {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  id: string
  name: string
  description?: string
  owner: MarketplacePublisher
  homepage?: string
  plugins: MarketplaceFeedPlugin[]
}

export type MarketplaceSourcesResult =
  { ok: true; sources: MarketplaceSourceConfig } | { ok: false; issues: MarketplaceIssue[] }

export type MarketplaceFeedResult =
  { ok: true; feed: MarketplaceFeed } | { ok: false; issues: MarketplaceIssue[] }

const FEED_ID = new RegExp(MARKETPLACE_FEED_ID_PATTERN)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function escapeSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

/** Build a JSON Pointer from an existing pointer or the empty root. */
function child(base: string, ...segments: string[]): string {
  const suffix = segments.map(escapeSegment).join('/')
  if (base === '') return `/${suffix}`
  return `${base}/${suffix}`
}

function pointer(...segments: string[]): string {
  return child('', ...segments)
}

function issue(code: MarketplaceIssueCode, field?: string, message?: string): MarketplaceIssue {
  return {
    code,
    ...(field === undefined ? {} : { field }),
    ...(message === undefined ? {} : { message }),
  }
}

function checkKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  base: string,
  issues: MarketplaceIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    issues.push(issue('invalid-sources', child(base, key), 'Unknown field'))
  }
}

function checkFeedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  base: string,
  issues: MarketplaceIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    issues.push(issue('invalid-feed', child(base, key), 'Unknown field'))
  }
}

function text(
  value: unknown,
  max: number,
  field: string,
  code: 'invalid-sources' | 'invalid-feed',
  issues: MarketplaceIssue[],
): value is string {
  if (typeof value !== 'string') {
    issues.push(issue(code, field, 'Expected a string'))
    return false
  }
  if (value.length === 0 || value.length > max) {
    issues.push(issue(code, field, `Expected 1-${max} characters`))
    return false
  }
  return true
}

/** Absolute HTTPS URL with no credentials, fragment or whitespace. */
export function normalizeMarketplaceHttpsUrl(value: string): string | null {
  if (value.length === 0 || value.length > MARKETPLACE_MAX_URL) return null
  if (/\s/.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '' || url.hash !== '') return null
  return url.href
}

/** Reuse the manifest URL rule: HTTPS, or localhost HTTP, no credentials/fragment. */
export function normalizeMarketplaceUrl(value: string): string | null {
  const normalized = normalizeManifestUrl(value)
  if (normalized === null) return null
  if (normalized.length > MARKETPLACE_MAX_URL) return null
  return normalized
}

function validatePublisher(
  value: unknown,
  field: string,
  code: 'invalid-sources' | 'invalid-feed',
  issues: MarketplaceIssue[],
): void {
  if (!isPlainObject(value)) {
    issues.push(issue(code, field, 'Expected an object'))
    return
  }
  if (code === 'invalid-sources') checkKeys(value, ['name', 'url'], field, issues)
  else checkFeedKeys(value, ['name', 'url'], field, issues)
  if (!hasOwn(value, 'name')) {
    issues.push(issue(code, child(field, 'name'), 'Missing name'))
  } else {
    text(value.name, MARKETPLACE_MAX_NAME, child(field, 'name'), code, issues)
  }
  if (hasOwn(value, 'url')) {
    if (typeof value.url !== 'string' || normalizeMarketplaceHttpsUrl(value.url) === null) {
      issues.push(issue(code, child(field, 'url'), 'Expected an https URL'))
    }
  }
}

function validateFeedPlugin(value: unknown, index: number, issues: MarketplaceIssue[]): void {
  const base = pointer('plugins', String(index))
  if (!isPlainObject(value)) {
    issues.push(issue('invalid-feed', base, 'Expected an object'))
    return
  }
  checkFeedKeys(
    value,
    [
      'name',
      'manifest',
      'description',
      'version',
      'publisher',
      'homepage',
      'repository',
      'license',
      'icon',
      'keywords',
      'category',
    ],
    base,
    issues,
  )

  if (!hasOwn(value, 'name')) {
    issues.push(issue('invalid-feed', child(base, 'name'), 'Missing name'))
  } else {
    text(value.name, MARKETPLACE_MAX_NAME, child(base, 'name'), 'invalid-feed', issues)
  }

  if (!hasOwn(value, 'manifest')) {
    issues.push(issue('invalid-feed', child(base, 'manifest'), 'Missing manifest'))
  } else if (
    typeof value.manifest !== 'string' ||
    normalizeMarketplaceUrl(value.manifest) === null
  ) {
    issues.push(
      issue('invalid-feed', child(base, 'manifest'), 'Expected an https or localhost URL'),
    )
  }

  if (hasOwn(value, 'description')) {
    text(
      value.description,
      MARKETPLACE_MAX_DESCRIPTION,
      child(base, 'description'),
      'invalid-feed',
      issues,
    )
  }
  if (hasOwn(value, 'version')) {
    if (typeof value.version !== 'string' || valid(value.version) === null) {
      issues.push(issue('invalid-feed', child(base, 'version'), 'Expected SemVer'))
    }
  }
  if (hasOwn(value, 'publisher')) {
    validatePublisher(value.publisher, child(base, 'publisher'), 'invalid-feed', issues)
  }
  for (const key of ['homepage', 'repository', 'icon'] as const) {
    if (!hasOwn(value, key)) continue
    const candidate = value[key]
    if (typeof candidate !== 'string' || normalizeMarketplaceHttpsUrl(candidate) === null) {
      issues.push(issue('invalid-feed', child(base, key), 'Expected an https URL'))
    }
  }
  if (hasOwn(value, 'license')) {
    text(value.license, MARKETPLACE_MAX_LICENSE, child(base, 'license'), 'invalid-feed', issues)
  }
  if (hasOwn(value, 'category')) {
    text(value.category, MARKETPLACE_MAX_CATEGORY, child(base, 'category'), 'invalid-feed', issues)
  }
  if (hasOwn(value, 'keywords')) {
    if (!Array.isArray(value.keywords)) {
      issues.push(issue('invalid-feed', child(base, 'keywords'), 'Expected an array'))
    } else {
      if (value.keywords.length < 1 || value.keywords.length > MARKETPLACE_MAX_KEYWORDS) {
        issues.push(
          issue(
            'invalid-feed',
            child(base, 'keywords'),
            `Expected 1-${MARKETPLACE_MAX_KEYWORDS} keywords`,
          ),
        )
      }
      const seen = new Set<string>()
      value.keywords.forEach((keyword, keywordIndex) => {
        const field = child(base, 'keywords', String(keywordIndex))
        if (text(keyword, MARKETPLACE_MAX_KEYWORD, field, 'invalid-feed', issues)) {
          if (seen.has(keyword)) issues.push(issue('invalid-feed', field, 'Duplicate keyword'))
          seen.add(keyword)
        }
      })
    }
  }
}

export function validateMarketplaceSources(value: unknown): MarketplaceSourcesResult {
  const issues: MarketplaceIssue[] = []
  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue('invalid-sources', '/', 'Expected an object')] }
  }
  checkKeys(value, ['schemaVersion', 'feeds'], '', issues)

  if (!hasOwn(value, 'schemaVersion')) {
    issues.push(issue('invalid-sources', '/schemaVersion', 'Missing schemaVersion'))
  } else if (value.schemaVersion !== MARKETPLACE_SCHEMA_VERSION) {
    issues.push(
      issue('unsupported-version', '/schemaVersion', 'Unsupported marketplace schema version'),
    )
  }

  if (!hasOwn(value, 'feeds')) {
    issues.push(issue('invalid-sources', '/feeds', 'Missing feeds'))
  } else if (!Array.isArray(value.feeds)) {
    issues.push(issue('invalid-sources', '/feeds', 'Expected an array'))
  } else {
    if (value.feeds.length < 1 || value.feeds.length > MARKETPLACE_MAX_FEEDS) {
      issues.push(issue('invalid-sources', '/feeds', `Expected 1-${MARKETPLACE_MAX_FEEDS} feeds`))
    }
    const seen = new Set<string>()
    value.feeds.forEach((feed, index) => {
      const field = pointer('feeds', String(index))
      if (typeof feed !== 'string') {
        issues.push(issue('invalid-sources', field, 'Expected a string'))
        return
      }
      const normalized = normalizeMarketplaceUrl(feed)
      if (normalized === null) {
        issues.push(issue('invalid-sources', field, 'Expected an https or localhost URL'))
        return
      }
      if (seen.has(normalized)) {
        issues.push(issue('invalid-sources', field, 'Duplicate feed URL'))
      }
      seen.add(normalized)
    })
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    sources: {
      schemaVersion: MARKETPLACE_SCHEMA_VERSION,
      feeds: (value.feeds as string[]).slice(),
    },
  }
}

export function parseMarketplaceSources(text: string): MarketplaceSourcesResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, issues: [issue('invalid-json')] }
  }
  return validateMarketplaceSources(value)
}

export function validateMarketplaceFeed(value: unknown): MarketplaceFeedResult {
  const issues: MarketplaceIssue[] = []
  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue('invalid-feed', '/', 'Expected an object')] }
  }
  checkFeedKeys(
    value,
    ['schemaVersion', 'id', 'name', 'description', 'owner', 'homepage', 'plugins'],
    '',
    issues,
  )

  if (!hasOwn(value, 'schemaVersion')) {
    issues.push(issue('invalid-feed', '/schemaVersion', 'Missing schemaVersion'))
  } else if (value.schemaVersion !== MARKETPLACE_SCHEMA_VERSION) {
    issues.push(
      issue('unsupported-version', '/schemaVersion', 'Unsupported marketplace schema version'),
    )
  }

  if (!hasOwn(value, 'id')) {
    issues.push(issue('invalid-feed', '/id', 'Missing id'))
  } else if (typeof value.id !== 'string' || !FEED_ID.test(value.id)) {
    issues.push(issue('invalid-feed', '/id', 'Expected a lowercase marketplace id'))
  }

  if (!hasOwn(value, 'name')) {
    issues.push(issue('invalid-feed', '/name', 'Missing name'))
  } else {
    text(value.name, MARKETPLACE_MAX_NAME, '/name', 'invalid-feed', issues)
  }

  if (hasOwn(value, 'description')) {
    text(value.description, MARKETPLACE_MAX_DESCRIPTION, '/description', 'invalid-feed', issues)
  }

  if (!hasOwn(value, 'owner')) {
    issues.push(issue('invalid-feed', '/owner', 'Missing owner'))
  } else {
    validatePublisher(value.owner, '/owner', 'invalid-feed', issues)
  }

  if (hasOwn(value, 'homepage')) {
    if (
      typeof value.homepage !== 'string' ||
      normalizeMarketplaceHttpsUrl(value.homepage) === null
    ) {
      issues.push(issue('invalid-feed', '/homepage', 'Expected an https URL'))
    }
  }

  if (!hasOwn(value, 'plugins')) {
    issues.push(issue('invalid-feed', '/plugins', 'Missing plugins'))
  } else if (!Array.isArray(value.plugins)) {
    issues.push(issue('invalid-feed', '/plugins', 'Expected an array'))
  } else {
    if (value.plugins.length > MARKETPLACE_MAX_PLUGINS) {
      issues.push(
        issue('invalid-feed', '/plugins', `Expected at most ${MARKETPLACE_MAX_PLUGINS} plugins`),
      )
    }
    const seen = new Set<string>()
    value.plugins.forEach((plugin, index) => {
      validateFeedPlugin(plugin, index, issues)
      if (isPlainObject(plugin) && typeof plugin.manifest === 'string') {
        const normalized = normalizeMarketplaceUrl(plugin.manifest)
        if (normalized === null) return
        if (seen.has(normalized)) {
          issues.push(
            issue(
              'invalid-feed',
              pointer('plugins', String(index), 'manifest'),
              'Duplicate manifest URL',
            ),
          )
        }
        seen.add(normalized)
      }
    })
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    feed: {
      schemaVersion: MARKETPLACE_SCHEMA_VERSION,
      id: value.id as string,
      name: value.name as string,
      ...(value.description === undefined ? {} : { description: value.description as string }),
      owner: compactPublisher(value.owner),
      ...(value.homepage === undefined ? {} : { homepage: value.homepage as string }),
      plugins: (value.plugins as Record<string, unknown>[]).map(compactPlugin),
    },
  }
}

export function parseMarketplaceFeed(text: string): MarketplaceFeedResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, issues: [issue('invalid-json')] }
  }
  return validateMarketplaceFeed(value)
}

function compactPublisher(value: unknown): MarketplacePublisher {
  const record = value as Record<string, unknown>
  return {
    name: record.name as string,
    ...(record.url === undefined ? {} : { url: record.url as string }),
  }
}

function compactPlugin(value: Record<string, unknown>): MarketplaceFeedPlugin {
  return {
    name: value.name as string,
    manifest: value.manifest as string,
    ...(value.description === undefined ? {} : { description: value.description as string }),
    ...(value.version === undefined ? {} : { version: value.version as string }),
    ...(value.publisher === undefined ? {} : { publisher: compactPublisher(value.publisher) }),
    ...(value.homepage === undefined ? {} : { homepage: value.homepage as string }),
    ...(value.repository === undefined ? {} : { repository: value.repository as string }),
    ...(value.license === undefined ? {} : { license: value.license as string }),
    ...(value.icon === undefined ? {} : { icon: value.icon as string }),
    ...(value.keywords === undefined ? {} : { keywords: (value.keywords as string[]).slice() }),
    ...(value.category === undefined ? {} : { category: value.category as string }),
  }
}
