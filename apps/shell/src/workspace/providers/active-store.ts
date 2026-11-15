import { WorkspaceError } from '../contract'

/**
 * Which provider kind owns the persisted workspace. Without this marker a
 * stored folder handle is assumed, so workspaces saved before provider
 * selection existed keep restoring.
 */
export interface ActiveWorkspaceRecord {
  kind: string
  id: string
}

export interface ActiveWorkspaceStore {
  get(): Promise<ActiveWorkspaceRecord | null>
  put(record: ActiveWorkspaceRecord): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'exo-active-workspace'
const DB_VERSION = 1
const STORE_NAME = 'state'
const RECORD_KEY = 'last'

function storageError(error: unknown): WorkspaceError {
  return new WorkspaceError('io', 'The active workspace could not be stored.', { cause: error })
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

export class IndexedDbActiveWorkspaceStore implements ActiveWorkspaceStore {
  private readonly factory: IDBFactory
  private database: Promise<IDBDatabase> | null = null

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.factory = factory
  }

  async get(): Promise<ActiveWorkspaceRecord | null> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const result = await requestResult(transaction.objectStore(STORE_NAME).get(RECORD_KEY))
      return (result as ActiveWorkspaceRecord | undefined) ?? null
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async put(record: ActiveWorkspaceRecord): Promise<void> {
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
        reject(storageError(new Error('The active workspace database is blocked.')))
    })
    return this.database
  }
}

export class MemoryActiveWorkspaceStore implements ActiveWorkspaceStore {
  private record: ActiveWorkspaceRecord | null = null

  async get(): Promise<ActiveWorkspaceRecord | null> {
    return this.record
  }

  async put(record: ActiveWorkspaceRecord): Promise<void> {
    this.record = record
  }

  async clear(): Promise<void> {
    this.record = null
  }
}
