import type { PluginManifest } from './manifest'

/**
 * Consent is machine-wide, keyed by the final manifest origin and plugin id, and
 * bound to a capability fingerprint. The fingerprint input is exactly the one in
 * `docs/contracts/plugin-manifest.md`; display metadata and page paths inside
 * the approved root are deliberately excluded.
 */

export const CONSENT_STORAGE_KEY = 'exo.consent.v1'

export interface ConsentRecord {
  manifestOrigin: string
  pluginId: string
  manifestUrl: string
  version: string
  fingerprint: string
  grantedAt: string
}

export type ConsentRecords = Record<string, ConsentRecord>

export interface FingerprintInput {
  id: string
  entryOrigin: string
  root: string
  permissions: string[]
  fileEditors: Array<{ glob: string; priority: number; rendering?: 'frame' }>
}

export type Digest = (bytes: Uint8Array) => Promise<ArrayBuffer>

export interface ConsentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ConsentStoreOptions {
  /** `null` models storage that is unavailable (for example an opaque origin). */
  storage?: ConsentStorage | null
}

export function consentKey(manifestOrigin: string, pluginId: string): string {
  return `${manifestOrigin}::${pluginId}`
}

/** The exact sorted input that is hashed for the consent fingerprint. */
export function fingerprintInput(
  manifest: Pick<
    PluginManifest,
    'id' | 'manifestOrigin' | 'pluginRoot' | 'permissions' | 'fileEditors'
  >,
): FingerprintInput {
  return {
    id: manifest.id,
    entryOrigin: manifest.manifestOrigin,
    root: manifest.pluginRoot,
    permissions: [...manifest.permissions].sort(),
    fileEditors: manifest.fileEditors
      .map((editor) => ({
        glob: editor.glob,
        priority: editor.priority,
        ...(editor.rendering === 'frame' ? { rendering: 'frame' as const } : {}),
      }))
      .sort((left, right) => left.glob.localeCompare(right.glob) || left.priority - right.priority),
  }
}

async function defaultDigest(bytes: Uint8Array): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('SHA-256 is unavailable in this browser.')
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return subtle.digest('SHA-256', copy)
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** `v1:` plus lowercase hex SHA-256 of the contract's JSON input. */
export async function computeFingerprint(
  manifest: Pick<
    PluginManifest,
    'id' | 'manifestOrigin' | 'pluginRoot' | 'permissions' | 'fileEditors'
  >,
  digest: Digest = defaultDigest,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(fingerprintInput(manifest)))
  const hash = new Uint8Array(await digest(bytes))
  return `v1:${hex(hash)}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isConsentRecord(value: unknown, key: string): value is ConsentRecord {
  if (!isPlainObject(value)) return false
  const fields = [
    'manifestOrigin',
    'pluginId',
    'manifestUrl',
    'version',
    'fingerprint',
    'grantedAt',
  ] as const
  if (!fields.every((field) => typeof value[field] === 'string')) return false
  if (
    Object.keys(value).length !== fields.length ||
    !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  ) {
    return false
  }
  return consentKey(value.manifestOrigin as string, value.pluginId as string) === key
}

function defaultStorage(): ConsentStorage | null {
  if (typeof localStorage === 'undefined') return null
  try {
    // Access can throw in a sandboxed or storage-denied context.
    const probe = localStorage.getItem(CONSENT_STORAGE_KEY)
    void probe
    return localStorage
  } catch {
    return null
  }
}

/**
 * Reads and writes the versioned consent object. A malformed store reads as
 * empty and is never rewritten during a read. Individual bad records are
 * ignored. A write failure is reported so the host can grant for the session.
 */
export class ConsentStore {
  private readonly storage: ConsentStorage | null

  constructor(options: ConsentStoreOptions = {}) {
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
  }

  read(): ConsentRecords {
    if (!this.storage) return {}
    let raw: string | null
    try {
      raw = this.storage.getItem(CONSENT_STORAGE_KEY)
    } catch {
      return {}
    }
    if (!raw) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {}
    }
    if (!isPlainObject(parsed)) return {}
    const records: ConsentRecords = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (isConsentRecord(value, key)) records[key] = value
    }
    return records
  }

  get(manifestOrigin: string, pluginId: string): ConsentRecord | null {
    return this.read()[consentKey(manifestOrigin, pluginId)] ?? null
  }

  grant(record: ConsentRecord): boolean {
    if (!this.storage) return false
    const records = this.read()
    records[consentKey(record.manifestOrigin, record.pluginId)] = record
    try {
      this.storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(records))
      return true
    } catch {
      return false
    }
  }

  revoke(manifestOrigin: string, pluginId: string): boolean {
    if (!this.storage) return false
    const records = this.read()
    delete records[consentKey(manifestOrigin, pluginId)]
    try {
      this.storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(records))
      return true
    } catch {
      return false
    }
  }
}
