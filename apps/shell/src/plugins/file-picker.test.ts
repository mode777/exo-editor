import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import { FilePickerController, type FilePickerOpenRequest } from './file-picker'

async function makeSession(): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    initialFiles: {
      '/a.txt': 'a',
      '/dir/b.txt': 'b',
      '/exo.json': '{}',
      '/.exo/state.json': '{"private":true}',
    },
  })
  return new Session(await provider.open())
}

function request(
  session: WorkspaceSession,
  overrides: Partial<FilePickerOpenRequest> = {},
): FilePickerOpenRequest {
  return {
    path: '/a.txt',
    pluginId: 'com.example.code',
    pluginName: 'Code Plugin',
    multiple: false,
    session,
    signal: new AbortController().signal,
    ...overrides,
  }
}

describe('file picker controller', () => {
  it('exposes one pending request and resolves selected paths', async () => {
    const session = await makeSession()
    const controller = new FilePickerController()
    const listener = vi.fn()
    controller.subscribe(listener)
    const pending = controller.request(request(session))
    expect(controller.getSnapshot()).toMatchObject({
      path: '/a.txt',
      pluginId: 'com.example.code',
      pluginName: 'Code Plugin',
      multiple: false,
      session,
    })
    expect(listener).toHaveBeenCalledTimes(1)

    controller.select(['/a.txt'])
    await expect(pending).resolves.toEqual({
      ok: true,
      paths: ['/a.txt'],
    })
    expect(controller.getSnapshot()).toBeNull()
  })

  it('accepts multiple paths when allowed', async () => {
    const session = await makeSession()
    const controller = new FilePickerController()
    const pending = controller.request(request(session, { multiple: true }))
    controller.select(['/a.txt', '/dir/b.txt'])
    await expect(pending).resolves.toEqual({
      ok: true,
      paths: ['/a.txt', '/dir/b.txt'],
    })
  })

  it('resolves cancellation with an empty successful selection', async () => {
    const session = await makeSession()
    const controller = new FilePickerController()
    const pending = controller.request(request(session))
    controller.cancel()
    await expect(pending).resolves.toEqual({ ok: true, paths: [] })
    expect(controller.getSnapshot()).toBeNull()
  })

  it('rejects a second request while one is pending', async () => {
    const session = await makeSession()
    const controller = new FilePickerController()
    const first = controller.request(request(session))
    await expect(controller.request(request(session))).resolves.toEqual({
      ok: false,
      code: 'rate-limited',
    })
    controller.cancel()
    await expect(first).resolves.toEqual({ ok: true, paths: [] })
  })

  it('closes silently when aborted or reset', async () => {
    const session = await makeSession()
    const controller = new FilePickerController()
    const abort = new AbortController()
    const aborted = controller.request(request(session, { signal: abort.signal }))
    abort.abort()
    await expect(aborted).resolves.toEqual({ ok: false, silent: true })
    expect(controller.getSnapshot()).toBeNull()

    const reset = controller.request(request(session))
    controller.reset()
    await expect(reset).resolves.toEqual({ ok: false, silent: true })
    expect(controller.getSnapshot()).toBeNull()
  })
})
