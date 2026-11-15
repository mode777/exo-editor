import { WorkspaceError } from '../workspace/contract'
import {
  MANIFEST_MAX_SETTING_STRING,
  type ManifestConfiguration,
  type ManifestSetting,
  type SettingValue,
} from './manifest'

/**
 * Workspace-scoped plugin settings live in shell storage, never in the
 * workspace. This module owns value validation, default resolution and the
 * IndexedDB seam; `PluginSettingsStore` adds lifecycle and snapshots.
 */

export type SettingValues = Record<string, SettingValue>
export type RawSettingValues = Record<string, unknown>
export type RawSettingsByPlugin = Record<string, RawSettingValues>

export interface SettingIssue {
  key: string
  code: 'invalid-stored'
}

export interface ResolvedSettings {
  values: SettingValues
  issues: SettingIssue[]
}

export type SettingsStorageState = 'ok' | 'read-failed' | 'write-failed'

export interface PluginSettingsStorage {
  get(workspaceId: string): Promise<RawSettingsByPlugin | null>
  put(workspaceId: string, values: RawSettingsByPlugin): Promise<void>
}

const DB_NAME = 'exo-plugin-settings'
const DB_VERSION = 1
const STORE_NAME = 'settings'

function storageError(error: unknown): WorkspaceError {
  return new WorkspaceError('io', 'Plugin settings could not be stored.', { cause: error })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(storageError(request.error))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(storageError(transaction.error))
    transaction.onabort = () => reject(storageError(transaction.error))
  })
}

function cloneRawSettings(values: RawSettingsByPlugin | null): RawSettingsByPlugin {
  if (!values || typeof values !== 'object') return {}
  const copy: RawSettingsByPlugin = {}
  for (const [identity, settings] of Object.entries(values)) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue
    copy[identity] = { ...settings }
  }
  return copy
}

/** A value is usable only when it matches the declaration's type and enum. */
export function validSettingValue(value: unknown, setting: ManifestSetting): value is SettingValue {
  if (setting.type === 'boolean') return typeof value === 'boolean'
  if (setting.type === 'string') {
    if (typeof value !== 'string' || value.length > MANIFEST_MAX_SETTING_STRING) return false
    return !setting.enum || setting.enum.includes(value)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  return !setting.enum || setting.enum.includes(value)
}

/**
 * Resolve stored values against the current declaration. Unknown stored keys are
 * dropped; a declared key with an unusable stored value falls back to its default
 * and records an `invalid-stored` issue.
 */
export function resolveSettings(
  configuration: ManifestConfiguration | undefined,
  stored: RawSettingValues | undefined,
): ResolvedSettings {
  if (!configuration) return { values: {}, issues: [] }
  const values: SettingValues = {}
  const issues: SettingIssue[] = []
  for (const [key, setting] of Object.entries(configuration.properties)) {
    const hasStored = stored !== undefined && Object.prototype.hasOwnProperty.call(stored, key)
    const candidate = hasStored ? stored[key] : undefined
    if (hasStored && validSettingValue(candidate, setting)) {
      values[key] = candidate
      continue
    }
    values[key] = setting.default
    if (hasStored) issues.push({ key, code: 'invalid-stored' })
  }
  return { values, issues }
}

export class IndexedDbPluginSettingsStorage implements PluginSettingsStorage {
  private readonly factory: IDBFactory
  private database: Promise<IDBDatabase> | null = null

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.factory = factory
  }

  async get(workspaceId: string): Promise<RawSettingsByPlugin | null> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const result = await requestResult(transaction.objectStore(STORE_NAME).get(workspaceId))
      if (!result || typeof result !== 'object') return null
      const record = result as { values?: unknown }
      return cloneRawSettings(
        record.values && typeof record.values === 'object'
          ? (record.values as RawSettingsByPlugin)
          : null,
      )
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async put(workspaceId: string, values: RawSettingsByPlugin): Promise<void> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put({ workspaceId, values }, workspaceId)
      await transactionDone(transaction)
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database
    if (!this.factory) {
      this.database = Promise.reject(
        new WorkspaceError('unsupported', 'IndexedDB is not available.'),
      )
      return this.database
    }
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(storageError(request.error))
      request.onblocked = () =>
        reject(storageError(new Error('The plugin settings database is blocked.')))
    })
    return this.database
  }
}

export class MemoryPluginSettingsStorage implements PluginSettingsStorage {
  readonly records = new Map<string, RawSettingsByPlugin>()
  failReads = false
  failWrites = false

  async get(workspaceId: string): Promise<RawSettingsByPlugin | null> {
    if (this.failReads) throw storageError(new Error('read failed'))
    const record = this.records.get(workspaceId)
    return record ? cloneRawSettings(record) : null
  }

  async put(workspaceId: string, values: RawSettingsByPlugin): Promise<void> {
    if (this.failWrites) throw storageError(new Error('write failed'))
    this.records.set(workspaceId, cloneRawSettings(values))
  }
}

export interface PluginSettingsView {
  values: SettingValues
  issues: SettingIssue[]
}

export interface PluginSettingsSnapshot {
  workspaceId: string | null
  plugins: Record<string, PluginSettingsView>
  storage: SettingsStorageState
  revision: number
}

export type SetSettingResult =
  | { ok: true; changed: boolean }
  | { ok: false; code: 'not-attached' | 'not-declared' | 'invalid-value' }

export interface PluginSettingsStoreOptions {
  storage?: PluginSettingsStorage
  /** Called after a valid change has been accepted into the in-memory store. */
  onChange?: (identity: string, values: SettingValues) => void
}

const INITIAL_SNAPSHOT: PluginSettingsSnapshot = {
  workspaceId: null,
  plugins: {},
  storage: 'ok',
  revision: 0,
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * One workspace's shell-owned plugin settings. Declarations arrive as manifests
 * validate; stored values arrive from IndexedDB. The store never writes to the
 * workspace and never exposes another plugin's values through `values` or an
 * `onChange` callback.
 */
export class PluginSettingsStore {
  private readonly storage: PluginSettingsStorage
  private readonly onChange: ((identity: string, values: SettingValues) => void) | undefined
  private readonly listeners = new Set<() => void>()
  private readonly configuration = new Map<string, ManifestConfiguration>()
  private readonly raw = new Map<string, RawSettingValues>()
  private readonly views = new Map<string, PluginSettingsView>()
  private snapshot: PluginSettingsSnapshot = INITIAL_SNAPSHOT
  private signature = ''
  private workspaceId: string | null = null
  private storageState: SettingsStorageState = 'ok'
  private generation = 0
  private writeSeq = 0

  constructor(options: PluginSettingsStoreOptions = {}) {
    this.storage = options.storage ?? new IndexedDbPluginSettingsStorage()
    this.onChange = options.onChange
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PluginSettingsSnapshot => this.snapshot

  async attach(workspaceId: string): Promise<void> {
    this.detach()
    const generation = this.generation
    this.workspaceId = workspaceId
    this.storageState = 'ok'
    this.publish()

    let stored: RawSettingsByPlugin | null
    try {
      stored = await this.storage.get(workspaceId)
    } catch {
      if (generation !== this.generation) return
      this.storageState = 'read-failed'
      this.recomputeAll()
      this.publish()
      return
    }
    if (generation !== this.generation) return

    this.raw.clear()
    if (stored) {
      for (const [identity, values] of Object.entries(stored)) {
        this.raw.set(identity, { ...values })
      }
    }
    this.recomputeAll()
    this.publish()
  }

  detach(): void {
    this.generation += 1
    this.writeSeq += 1
    this.workspaceId = null
    this.storageState = 'ok'
    this.configuration.clear()
    this.raw.clear()
    this.views.clear()
    this.publish()
  }

  declare(identity: string, configuration?: ManifestConfiguration): void {
    if (!configuration || Object.keys(configuration.properties).length === 0) {
      this.configuration.delete(identity)
      this.views.delete(identity)
    } else {
      this.configuration.set(identity, configuration)
      this.recompute(identity)
    }
    this.publish()
  }

  values(identity: string): SettingValues {
    const view = this.views.get(identity)
    return view ? { ...view.values } : {}
  }

  set(identity: string, key: string, value: SettingValue): SetSettingResult {
    if (!this.workspaceId) return { ok: false, code: 'not-attached' }
    const configuration = this.configuration.get(identity)
    if (!configuration || !hasOwn(configuration.properties, key)) {
      return { ok: false, code: 'not-declared' }
    }
    if (!validSettingValue(value, configuration.properties[key])) {
      return { ok: false, code: 'invalid-value' }
    }

    const current = this.raw.get(identity) ?? {}
    if (hasOwn(current, key) && Object.is(current[key], value)) {
      return { ok: true, changed: false }
    }
    this.raw.set(identity, { ...current, [key]: value })
    this.recompute(identity)
    this.publish()

    const view = this.views.get(identity)
    if (view) this.onChange?.(identity, { ...view.values })

    const writeSeq = (this.writeSeq += 1)
    const generation = this.generation
    const workspaceId = this.workspaceId
    void this.storage.put(workspaceId, this.persistedValues()).then(
      () => {
        if (writeSeq !== this.writeSeq || generation !== this.generation) return
        if (this.storageState !== 'write-failed') return
        this.storageState = 'ok'
        this.publish()
      },
      () => {
        if (writeSeq !== this.writeSeq || generation !== this.generation) return
        this.storageState = 'write-failed'
        this.publish()
      },
    )
    return { ok: true, changed: true }
  }

  private recompute(identity: string): void {
    const configuration = this.configuration.get(identity)
    if (!configuration) {
      this.views.delete(identity)
      return
    }
    const resolved = resolveSettings(configuration, this.raw.get(identity))
    this.views.set(identity, {
      values: resolved.values,
      issues: resolved.issues,
    })
  }

  private recomputeAll(): void {
    for (const identity of this.configuration.keys()) this.recompute(identity)
  }

  /**
   * Persist only declared keys, including values that currently fail validation
   * so the warning survives a reload. Unknown stored keys are dropped on write.
   */
  private persistedValues(): RawSettingsByPlugin {
    const result: RawSettingsByPlugin = {}
    for (const [identity, configuration] of this.configuration) {
      const raw = this.raw.get(identity)
      if (!raw) continue
      const values: RawSettingValues = {}
      for (const key of Object.keys(configuration.properties)) {
        if (hasOwn(raw, key)) values[key] = raw[key]
      }
      if (Object.keys(values).length > 0) result[identity] = values
    }
    return result
  }

  private publish(): void {
    const plugins: Record<string, PluginSettingsView> = {}
    for (const identity of [...this.views.keys()].sort()) {
      const view = this.views.get(identity)
      if (!view) continue
      plugins[identity] = {
        values: { ...view.values },
        issues: view.issues.map((issue) => ({ ...issue })),
      }
    }
    const signature = JSON.stringify({
      workspaceId: this.workspaceId,
      storage: this.storageState,
      plugins,
    })
    if (signature === this.signature) return
    this.signature = signature
    this.snapshot = {
      workspaceId: this.workspaceId,
      plugins,
      storage: this.storageState,
      revision: this.snapshot.revision + 1,
    }
    for (const listener of [...this.listeners]) listener()
  }
}
