import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from './providers/memory'
import { Session } from './session'
import type { WorkspaceCapabilities, WorkspaceChange, WorkspaceHandle } from './contract'

const encoder = new TextEncoder()

class FakeEventTarget extends EventTarget {}

async function setup(options: { writable?: boolean; watchable?: boolean } = {}) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: { '/a.txt': 'one', '/b.txt': 'two' },
    ...options,
  })
  const handle = await provider.open()
  const events = new FakeEventTarget()
  const session = new Session(handle, {
    eventTarget: events,
    isVisible: () => true,
  })
  return { provider, handle, events, session }
}

describe('session lifecycle', () => {
  it('aborts an in-flight read and drops its result on dispose', async () => {
    const { handle, session } = await setup()
    let resolveRead: (value: Uint8Array) => void = () => undefined
    vi.spyOn(handle, 'read').mockImplementation(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRead = resolve
        }),
    )

    const pending = session.read('/a.txt')
    await session.dispose()
    resolveRead(encoder.encode('late'))

    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })

  it('aborts an in-flight save without emitting a callback', async () => {
    const { handle, session } = await setup()
    let resolveWrite: (value: Awaited<ReturnType<WorkspaceHandle['write']>>) => void = () =>
      undefined
    vi.spyOn(handle, 'write').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve
        }),
    )
    const changes: WorkspaceChange[] = []
    session.onExternalChange((change) => changes.push(change))

    const pending = session.write('/a.txt', encoder.encode('late'))
    await session.dispose()
    resolveWrite({ path: '/a.txt', kind: 'file', size: 4, mtime: 1, version: 'x' })

    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(changes).toEqual([])
  })

  it('is idempotent and serves nothing after dispose', async () => {
    const { session } = await setup()

    await session.dispose()
    await expect(session.dispose()).resolves.toBeUndefined()
    await expect(session.stat('/a.txt')).rejects.toMatchObject({ code: 'aborted' })
    expect(await session.refreshOpenDocuments()).toEqual([])
  })

  it('drops a refresh that resolves after dispose', async () => {
    const { handle, session } = await setup()
    let resolveStat: (value: Awaited<ReturnType<WorkspaceHandle['stat']>>) => void = () => undefined
    vi.spyOn(handle, 'stat').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStat = resolve
        }),
    )
    const changes: WorkspaceChange[] = []
    session.onExternalChange((change) => changes.push(change))
    session.setOpenDocuments([{ path: '/a.txt', version: 'm1' }])

    const pending = session.refreshOpenDocuments()
    await session.dispose()
    resolveStat({ path: '/a.txt', kind: 'file', size: 3, mtime: 1, version: 'm2' })

    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(changes).toEqual([])
  })
})

describe('session external refresh', () => {
  it('emits changed, deleted and nothing for unchanged documents', async () => {
    const { handle, session } = await setup({ watchable: false })
    const changes: WorkspaceChange[] = []
    session.onExternalChange((change) => changes.push(change))

    const initial = await handle.stat('/a.txt')
    session.setOpenDocuments([{ path: '/a.txt', version: initial.version }])
    expect(await session.refreshOpenDocuments()).toEqual([])

    await handle.write('/a.txt', encoder.encode('changed'))
    expect(await session.refreshOpenDocuments()).toMatchObject([
      { kind: 'changed', path: '/a.txt' },
    ])

    await handle.remove('/a.txt')
    expect(await session.refreshOpenDocuments()).toMatchObject([
      { kind: 'deleted', path: '/a.txt' },
    ])
    expect(changes.map((change) => change.kind)).toEqual(['changed', 'deleted'])
  })

  it('refreshes on focus and coalesces concurrent refreshes', async () => {
    const { handle, events, session } = await setup({ watchable: false })
    const changes: WorkspaceChange[] = []
    session.onExternalChange((change) => changes.push(change))
    const initial = await handle.stat('/a.txt')
    session.setOpenDocuments([{ path: '/a.txt', version: initial.version }])
    await handle.write('/a.txt', encoder.encode('outside'))

    const first = session.refreshOpenDocuments()
    const second = session.refreshOpenDocuments()
    expect(second).toBe(first)
    await first
    expect(changes).toHaveLength(1)

    await handle.write('/a.txt', encoder.encode('outside again'))
    events.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => expect(changes).toHaveLength(2))
  })

  it('uses the watch channel for a watchable provider', async () => {
    const { handle, session } = await setup({ watchable: true })
    const changes: WorkspaceChange[] = []
    session.onExternalChange((change) => changes.push(change))
    const initial = await handle.stat('/a.txt')
    session.setOpenDocuments([{ path: '/a.txt', version: initial.version }])

    await handle.write('/a.txt', encoder.encode('watched'))

    expect(changes).toMatchObject([{ kind: 'changed', path: '/a.txt' }])
    expect(await session.refreshOpenDocuments()).toEqual([])
  })

  it('rejects invalid tracked paths', async () => {
    const { session } = await setup()
    expect(() => session.setOpenDocuments([{ path: '/a/../b.txt', version: 'm1' }])).toThrow(
      expect.objectContaining({ code: 'permission-denied' }),
    )
  })
})

describe('session permission escalation', () => {
  it('flips capabilities on a grant without recreating the workspace', async () => {
    const provider = new MemoryWorkspaceProvider({
      writable: false,
      initialFiles: { '/a.txt': 'one' },
    })
    const handle = await provider.open()
    const granted: WorkspaceCapabilities = {
      ...provider.capabilities(),
      writable: true,
    }
    handle.requestPermission = vi.fn(async () => granted)
    const session = new Session(handle)
    expect(session.capabilities().writable).toBe(false)

    const next = await session.requestPermission()

    expect(next.writable).toBe(true)
    expect(session.capabilities().writable).toBe(true)
    expect(session.descriptor.capabilities.writable).toBe(true)
    expect(handle.requestPermission).toHaveBeenCalledTimes(1)
    expect(session.descriptor.id).toBe(handle.descriptor.id)
  })

  it('stays read-only when the request is denied', async () => {
    const provider = new MemoryWorkspaceProvider({ writable: false })
    const handle = await provider.open()
    handle.requestPermission = vi.fn(async () => ({
      ...provider.capabilities(),
      writable: false,
    }))
    const session = new Session(handle)

    expect((await session.requestPermission()).writable).toBe(false)
    expect(session.capabilities().writable).toBe(false)
  })

  it('reports unsupported when the provider cannot escalate', async () => {
    const { session } = await setup()
    await expect(session.requestPermission()).rejects.toMatchObject({
      code: 'unsupported',
    })
  })

  it('drops a permission result that resolves after dispose', async () => {
    const provider = new MemoryWorkspaceProvider({ writable: false })
    const handle = await provider.open()
    let resolve: (value: WorkspaceCapabilities) => void = () => undefined
    handle.requestPermission = () =>
      new Promise((resolvePermission) => {
        resolve = resolvePermission
      })
    const session = new Session(handle)

    const pending = session.requestPermission()
    await session.dispose()
    resolve({ ...provider.capabilities(), writable: true })

    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(session.capabilities().writable).toBe(false)
  })
})
