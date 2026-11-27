// Shared structural validation for the deploy-time marketplace assets. The
// shell parser in apps/shell/src/marketplace/feed.ts is authoritative for the
// running app; this module keeps the build/deploy scripts honest without adding
// a JSON Schema dependency.

export const MAX_FEEDS = 10
export const MAX_PLUGINS = 500
export const MAX_NAME = 80
export const MAX_DESCRIPTION = 500
export const MAX_KEYWORDS = 10
export const MAX_KEYWORD = 32
export const MAX_LICENSE = 40
export const MAX_CATEGORY = 40
export const SOURCES_MAX_BYTES = 64 * 1024
export const FEED_MAX_BYTES = 512 * 1024

const FEED_ID = /^[a-z0-9][a-z0-9-]{1,63}$/
const SEMVER =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function pointer(...segments) {
  return `/${segments.map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`
}

function issue(code, field, message) {
  return { code, field, message }
}

function checkKeys(value, allowed, base, issues) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      issues.push(issue('invalid-field', pointer(base, key), 'Unknown field'))
  }
}

function text(value, max, field, issues) {
  if (typeof value !== 'string') {
    issues.push(issue('invalid-field', field, 'Expected a string'))
    return false
  }
  if (value.length === 0 || value.length > max) {
    issues.push(issue('invalid-field', field, `Expected 1-${max} characters`))
    return false
  }
  return true
}

export function normalizeMarketplaceUrl(value) {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > 2048) return null
  if (!/^(?:https:\/\/|http:\/\/localhost(?::[0-9]{1,5})?\/?)/.test(value)) return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return null
  if (url.protocol === 'https:') return url.href
  if (url.protocol === 'http:' && url.hostname === 'localhost') return url.href
  return null
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    !/\s/.test(value)
  )
}

export function validateSources(value) {
  const issues = []
  if (!isObject(value)) {
    return { ok: false, issues: [issue('invalid-sources', '/', 'Expected an object')] }
  }
  checkKeys(value, ['schemaVersion', 'feeds'], '', issues)
  if (!has(value, 'schemaVersion')) {
    issues.push(issue('invalid-sources', '/schemaVersion', 'Missing schemaVersion'))
  } else if (value.schemaVersion !== 1) {
    issues.push(issue('unsupported-version', '/schemaVersion', 'Expected schemaVersion 1'))
  }
  if (!has(value, 'feeds')) {
    issues.push(issue('invalid-sources', '/feeds', 'Missing feeds'))
  } else if (!Array.isArray(value.feeds)) {
    issues.push(issue('invalid-sources', '/feeds', 'Expected an array'))
  } else {
    if (value.feeds.length < 1 || value.feeds.length > MAX_FEEDS) {
      issues.push(issue('invalid-sources', '/feeds', `Expected 1-${MAX_FEEDS} feeds`))
    }
    const seen = new Set()
    value.feeds.forEach((feed, index) => {
      const field = pointer('feeds', String(index))
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
  return { ok: issues.length === 0, issues }
}

function validatePublisher(value, base, issues) {
  if (!isObject(value)) {
    issues.push(issue('invalid-field', base, 'Expected an object'))
    return
  }
  checkKeys(value, ['name', 'url'], base, issues)
  if (!has(value, 'name'))
    issues.push(issue('invalid-field', pointer(base, 'name'), 'Missing name'))
  else text(value.name, MAX_NAME, pointer(base, 'name'), issues)
  if (has(value, 'url') && !httpsUrl(value.url)) {
    issues.push(issue('invalid-field', pointer(base, 'url'), 'Expected an https URL'))
  }
}

function validatePlugin(value, index, issues) {
  const base = pointer('plugins', String(index))
  if (!isObject(value)) {
    issues.push(issue('invalid-feed', base, 'Expected an object'))
    return
  }
  checkKeys(
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
  if (!has(value, 'name')) issues.push(issue('invalid-feed', pointer(base, 'name'), 'Missing name'))
  else text(value.name, MAX_NAME, pointer(base, 'name'), issues)

  if (!has(value, 'manifest')) {
    issues.push(issue('invalid-feed', pointer(base, 'manifest'), 'Missing manifest'))
  } else if (normalizeMarketplaceUrl(value.manifest) === null) {
    issues.push(
      issue('invalid-feed', pointer(base, 'manifest'), 'Expected an https or localhost URL'),
    )
  }

  if (has(value, 'description')) {
    text(value.description, MAX_DESCRIPTION, pointer(base, 'description'), issues)
  }
  if (has(value, 'version') && (typeof value.version !== 'string' || !SEMVER.test(value.version))) {
    issues.push(issue('invalid-feed', pointer(base, 'version'), 'Expected SemVer'))
  }
  if (has(value, 'publisher'))
    validatePublisher(value.publisher, pointer(base, 'publisher'), issues)
  for (const key of ['homepage', 'repository', 'icon']) {
    if (has(value, key) && !httpsUrl(value[key])) {
      issues.push(issue('invalid-feed', pointer(base, key), 'Expected an https URL'))
    }
  }
  if (has(value, 'license')) text(value.license, MAX_LICENSE, pointer(base, 'license'), issues)
  if (has(value, 'category')) text(value.category, MAX_CATEGORY, pointer(base, 'category'), issues)
  if (has(value, 'keywords')) {
    if (!Array.isArray(value.keywords)) {
      issues.push(issue('invalid-feed', pointer(base, 'keywords'), 'Expected an array'))
    } else {
      if (value.keywords.length < 1 || value.keywords.length > MAX_KEYWORDS) {
        issues.push(
          issue('invalid-feed', pointer(base, 'keywords'), `Expected 1-${MAX_KEYWORDS} keywords`),
        )
      }
      const seen = new Set()
      value.keywords.forEach((keyword, keywordIndex) => {
        const field = pointer(base, 'keywords', String(keywordIndex))
        text(keyword, MAX_KEYWORD, field, issues)
        if (seen.has(keyword)) issues.push(issue('invalid-feed', field, 'Duplicate keyword'))
        seen.add(keyword)
      })
    }
  }
}

export function validateFeed(value) {
  const issues = []
  if (!isObject(value)) {
    return { ok: false, issues: [issue('invalid-feed', '/', 'Expected an object')] }
  }
  checkKeys(
    value,
    ['schemaVersion', 'id', 'name', 'description', 'owner', 'homepage', 'plugins'],
    '',
    issues,
  )
  if (!has(value, 'schemaVersion')) {
    issues.push(issue('invalid-feed', '/schemaVersion', 'Missing schemaVersion'))
  } else if (value.schemaVersion !== 1) {
    issues.push(issue('unsupported-version', '/schemaVersion', 'Expected schemaVersion 1'))
  }
  if (!has(value, 'id')) issues.push(issue('invalid-feed', '/id', 'Missing id'))
  else if (typeof value.id !== 'string' || !FEED_ID.test(value.id)) {
    issues.push(issue('invalid-feed', '/id', 'Expected a lowercase marketplace id'))
  }
  if (!has(value, 'name')) issues.push(issue('invalid-feed', '/name', 'Missing name'))
  else text(value.name, MAX_NAME, '/name', issues)
  if (has(value, 'description')) text(value.description, MAX_DESCRIPTION, '/description', issues)
  if (!has(value, 'owner')) {
    issues.push(issue('invalid-feed', '/owner', 'Missing owner'))
  } else {
    validatePublisher(value.owner, '/owner', issues)
  }
  if (has(value, 'homepage') && !httpsUrl(value.homepage)) {
    issues.push(issue('invalid-feed', '/homepage', 'Expected an https URL'))
  }
  if (!has(value, 'plugins')) {
    issues.push(issue('invalid-feed', '/plugins', 'Missing plugins'))
  } else if (!Array.isArray(value.plugins)) {
    issues.push(issue('invalid-feed', '/plugins', 'Expected an array'))
  } else {
    if (value.plugins.length > MAX_PLUGINS) {
      issues.push(issue('invalid-feed', '/plugins', `Expected at most ${MAX_PLUGINS} plugins`))
    }
    const seen = new Set()
    value.plugins.forEach((plugin, index) => {
      validatePlugin(plugin, index, issues)
      if (isObject(plugin) && typeof plugin.manifest === 'string') {
        const normalized = normalizeMarketplaceUrl(plugin.manifest)
        if (normalized && seen.has(normalized)) {
          issues.push(
            issue(
              'invalid-feed',
              pointer('plugins', String(index), 'manifest'),
              'Duplicate manifest URL',
            ),
          )
        }
        if (normalized) seen.add(normalized)
      }
    })
  }
  return { ok: issues.length === 0, issues }
}

export function parseJson(text, code) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, issues: [issue(code, '/', 'Invalid JSON')] }
  }
}
