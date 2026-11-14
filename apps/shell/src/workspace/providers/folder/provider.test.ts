import { describe, expect, it } from 'vitest'
import { FolderWorkspaceProvider } from './provider'
import { MemoryHandleStore } from './handle-store'
import { createFakeWorkspace } from './fake-fsa'
import { runProviderConformance } from '../conformance'

runProviderConformance(
  'folder',
  () =>
    new FolderWorkspaceProvider({
      picker: async () => createFakeWorkspace(),
      handleStore: new MemoryHandleStore(),
      platform: 'Linux',
      now: () => 1000,
    }),
)

function folderProvider(root = createFakeWorkspace(), handleStore = new MemoryHandleStore()) {
  return {
    root,
    handleStore,
    provider: new FolderWorkspaceProvider({
      picker: async () => root,
      handleStore,
      platform: 'Linux',
      now: () => 1000,
    }),
  }
}

describe('folder provider specifics', () => {
  it('persists the picked handle and restores the same identity', async () => {
    const { provider, handleStore } = folderProvider()
    const handle = await provider.open()

    expect(handle.descriptor).toMatchObject({
      id: 'folder:workspace',
      name: 'workspace',
      providerKind: 'folder',
    })
    expect(await handleStore.get()).toMatchObject({ id: 'folder:workspace' })

    const restored = await provider.restore('folder:workspace')
    expect(restored?.descriptor.id).toBe('folder:workspace')
  })

  it('treats a cancelled picker as aborted with no error toast', async () => {
    const provider = new FolderWorkspaceProvider({
      picker: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
      handleStore: new MemoryHandleStore(),
      platform: 'Linux',
    })

    await expect(provider.open()).rejects.toMatchObject({ code: 'aborted' })
  })

  it('maps a security failure from the picker to permission-denied', async () => {
    const provider = new FolderWorkspaceProvider({
      picker: async () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      handleStore: new MemoryHandleStore(),
      platform: 'Linux',
    })

    await expect(provider.open()).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('restores read-only when write permission is not granted', async () => {
    const { provider, root } = folderProvider()
    await provider.open()
    root.setPermission('readwrite', 'prompt')

    const restored = await provider.restore('folder:workspace')
    expect(restored?.descriptor.capabilities).toMatchObject({
      writable: false,
      persistent: true,
    })
  })

  it('escalates to writable only when the user grants permission', async () => {
    const { provider, root } = folderProvider()
    await provider.open()
    root.setPermission('readwrite', 'prompt')
    root.setRequestResult('readwrite', 'granted')
    const restored = await provider.restore('folder:workspace')

    expect(restored?.descriptor.capabilities.writable).toBe(false)
    const capabilities = await restored?.requestPermission?.()
    expect(capabilities?.writable).toBe(true)
    expect(restored?.descriptor.capabilities.writable).toBe(true)
  })

  it('keeps the workspace read-only when permission is denied', async () => {
    const { provider, root } = folderProvider()
    await provider.open()
    root.setPermission('readwrite', 'prompt')
    root.setRequestResult('readwrite', 'denied')
    const restored = await provider.restore('folder:workspace')

    expect((await restored?.requestPermission?.())?.writable).toBe(false)
  })

  it('returns null for a missing or mismatched stored record', async () => {
    const { provider, handleStore } = folderProvider()
    await provider.open()

    expect(await provider.restore('folder:other')).toBeNull()
    await handleStore.clear()
    expect(await provider.restore('folder:workspace')).toBeNull()
  })

  it('clears a stored record whose handle is not a directory', async () => {
    const { provider, handleStore } = folderProvider()
    await handleStore.put({
      id: 'folder:workspace',
      name: 'workspace',
      handle: { kind: 'file' } as unknown as FileSystemDirectoryHandle,
    })

    expect(await provider.restore('folder:workspace')).toBeNull()
    expect(await handleStore.get()).toBeNull()
  })

  it('declares platform case sensitivity', () => {
    expect(
      new FolderWorkspaceProvider({
        picker: async () => createFakeWorkspace(),
        platform: 'Linux',
      }).capabilities().caseSensitive,
    ).toBe(true)
    expect(
      new FolderWorkspaceProvider({
        picker: async () => createFakeWorkspace(),
        platform: 'Win32',
      }).capabilities().caseSensitive,
    ).toBe(false)
    expect(
      new FolderWorkspaceProvider({
        picker: async () => createFakeWorkspace(),
        platform: 'MacIntel',
      }).capabilities().caseSensitive,
    ).toBe(false)
  })

  it('uses lastModified:size as the version and conflicts on a stale write', async () => {
    const { provider } = folderProvider()
    const handle = await provider.open()
    await handle.write('/a.txt', new TextEncoder().encode('one'), { create: true })
    const loaded = await handle.stat('/a.txt')

    await handle.write('/a.txt', new TextEncoder().encode('two'))
    await expect(
      handle.write('/a.txt', new TextEncoder().encode('stale'), {
        ifVersion: loaded.version,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(new TextDecoder().decode(await handle.read('/a.txt'))).toBe('two')
  })
})
