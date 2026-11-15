import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  IndexedDbConnectionStore,
  MAX_RECENT_CONNECTIONS,
  MemoryConnectionStore,
  type ConnectionStore,
  type StoredConnectionRecord,
} from './connection-store'
import { FAKE_TOKEN, FAKE_VDIR, FAKE_BASE_URL } from './fake-server'
import { type StratofoldConnection } from './connection'
import { stratofoldWorkspaceId } from './provider'

const connection: StratofoldConnection = {
  server: FAKE_BASE_URL,
  vdir: FAKE_VDIR,
  name: 'demo',
  role: 'editor',
  token: FAKE_TOKEN,
}

function recordFor(index: number, lastOpenedAt = index): StoredConnectionRecord {
  const item: StratofoldConnection = {
    ...connection,
    vdir: `vdir-${index}`,
    name: `demo-${index}`,
    token: `sf_v1_${index}`,
  }
  return { id: stratofoldWorkspaceId(item), connection: item, lastOpenedAt }
}

async function openVersionOneDatabase(
  factory: IDBFactory,
  record: { id: string; connection: StratofoldConnection },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = factory.open('exo-remote', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('connections')
    }
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('connections', 'readwrite')
      transaction.objectStore('connections').put(record, 'last')
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
    }
    request.onerror = () => reject(request.error)
  })
}

function assertStoreContract(store: ConnectionStore) {
  return async () => {
    expect(await store.list()).toEqual([])

    const first = recordFor(1, 10)
    const second = recordFor(2, 20)
    await store.put(first)
    await store.put(second)

    expect((await store.list()).map((item) => item.connection.vdir)).toEqual(['vdir-2', 'vdir-1'])
    expect(await store.get(first.id)).toMatchObject({
      id: first.id,
      connection: { vdir: 'vdir-1', token: 'sf_v1_1' },
    })

    const updated = {
      ...first,
      lastOpenedAt: 30,
      connection: { ...first.connection, token: 'new' },
    }
    await store.put(updated)
    expect(await store.list()).toHaveLength(2)
    expect((await store.list())[0]).toMatchObject({
      id: first.id,
      connection: { token: 'new' },
    })

    await store.remove(second.id)
    expect((await store.list()).map((item) => item.id)).toEqual([first.id])
    expect(await store.get(second.id)).toBeNull()

    await store.clear()
    expect(await store.list()).toEqual([])
  }
}

function assertCap(store: ConnectionStore) {
  return async () => {
    for (let index = 1; index <= MAX_RECENT_CONNECTIONS + 1; index += 1) {
      await store.put(recordFor(index, index))
    }
    const list = await store.list()
    expect(list).toHaveLength(MAX_RECENT_CONNECTIONS)
    expect(list[0].connection.vdir).toBe(`vdir-${MAX_RECENT_CONNECTIONS + 1}`)
    expect(list.map((item) => item.connection.vdir)).not.toContain('vdir-1')
  }
}

describe('memory connection store', () => {
  it('implements the recent-workspaces contract', assertStoreContract(new MemoryConnectionStore()))

  it('caps the list at the newest entries', assertCap(new MemoryConnectionStore()))
})

describe('IndexedDB connection store', () => {
  it('implements the recent-workspaces contract', async () => {
    await assertStoreContract(new IndexedDbConnectionStore(new IDBFactory()))()
  })

  it('caps the list at the newest entries', async () => {
    await assertCap(new IndexedDbConnectionStore(new IDBFactory()))()
  })

  it('survives a reload through a second store instance', async () => {
    const factory = new IDBFactory()
    const first = new IndexedDbConnectionStore(factory)
    await first.put(recordFor(1, 10))

    const second = new IndexedDbConnectionStore(factory)
    expect(await second.list()).toEqual([
      expect.objectContaining({ id: recordFor(1).id, lastOpenedAt: expect.any(Number) }),
    ])
  })

  it('migrates the v1 last record into the recent list', async () => {
    const factory = new IDBFactory()
    const legacy = { id: stratofoldWorkspaceId(connection), connection }
    await openVersionOneDatabase(factory, legacy)

    const store = new IndexedDbConnectionStore(factory)
    const list = await store.list()

    expect(list).toEqual([{ ...legacy, lastOpenedAt: 0 }])
    expect(await store.get(legacy.id)).toEqual({ ...legacy, lastOpenedAt: 0 })
  })

  it('keeps the ordering stable for connections opened in the same millisecond', async () => {
    const factory = new IDBFactory()
    const store = new IndexedDbConnectionStore(factory)
    await store.put(recordFor(1, 100))
    await store.put(recordFor(2, 100))

    const list = await store.list()
    expect(list.map((item) => item.connection.vdir)).toEqual(['vdir-2', 'vdir-1'])
    expect(list[0].lastOpenedAt).toBeGreaterThan(list[1].lastOpenedAt)
  })

  it('reports an unusable IndexedDB as unsupported instead of throwing raw', async () => {
    const store = new IndexedDbConnectionStore(null as unknown as IDBFactory)
    await expect(store.list()).rejects.toMatchObject({ code: 'unsupported' })
    await expect(store.put({ ...recordFor(1), connection })).rejects.toMatchObject({
      code: 'unsupported',
    })
  })
})
