import { WorkspaceError } from '../../contract'
import { type StratofoldConnection } from './connection'

/** How many remote workspaces the shell keeps available for reopening. */
export const MAX_RECENT_CONNECTIONS = 10

/**
 * One entry in the recent-workspaces list. The token is part of the record by
 * design (a remote workspace cannot be restored without it); it never leaves
 * this store except into a client instance.
 */
export interface StoredConnectionRecord {
  /** Workspace identity, also the IndexedDB key. Never contains the token. */
  id: string
  connection: StratofoldConnection
  /** Epoch milliseconds, used to order the list; ties are made strictly increasing. */
  lastOpenedAt: number
}

export interface ConnectionStore {
  /** Newest first. At most `MAX_RECENT_CONNECTIONS` records. */
  list(): Promise<StoredConnectionRecord[]>
  get(id: string): Promise<StoredConnectionRecord | null>
  put(record: StoredConnectionRecord): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'exo-remote'
const DB_VERSION = 2
const STORE_NAME = 'connections'
const LEGACY_RECORD_KEY = 'last'

function storageError(error: unknown): WorkspaceError {
  return new WorkspaceError('io', 'The remote connection could not be stored.', { cause: error })
}

function newestFirst(a: StoredConnectionRecord, b: StoredConnectionRecord): number {
  return b.lastOpenedAt - a.lastOpenedAt
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

export class IndexedDbConnectionStore implements ConnectionStore {
  private readonly factory: IDBFactory
  private database: Promise<IDBDatabase> | null = null

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.factory = factory
  }

  async list(): Promise<StoredConnectionRecord[]> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const result = await requestResult(transaction.objectStore(STORE_NAME).getAll())
      return sortRecords(result as StoredConnectionRecord[])
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async get(id: string): Promise<StoredConnectionRecord | null> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const result = await requestResult(transaction.objectStore(STORE_NAME).get(id))
      return (result as StoredConnectionRecord | undefined) ?? null
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async put(record: StoredConnectionRecord): Promise<void> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const existing = store.getAll()
      existing.onsuccess = () => {
        const records = existing.result as StoredConnectionRecord[]
        const newest = records.reduce((latest, item) => Math.max(latest, item.lastOpenedAt), 0)
        // Keep ordering deterministic when two connections share a millisecond.
        const lastOpenedAt = record.lastOpenedAt > newest ? record.lastOpenedAt : newest + 1
        const stored = { ...record, lastOpenedAt }
        store.put(stored, stored.id)
        const next = sortRecords([...records.filter((item) => item.id !== stored.id), stored])
        for (const extra of next.slice(MAX_RECENT_CONNECTIONS)) store.delete(extra.id)
      }
      await transactionDone(transaction)
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(id)
      await transactionDone(transaction)
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async clear(): Promise<void> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
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
        const transaction = request.transaction
        if (!transaction) return
        const store = database.objectStoreNames.contains(STORE_NAME)
          ? transaction.objectStore(STORE_NAME)
          : database.createObjectStore(STORE_NAME)
        const legacy = store.get(LEGACY_RECORD_KEY)
        legacy.onsuccess = () => {
          const record = legacy.result as
            { id: string; connection: StratofoldConnection } | undefined
          if (!record) return
          store.put({ ...record, lastOpenedAt: 0 }, record.id)
          store.delete(LEGACY_RECORD_KEY)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(storageError(request.error))
      request.onblocked = () =>
        reject(storageError(new Error('The remote connection database is blocked.')))
    })
    return this.database
  }
}

function sortRecords(records: StoredConnectionRecord[]): StoredConnectionRecord[] {
  return [...records].sort(newestFirst)
}

export class MemoryConnectionStore implements ConnectionStore {
  private readonly records = new Map<string, StoredConnectionRecord>()

  async list(): Promise<StoredConnectionRecord[]> {
    return sortRecords([...this.records.values()])
  }

  async get(id: string): Promise<StoredConnectionRecord | null> {
    return this.records.get(id) ?? null
  }

  async put(record: StoredConnectionRecord): Promise<void> {
    const newest = [...this.records.values()].reduce(
      (latest, item) => Math.max(latest, item.lastOpenedAt),
      0,
    )
    const lastOpenedAt = record.lastOpenedAt > newest ? record.lastOpenedAt : newest + 1
    this.records.set(record.id, { ...record, lastOpenedAt })
    for (const extra of sortRecords([...this.records.values()]).slice(MAX_RECENT_CONNECTIONS)) {
      this.records.delete(extra.id)
    }
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id)
  }

  async clear(): Promise<void> {
    this.records.clear()
  }
}
