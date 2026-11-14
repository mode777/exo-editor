import { describe, expect, it, vi } from 'vitest'
import { DocumentStore, MAX_TEXT_FILE_BYTES } from './documents'
import { MemoryWorkspaceProvider } from './providers/memory'
import { Session } from './session'
import type { FileStat, WorkspaceChange } from './contract'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function setup(files: Record<string, string | Uint8Array> = { '/a.txt': 'one' }) {
  const provider = new MemoryWorkspaceProvider({ now: () => 1, initialFiles: files })
  const handle = await provider.open()
  const session = new Session(handle, {
    eventTarget: new EventTarget(),
    isVisible: () => true,
  })
  const dirty: Array<[string, boolean]> = []
  const store = new DocumentStore({
    getSession: () => session,
    onDirtyChange: (path, value) => dirty.push([path, value]),
  })
  return { provider, handle, session, store, dirty }
}

function stat(path: string, version: string, size: number): FileStat {
  return { path, kind: 'file', size, mtime: 1, version }
}

describe('document open pipeline', () => {
  it('opens a 1 MiB text file', async () => {
    const content = 'x'.repeat(1024 * 1024)
    const { store } = await setup({ '/a.txt': content })

    const document = await store.open('/a.txt')

    expect(document).toMatchObject({ status: 'ready', text: content, size: content.length })
    expect(document?.dirty).toBe(false)
  })

  it('shows no editor for binary content', async () => {
    const { store } = await setup({ '/a.bin': new Uint8Array([1, 2, 0, 4]) })

    const document = await store.open('/a.bin')

    expect(document).toMatchObject({
      status: 'no-editor',
      noEditorReason: 'binary',
      readOnly: true,
    })
  })

  it('shows no editor for undecodable content', async () => {
    const { store } = await setup({ '/a.bin': new Uint8Array([0xff, 0xfe, 0xfd]) })

    const document = await store.open('/a.bin')

    expect(document).toMatchObject({
      status: 'no-editor',
      noEditorReason: 'undecodable',
    })
  })

  it('refuses to read a file over the 10 MiB limit', async () => {
    const { handle, store } = await setup()
    vi.spyOn(handle, 'stat').mockResolvedValue({
      path: '/a.txt',
      kind: 'file',
      size: MAX_TEXT_FILE_BYTES + 1,
      mtime: 1,
      version: 'big',
    })
    const read = vi.spyOn(handle, 'read')

    const document = await store.open('/a.txt')

    expect(document).toMatchObject({
      status: 'no-editor',
      noEditorReason: 'too-large',
      size: MAX_TEXT_FILE_BYTES + 1,
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('shows an actionable error for a missing file', async () => {
    const { store } = await setup()

    const document = await store.open('/missing.txt')

    expect(document).toMatchObject({ status: 'error', error: 'not-found' })
  })

  it('retries a failed open', async () => {
    const { handle, store } = await setup()
    const statSpy = vi
      .spyOn(handle, 'stat')
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(stat('/a.txt', 'v1', 3))
    vi.spyOn(handle, 'read').mockResolvedValue(encoder.encode('one'))

    expect(await store.open('/a.txt')).toMatchObject({ status: 'error' })
    expect(await store.retry('/a.txt')).toMatchObject({ status: 'ready', text: 'one' })
    expect(statSpy).toHaveBeenCalledTimes(2)
  })
})

describe('document editing and saving', () => {
  it('saves exact bytes and updates the version', async () => {
    const { handle, store } = await setup()
    await store.open('/a.txt')
    const before = store.get('/a.txt')?.version

    store.updateText('/a.txt', 'edited')
    expect(store.get('/a.txt')?.dirty).toBe(true)
    expect(await store.save('/a.txt')).toBe(true)

    const document = store.get('/a.txt')
    expect(document?.dirty).toBe(false)
    expect(document?.version).not.toBe(before)
    expect(decoder.decode(await handle.read('/a.txt'))).toBe('edited')
  })

  it('clears dirty when the text is reverted', async () => {
    const { store } = await setup()
    await store.open('/a.txt')

    store.updateText('/a.txt', 'edited')
    store.updateText('/a.txt', 'one')

    expect(store.get('/a.txt')?.dirty).toBe(false)
  })

  it('keeps dirty when the text changes during an in-flight save', async () => {
    const { session, store } = await setup()
    await store.open('/a.txt')
    session.write = vi.fn(
      () =>
        new Promise((resolve) => {
          queueMicrotask(() => resolve(stat('/a.txt', 'v2', 3)))
        }),
    ) as typeof session.write

    store.updateText('/a.txt', 'first')
    const saving = store.save('/a.txt')
    store.updateText('/a.txt', 'second')
    expect(await saving).toBe(true)

    expect(store.get('/a.txt')).toMatchObject({
      text: 'second',
      savedText: 'first',
      dirty: true,
    })
  })

  it('surfaces conflict and keeps the disk content', async () => {
    const { handle, store } = await setup()
    await store.open('/a.txt')
    await handle.write('/a.txt', encoder.encode('outside'))

    store.updateText('/a.txt', 'mine')
    expect(await store.save('/a.txt')).toBe(false)

    expect(store.get('/a.txt')).toMatchObject({
      dirty: true,
      error: 'conflict',
      external: 'changed',
      text: 'mine',
    })
    expect(decoder.decode(await handle.read('/a.txt'))).toBe('outside')
  })

  it('keeps the document dirty and open when a save fails', async () => {
    const { session, store } = await setup()
    await store.open('/a.txt')
    session.write = vi.fn(async () => {
      throw new Error('permission')
    }) as typeof session.write
    store.updateText('/a.txt', 'mine')

    expect(await store.save('/a.txt')).toBe(false)
    expect(store.get('/a.txt')).toMatchObject({ status: 'ready', dirty: true, error: 'io' })
  })

  it('never saves a no-editor file', async () => {
    const { store } = await setup({ '/a.bin': new Uint8Array([0, 1]) })
    await store.open('/a.bin')

    expect(await store.save('/a.bin')).toBe(false)
  })
})

describe('document external changes, rename and delete', () => {
  it('reports changed and deleted external state without discarding text', async () => {
    const { store } = await setup()
    await store.open('/a.txt')

    store.applyExternal({ kind: 'changed', path: '/a.txt', stat: stat('/a.txt', 'v2', 3) })
    expect(store.get('/a.txt')?.external).toBe('changed')
    expect(store.get('/a.txt')?.text).toBe('one')

    store.applyExternal({ kind: 'deleted', path: '/a.txt' })
    expect(store.get('/a.txt')?.external).toBe('deleted')
    expect(await store.save('/a.txt')).toBe(false)
  })

  it('reloads content from disk', async () => {
    const { handle, store } = await setup()
    await store.open('/a.txt')
    await handle.write('/a.txt', encoder.encode('external'))

    const document = await store.reload('/a.txt')

    expect(document).toMatchObject({ text: 'external', dirty: false, external: null })
  })

  it('renames a dirty buffer and saves to the new path', async () => {
    const { handle, session, store } = await setup()
    await store.open('/a.txt')
    store.updateText('/a.txt', 'dirty')
    const moved = await session.move('/a.txt', '/b.txt')
    store.rename('/a.txt', '/b.txt', moved)

    expect(store.get('/a.txt')).toBeUndefined()
    expect(store.get('/b.txt')).toMatchObject({ path: '/b.txt', text: 'dirty', dirty: true })
    expect(await store.save('/b.txt')).toBe(true)
    expect(decoder.decode(await handle.read('/b.txt'))).toBe('dirty')
  })

  it('drops documents and aborts saves under a deleted directory', async () => {
    const { session, store } = await setup({ '/dir/a.txt': 'one' })
    await store.open('/dir/a.txt')
    let resolveSave: ((value: FileStat) => void) | null = null
    session.write = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    ) as typeof session.write
    store.updateText('/dir/a.txt', 'dirty')

    const saving = store.save('/dir/a.txt')
    store.deleteUnder('/dir')
    ;(resolveSave as unknown as (value: FileStat) => void)(stat('/dir/a.txt', 'v2', 5))

    expect(await saving).toBe(false)
    expect(store.get('/dir/a.txt')).toBeUndefined()
  })

  it('tracks open versions for the refresh fallback', async () => {
    const { session, store } = await setup()
    await store.open('/a.txt')
    const changes: WorkspaceChange[] = []
    session.onExternalChange((change) => changes.push(change))
    const version = store.get('/a.txt')?.version as string
    session.setOpenDocuments([{ path: '/a.txt', version }])

    expect(await session.refreshOpenDocuments()).toEqual([])
  })
})
