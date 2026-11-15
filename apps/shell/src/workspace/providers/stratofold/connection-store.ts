import { WorkspaceError } from '../../contract'
import { type StratofoldConnection } from './connection'

/**
 * Persists the remote connection the user asked to remember. The token is part
 * of the record by design (a remote workspace cannot be restored without it);
 * it never leaves this store except into a client instance.
 */
export interface StoredConnectionRecord {
  connection: StratofoldConnection
  /** Identity of the stored workspace, so restore can reject a mismatch. */
  id: string
}

export interface ConnectionStore {
  get(): Promise<StoredConnectionRecord | null>
  put(record: StoredConnectionRecord): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'exo-remote'
const DB_VERSION = 1
const STORE_NAME = 'connections'
const RECORD_KEY = 'last'

function storageError(error: unknown): WorkspaceError {
  return new WorkspaceError('io', 'The remote connection could not be stored.', { cause: error })
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

  async get(): Promise<StoredConnectionRecord | null> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const result = await requestResult(transaction.objectStore(STORE_NAME).get(RECORD_KEY))
      return (result as StoredConnectionRecord | undefined) ?? null
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async put(record: StoredConnectionRecord): Promise<void> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record, RECORD_KEY)
      await transactionDone(transaction)
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async clear(): Promise<void> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(RECORD_KEY)
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
        reject(storageError(new Error('The remote connection database is blocked.')))
    })
    return this.database
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  private record: StoredConnectionRecord | null = null

  async get(): Promise<StoredConnectionRecord | null> {
    return this.record
  }

  async put(record: StoredConnectionRecord): Promise<void> {
    this.record = record
  }

  async clear(): Promise<void> {
    this.record = null
  }
}
