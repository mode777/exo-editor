import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbConnectionStore, MemoryConnectionStore } from './connection-store'
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

describe('memory connection store', () => {
  it('round-trips and forgets a remembered connection', async () => {
    const store = new MemoryConnectionStore()
    expect(await store.get()).toBeNull()

    await store.put({ connection, id: stratofoldWorkspaceId(connection) })
    expect(await store.get()).toEqual({ connection, id: stratofoldWorkspaceId(connection) })

    await store.clear()
    expect(await store.get()).toBeNull()
  })
})

describe('IndexedDB connection store', () => {
  it('survives a reload through a second store instance', async () => {
    const factory = new IDBFactory()
    const first = new IndexedDbConnectionStore(factory)
    await first.put({ connection, id: stratofoldWorkspaceId(connection) })

    const second = new IndexedDbConnectionStore(factory)
    expect(await second.get()).toEqual({
      connection,
      id: stratofoldWorkspaceId(connection),
    })
  })

  it('deletes the record when the user forgets the connection', async () => {
    const factory = new IDBFactory()
    const store = new IndexedDbConnectionStore(factory)
    await store.put({ connection, id: stratofoldWorkspaceId(connection) })
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it('keeps only the latest connection, like a single remembered workspace', async () => {
    const factory = new IDBFactory()
    const store = new IndexedDbConnectionStore(factory)
    const other: StratofoldConnection = { ...connection, vdir: 'vdir-2', token: 'sf_v1_other' }

    await store.put({ connection, id: stratofoldWorkspaceId(connection) })
    await store.put({ connection: other, id: stratofoldWorkspaceId(other) })

    expect((await store.get())?.connection.vdir).toBe('vdir-2')
  })

  it('reports an unusable IndexedDB as unsupported instead of throwing raw', async () => {
    const store = new IndexedDbConnectionStore(null as unknown as IDBFactory)
    await expect(store.get()).rejects.toMatchObject({ code: 'unsupported' })
  })
})
