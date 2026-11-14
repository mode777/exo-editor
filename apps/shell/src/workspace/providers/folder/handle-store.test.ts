import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { IndexedDbHandleStore, type StoredWorkspaceRecord } from './handle-store'

function record(name = 'workspace'): StoredWorkspaceRecord {
  return {
    id: `folder:${name}`,
    name,
    handle: { kind: 'directory', name } as unknown as FileSystemDirectoryHandle,
  }
}

describe('IndexedDB handle store', () => {
  let store: IndexedDbHandleStore

  beforeEach(() => {
    localStorage.clear()
    store = new IndexedDbHandleStore(new IDBFactory())
  })

  it('round-trips a structured-cloned record and clears it', async () => {
    const value = record()
    await store.put(value)

    expect(await store.get()).toEqual(value)
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it('reports a missing record as null', async () => {
    expect(await store.get()).toBeNull()
  })

  it('does not write the handle into localStorage', async () => {
    await store.put(record())

    expect(localStorage.length).toBe(0)
    expect(localStorage.getItem('desktop-ui-template:v1')).toBeNull()
  })
})
