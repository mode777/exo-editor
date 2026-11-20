import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import { NewFileController, type NewFileRequest } from './new-file'

async function makeSession(): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({
    initialFiles: { '/notes.txt': 'old', '/exo.json': '{}' },
    initialDirectories: ['/docs'],
  })
  return new Session(await provider.open())
}

function request(
  session: WorkspaceSession,
  overrides: Partial<NewFileRequest> = {},
): NewFileRequest {
  return {
    kind: 'request',
    identity: 'https://plugins.example.com::com.example.plugin',
    pluginId: 'com.example.plugin',
    pluginName: 'Example Plugin',
    content: { bytes: new TextEncoder().encode('hello'), text: 'hello' },
    fallbackDirectory: '/',
    session,
    signal: new AbortController().signal,
    ...overrides,
  }
}

function controller() {
  const created = vi.fn()
  const logs: Array<{ phase: string; code?: string }> = []
  return {
    created,
    logs,
    controller: new NewFileController({
      onCreated: created,
      onLog: (event) =>
        logs.push({ phase: event.phase, ...(event.code ? { code: event.code } : {}) }),
    }),
  }
}

describe('NewFileController', () => {
  it('writes text create-only and resolves the path and version', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    const promise = files.request(request(session))
    expect(files.getSnapshot()).toMatchObject({
      kind: 'request',
      pluginId: 'com.example.plugin',
      directory: '/',
      name: '',
      size: 5,
      preview: 'hello',
      binary: false,
    })

    await files.submit('/docs', 'report.md')
    await expect(promise).resolves.toMatchObject({ ok: true, path: '/docs/report.md' })
    expect(Array.from(await session.read('/docs/report.md'))).toEqual(
      Array.from(new TextEncoder().encode('hello')),
    )
    expect(files.getSnapshot()).toBeNull()
  })

  it('writes exact bytes without preview text', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    const bytes = new Uint8Array([0, 1, 2, 255])
    const promise = files.request(
      request(session, { content: { bytes }, suggestedName: 'image.bin' }),
    )
    expect(files.getSnapshot()).toMatchObject({
      name: 'image.bin',
      size: 4,
      binary: true,
    })
    expect(files.getSnapshot()?.preview).toBeUndefined()

    await files.submit('/', 'image.bin')
    await expect(promise).resolves.toMatchObject({ ok: true, path: '/image.bin' })
    expect(Array.from(await session.read('/image.bin'))).toEqual(Array.from(bytes))
  })

  it('keeps the dialog open on a collision and never overwrites', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    const promise = files.request(request(session))
    await files.submit('/', 'notes.txt')

    expect(files.getSnapshot()?.error).toContain('already exists')
    expect(new TextDecoder().decode(await session.read('/notes.txt'))).toBe('old')

    await files.submit('/', 'fresh.txt')
    await expect(promise).resolves.toMatchObject({ ok: true, path: '/fresh.txt' })
  })

  it('rejects a reserved name without writing', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    void files.request(request(session))
    await files.submit('/', 'exo.json')
    expect(files.getSnapshot()?.error).toBeTruthy()
    expect(new TextDecoder().decode(await session.read('/exo.json'))).toBe('{}')
    files.cancel()
  })

  it('resolves null-like cancellation and drops a second request', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    const first = files.request(request(session))
    await expect(files.request(request(session))).resolves.toMatchObject({
      ok: false,
      code: 'rate-limited',
    })
    files.cancel()
    await expect(first).resolves.toMatchObject({ ok: false, cancelled: true })
    expect(files.getSnapshot()).toBeNull()
  })

  it('closes silently when the frame is disposed or the workspace resets', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    const first = files.request(request(session))
    files.closeFor('other::identity', 'plugin-removed')
    expect(files.getSnapshot()).not.toBeNull()
    files.closeFor('https://plugins.example.com::com.example.plugin', 'plugin-removed')
    await expect(first).resolves.toMatchObject({ ok: false, silent: true })

    const second = files.request(request(session))
    files.reset()
    await expect(second).resolves.toMatchObject({ ok: false, silent: true })
  })

  it('aborts a pending request when its signal fires', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    const abort = new AbortController()
    const pending = files.request(request(session, { signal: abort.signal }))
    abort.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, silent: true })
    expect(files.getSnapshot()).toBeNull()
  })

  it('falls back from invalid hints instead of trusting them', async () => {
    const session = await makeSession()
    const { controller: files } = controller()
    void files.request(
      request(session, {
        suggestedName: '../escape.txt',
        directory: '/.exo',
      }),
    )
    expect(files.getSnapshot()).toMatchObject({ directory: '/', name: '' })
    files.cancel()
  })

  it('opens a template-created file and never auto-opens a runtime request', async () => {
    const session = await makeSession()
    const { controller: files, created } = controller()
    files.beginTemplate({
      kind: 'template',
      templateId: 'report',
      fileName: 'report.md',
      identity: 'https://plugins.example.com::com.example.plugin',
      pluginId: 'com.example.plugin',
      pluginName: 'Example Plugin',
      content: { bytes: new TextEncoder().encode('# Report'), text: '# Report' },
      fallbackDirectory: '/docs',
      directory: '/docs',
      session,
    })
    await files.submit('/docs', 'report.md')
    expect(created).toHaveBeenCalledWith('/docs/report.md', 'template')

    created.mockClear()
    const promise = files.request(request(session))
    await files.submit('/', 'runtime.txt')
    await expect(promise).resolves.toMatchObject({ ok: true })
    expect(created).not.toHaveBeenCalled()
  })
})
