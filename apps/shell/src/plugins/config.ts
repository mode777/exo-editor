import type { WorkspacePath } from '../workspace/contract'

/**
 * Mirrors the `exoFile` branch of `schema/exo.schema.json`. The schema remains
 * the shared shape; a parity test pins the constants used here so this module
 * cannot drift silently.
 */

export const EXO_CONFIG_PATH: WorkspacePath = '/exo.json'
export const EXO_CONFIG_SCHEMA_VERSION = 1
export const EXO_CONFIG_MAX_PLUGINS = 50
export const EXO_CONFIG_MAX_BYTES = 256 * 1024

export type PluginConfigErrorCode =
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-config'
  | 'too-many-plugins'
  | 'duplicate-manifest'
  | 'too-large'
  | 'not-readable'
  | 'conflict'

export interface PluginConfigIssue {
  code: PluginConfigErrorCode
  path: typeof EXO_CONFIG_PATH
  /** JSON Pointer into the declaration when the problem belongs to a field. */
  field?: string
  /** Zero-based plugin entry index when the problem belongs to one entry. */
  entryIndex?: number
}

export interface ExoPluginEntry {
  manifest: string
  enabled: boolean
}

export interface ExoConfig {
  schemaVersion: typeof EXO_CONFIG_SCHEMA_VERSION
  plugins: ExoPluginEntry[]
}

export interface PluginConfigEntry {
  index: number
  manifest: string
  enabled: boolean
}

export type ExoConfigResult =
  { ok: true; config: ExoConfig } | { ok: false; issues: PluginConfigIssue[] }

/**
 * Exact string from `$defs.manifestUrl.pattern` in the shared schema. Keeping
 * the string identical lets the parity test compare it directly.
 */
export const EXO_MANIFEST_URL_PATTERN =
  '^(?:https://[^\\s@#]+|http://localhost(?::[0-9]{1,5})?(?:/[^\\s@#]*)?)$'

const MANIFEST_URL = new RegExp(EXO_MANIFEST_URL_PATTERN)

function issue(
  code: PluginConfigErrorCode,
  options: { field?: string; entryIndex?: number } = {},
): PluginConfigIssue {
  return { code, path: EXO_CONFIG_PATH, ...options }
}

function pointer(...segments: string[]): string {
  return `/${segments.map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * Return the normalized URL used for duplicate detection, or null when the
 * value is not an allowed manifest URL. The regexes mirror the shared schema;
 * `URL` adds parse, port and credential checks that a regex cannot express.
 */
export function normalizeManifestUrl(value: string): string | null {
  if (!MANIFEST_URL.test(value)) return null
  let url: URL
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

/** Parse strict JSON and validate it as an `exo.json` document. */
export function parseExoConfig(text: string): ExoConfigResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, issues: [issue('invalid-json')] }
  }
  return validateExoConfig(value)
}

/** Validate an already-parsed declaration; collects every issue it can see. */
export function validateExoConfig(value: unknown): ExoConfigResult {
  const issues: PluginConfigIssue[] = []

  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue('invalid-config')] }
  }

  for (const key of Object.keys(value)) {
    if (key !== 'schemaVersion' && key !== 'plugins') {
      issues.push(issue('invalid-config', { field: pointer(key) }))
    }
  }

  if (!hasOwn(value, 'schemaVersion')) {
    issues.push(issue('invalid-config', { field: '/schemaVersion' }))
  } else if (value.schemaVersion !== EXO_CONFIG_SCHEMA_VERSION) {
    issues.push(issue('unsupported-version', { field: '/schemaVersion' }))
  }

  if (!hasOwn(value, 'plugins')) {
    issues.push(issue('invalid-config', { field: '/plugins' }))
    return { ok: false, issues }
  }
  if (!Array.isArray(value.plugins)) {
    issues.push(issue('invalid-config', { field: '/plugins' }))
    return { ok: false, issues }
  }
  if (value.plugins.length > EXO_CONFIG_MAX_PLUGINS) {
    issues.push(issue('too-many-plugins', { field: '/plugins' }))
    return { ok: false, issues }
  }

  const candidates: ExoPluginEntry[] = []
  const seen = new Map<string, number[]>()

  value.plugins.forEach((raw, index) => {
    const base = pointer('plugins', String(index))
    if (!isPlainObject(raw)) {
      issues.push(issue('invalid-config', { field: base, entryIndex: index }))
      return
    }

    for (const key of Object.keys(raw)) {
      if (key !== 'manifest' && key !== 'enabled') {
        issues.push(
          issue('invalid-config', {
            field: pointer('plugins', String(index), key),
            entryIndex: index,
          }),
        )
      }
    }

    let entryValid = true
    let manifest: string | null = null
    if (!hasOwn(raw, 'manifest')) {
      issues.push(
        issue('invalid-config', {
          field: pointer('plugins', String(index), 'manifest'),
          entryIndex: index,
        }),
      )
      entryValid = false
    } else if (typeof raw.manifest !== 'string') {
      issues.push(
        issue('invalid-config', {
          field: pointer('plugins', String(index), 'manifest'),
          entryIndex: index,
        }),
      )
      entryValid = false
    } else {
      const normalized = normalizeManifestUrl(raw.manifest)
      if (normalized === null) {
        issues.push(
          issue('invalid-config', {
            field: pointer('plugins', String(index), 'manifest'),
            entryIndex: index,
          }),
        )
        entryValid = false
      } else {
        manifest = raw.manifest
        const indices = seen.get(normalized) ?? []
        indices.push(index)
        seen.set(normalized, indices)
      }
    }

    let enabled = true
    if (hasOwn(raw, 'enabled')) {
      if (typeof raw.enabled !== 'boolean') {
        issues.push(
          issue('invalid-config', {
            field: pointer('plugins', String(index), 'enabled'),
            entryIndex: index,
          }),
        )
        entryValid = false
      } else {
        enabled = raw.enabled
      }
    }

    if (entryValid && manifest !== null) {
      candidates.push({ manifest, enabled })
    }
  })

  for (const indices of seen.values()) {
    if (indices.length < 2) continue
    for (const index of indices) {
      issues.push(
        issue('duplicate-manifest', {
          field: pointer('plugins', String(index), 'manifest'),
          entryIndex: index,
        }),
      )
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    config: { schemaVersion: EXO_CONFIG_SCHEMA_VERSION, plugins: candidates },
  }
}

export function emptyExoConfig(): ExoConfig {
  return { schemaVersion: EXO_CONFIG_SCHEMA_VERSION, plugins: [] }
}

/**
 * The only serializer used for `exo.json`. Key order, indentation, the explicit
 * `enabled` and the trailing newline are part of the canonical form.
 */
export function serializeExoConfig(config: ExoConfig): string {
  return `${JSON.stringify(
    {
      schemaVersion: EXO_CONFIG_SCHEMA_VERSION,
      plugins: config.plugins.map((entry) => ({
        manifest: entry.manifest,
        enabled: entry.enabled,
      })),
    },
    null,
    2,
  )}\n`
}

export function toPluginConfigEntries(config: ExoConfig): PluginConfigEntry[] {
  return config.plugins.map((entry, index) => ({
    index,
    manifest: entry.manifest,
    enabled: entry.enabled,
  }))
}

export function addPluginEntry(config: ExoConfig, manifest: string): ExoConfig {
  return {
    schemaVersion: EXO_CONFIG_SCHEMA_VERSION,
    plugins: [...config.plugins, { manifest, enabled: true }],
  }
}

export function setPluginEnabled(config: ExoConfig, index: number, enabled: boolean): ExoConfig {
  assertIndex(index, config.plugins.length)
  return {
    schemaVersion: EXO_CONFIG_SCHEMA_VERSION,
    plugins: config.plugins.map((entry, current) =>
      current === index ? { ...entry, enabled } : entry,
    ),
  }
}

export function removePluginEntry(config: ExoConfig, index: number): ExoConfig {
  assertIndex(index, config.plugins.length)
  return {
    schemaVersion: EXO_CONFIG_SCHEMA_VERSION,
    plugins: config.plugins.filter((_, current) => current !== index),
  }
}

function assertIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError('Plugin entry index is out of range.')
  }
}
