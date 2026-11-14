import { WorkspaceError } from '../../contract'

export interface StoredWorkspaceRecord {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
}

export interface HandleStore {
  get(): Promise<StoredWorkspaceRecord | null>
  put(record: StoredWorkspaceRecord): Promise<void>
  clear(): Promise<void>
}

const DB_NAME = 'exo-workspace'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const RECORD_KEY = 'last'

function storageError(error: unknown): WorkspaceError {
  return new WorkspaceError('io', 'The workspace handle could not be stored.', {
    cause: error,
  })
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

/**
 * Persists the one directory handle that survives a reload. The handle is
 * structured-cloneable but not JSON-serializable, so it never touches
 * localStorage.
 */
export class IndexedDbHandleStore implements HandleStore {
  private readonly factory: IDBFactory
  private database: Promise<IDBDatabase> | null = null

  constructor(factory: IDBFactory = globalThis.indexedDB) {
    this.factory = factory
  }

  async get(): Promise<StoredWorkspaceRecord | null> {
    try {
      const database = await this.open()
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const result = await requestResult(transaction.objectStore(STORE_NAME).get(RECORD_KEY))
      return (result as StoredWorkspaceRecord | undefined) ?? null
    } catch (error) {
      throw error instanceof WorkspaceError ? error : storageError(error)
    }
  }

  async put(record: StoredWorkspaceRecord): Promise<void> {
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
        reject(storageError(new Error('The workspace database is blocked.')))
    })
    return this.database
  }
}

export class MemoryHandleStore implements HandleStore {
  private record: StoredWorkspaceRecord | null = null

  async get(): Promise<StoredWorkspaceRecord | null> {
    return this.record
  }

  async put(record: StoredWorkspaceRecord): Promise<void> {
    this.record = record
  }

  async clear(): Promise<void> {
    this.record = null
  }
}
