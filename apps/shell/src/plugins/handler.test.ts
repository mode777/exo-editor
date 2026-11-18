import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { FileStat, WorkspacePath, WorkspaceSession } from '../workspace/contract'
import { FakeFrameTransport, type FakeFrame } from './frame-test-support'
import { EventBus } from './events'
import {
  HandlerSession,
  resolveHandlerReadPath,
  type HandlerFailure,
  type HandlerSessionOptions,
} from './handler'
import type { EditorCandidate } from './registry'
import { DISPOSE_TIMEOUT_MS, SAVE_TIMEOUT_MS } from './protocol'

const SHELL_ORIGIN = 'https://editor.example.com'
const PLUGIN_ORIGIN = 'https://plugins.example.com'

function candidate(overrides: Partial<EditorCandidate> = {}): EditorCandidate {
  return {
    identity: `${PLUGIN_ORIGIN}::com.example.code`,
    pluginOrder: 0,
    pluginName: 'Code Plugin',
    pluginId: 'com.example.code',
    pluginVersion: '1.2.0',
    origin: PLUGIN_ORIGIN,
    permissions: ['workspace:read', 'workspace:write'],
    glob: '**/*.ts',
    entry: 'editors/code.html',
    entryUrl: `${PLUGIN_ORIGIN}/monaco/editors/code.html`,
    label: 'Code',
    priority: 10,
    registrationOrder: 0,
    ...overrides,
  }
}

async function makeSession(
  options: ConstructorParameters<typeof MemoryWorkspaceProvider>[0] = {},
): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    initialFiles: {
      '/exo.json': '{}',
      '/.exo/state.json': '{"private":true}',
      '/src/a.ts': 'export const a = 1',
      '/src/types.ts': 'export type T = 1',
      '/notes.txt': 'hello',
    },
    ...options,
  })
  const handle = await provider.open()
  return new Session(handle)
}

interface Started {
  transport: FakeFrameTransport
  frame: FakeFrame
  handler: HandlerSession
  dirty: boolean[]
  failures: HandlerFailure[]
  logs: Array<{ phase: string; code?: string }>
  versions: string[]
  saveRequests: number[]
  session: WorkspaceSession
  stat: FileStat
  events: EventBus
}

async function start(
  overrides: Partial<HandlerSessionOptions> = {},
  path: WorkspacePath = '/src/a.ts',
) {
  const transport = new FakeFrameTransport()
  const session = await makeSession()
  const stat = await session.stat(path)
  const dirty: boolean[] = []
  const failures: HandlerFailure[] = []
  const logs: Array<{ phase: string; code?: string }> = []
  const versions: string[] = []
  const saveRequests: number[] = []
  const events = new EventBus()
  const options: HandlerSessionOptions = {
    candidate: candidate(),
    file: {
      path,
      name: path.split('/').at(-1) ?? path,
      dir: path.slice(0, path.lastIndexOf('/')) || '/',
      size: stat.size,
      mtime: stat.mtime,
      version: stat.version,
    },
    session,
    transport,
    shellVersion: '0.1.0',
    shellOrigin: SHELL_ORIGIN,
    workspaceName: 'demo',
    theme: 'dark',
    locale: 'en',
    canWrite: true,
    maxFileSize: 10 * 1024 * 1024,
    maxRequestBytes: 16 * 1024 * 1024,
    events,
    createSessionId: () => 'session-1',
    onDirty: (value) => dirty.push(value),
    onSaveRequested: () => saveRequests.push(1),
    onRequestFiles: async () => ({ ok: true, paths: [] }),
    onFailure: (failure) => failures.push(failure),
    onVersion: (version) => versions.push(version),
    onLog: (event) => logs.push(event),
    ...overrides,
  }
  const handler = new HandlerSession(options)
  handler.start()
  const frame = transport.frames[0] as FakeFrame
  return {
    transport,
    frame,
    handler,
    dirty,
    failures,
    logs,
    versions,
    saveRequests,
    session,
    stat,
    events,
  }
}

function ready(context: Started, origin = PLUGIN_ORIGIN) {
  context.frame.emit(
    {
      exo: 1,
      type: 'plugin/ready',
      payload: { protocolVersion: '1', sessionId: 'session-1' },
    },
    origin,
  )
}

function postedType(frame: FakeFrame, type: string) {
  return frame.posted.find((entry) => (entry.message as { type?: string }).type === type)
    ?.message as { type: string; id?: string; payload?: unknown; replyTo?: string } | undefined
}

function requestFiles(context: Started, id: string, payload: Record<string, unknown> = {}) {
  context.frame.emit({ exo: 1, type: 'plugin/request-files', id, payload }, PLUGIN_ORIGIN)
}

function requestList(
  context: Started,
  id: string | undefined,
  payload: Record<string, unknown> | undefined,
) {
  context.frame.emit(
    {
      exo: 1,
      type: 'plugin/request-list',
      ...(id ? { id } : {}),
      ...(payload ? { payload } : {}),
    },
    PLUGIN_ORIGIN,
  )
}

function listReply(context: Started, id: string) {
  return context.frame.posted
    .map((entry) => entry.message as { type?: string; replyTo?: string; payload?: unknown })
    .find((message) => message.type === 'shell/list-result' && message.replyTo === id)
}

async function waitForList(context: Started, id: string) {
  return vi.waitFor(() => {
    const reply = listReply(context, id)
    expect(reply).toBeDefined()
    return reply
  })
}

function errorFor(context: Started, replyTo?: string): { code?: string } | undefined {
  return context.frame.posted
    .map((entry) => entry.message as { type?: string; replyTo?: string; payload?: unknown })
    .filter((message) => message.type === 'shell/error' && message.replyTo === replyTo)
    .at(-1)?.payload as { code?: string } | undefined
}

function selection(context: Started, id: string) {
  return context.frame.posted
    .map((entry) => entry.message as { type?: string; replyTo?: string; payload?: unknown })
    .find((message) => message.type === 'shell/files-selected' && message.replyTo === id)
}

async function requestFile(
  context: Started,
  id: string,
  path: string,
  encoding: 'utf8' | 'binary' = 'utf8',
) {
  context.frame.emit(
    { exo: 1, type: 'plugin/request-file', id, payload: { path, encoding } },
    PLUGIN_ORIGIN,
  )
  return vi.waitFor(() => {
    const reply = context.frame.posted
      .map((entry) => entry.message as { type?: string; replyTo?: string })
      .find((message) => message.type === 'shell/file-content' && message.replyTo === id)
    expect(reply).toBeDefined()
    return reply
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('handler session', () => {
  it('mounts the registered editor entry with the editor fragment and cross-origin sandbox', async () => {
    const context = await start()
    expect(context.frame.options.sandbox).toBe('allow-scripts allow-same-origin')
    const url = new URL(context.frame.options.url)
    expect(url.pathname).toBe('/monaco/editors/code.html')
    expect(url.hash).toContain('exo-mode=editor')
    expect(url.hash).toContain('exo-session=session-1')
  })

  it('sends metadata-only init after ready', async () => {
    const context = await start({ settings: { 'editor.size': 2 } })
    ready(context)
    const init = postedType(context.frame, 'shell/init')
    expect(init?.payload).toMatchObject({
      protocolVersion: '1',
      mode: 'editor',
      plugin: { id: 'com.example.code', version: '1.2.0' },
      file: { path: '/src/a.ts', name: 'a.ts', dir: '/src', version: context.stat.version },
      capabilities: {
        read: true,
        write: true,
        requestFiles: true,
        filePicker: true,
        directoryListing: true,
      },
      settings: { 'editor.size': 2 },
    })
    const serialized = JSON.stringify(init?.payload)
    expect(serialized).not.toContain('export const a = 1')
    expect(init?.payload).not.toHaveProperty('bytes')
    expect(init?.payload).not.toHaveProperty('text')
    expect(context.frame.posted[0].targetOrigin).toBe(PLUGIN_ORIGIN)
  })

  it('sends an empty settings map when no settings are declared', async () => {
    const context = await start()
    ready(context)
    expect(postedType(context.frame, 'shell/init')?.payload).toMatchObject({ settings: {} })
  })

  it('uses the stricter sandbox and wildcard target for a same-origin editor', async () => {
    const sameOrigin = candidate({
      identity: `${SHELL_ORIGIN}::com.example.code`,
      origin: SHELL_ORIGIN,
      entryUrl: `${SHELL_ORIGIN}/plugin-host-fixture/editor.html`,
    })
    const context = await start({ candidate: sameOrigin })
    expect(context.frame.options.sandbox).toBe('allow-scripts')
    ready(context, 'null')
    expect(postedType(context.frame, 'shell/init')?.type).toBe('shell/init')
    expect(context.frame.posted[0].targetOrigin).toBe('*')
  })

  it('fails a frame that never sends ready', async () => {
    vi.useFakeTimers()
    const context = await start()
    vi.advanceTimersByTime(10_000)
    expect(context.failures).toEqual([{ code: 'timeout', phase: 'ready', message: undefined }])
    expect(context.frame.closed).toBe(true)
  })

  it('rejects a wrong session echo and a foreign origin', async () => {
    const context = await start()
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/ready',
        payload: { protocolVersion: '1', sessionId: 'other' },
      },
      PLUGIN_ORIGIN,
    )
    expect(postedType(context.frame, 'shell/init')).toBeUndefined()
    expect(context.failures).toEqual([])

    const foreign = await start()
    ready(foreign, 'https://evil.example.com')
    expect(postedType(foreign.frame, 'shell/init')).toBeUndefined()
  })

  it('serves a relative read after normalization', async () => {
    const context = await start()
    ready(context)
    const reply = await requestFile(context, 'r1', './types.ts')
    expect(reply).toMatchObject({
      type: 'shell/file-content',
      replyTo: 'r1',
      payload: { path: '/src/types.ts', text: 'export type T = 1' },
    })
  })

  it('treats a leading slash as workspace-absolute', async () => {
    const context = await start()
    ready(context)
    const reply = await requestFile(context, 'r2', '/notes.txt')
    expect(reply).toMatchObject({ payload: { path: '/notes.txt', text: 'hello' } })
  })

  it('denies paths that leave the workspace', async () => {
    const context = await start()
    ready(context)
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/request-file',
        id: 'r3',
        payload: { path: '../../etc', encoding: 'utf8' },
      },
      PLUGIN_ORIGIN,
    )
    await vi.waitFor(() => {
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'permission-denied' },
        replyTo: 'r3',
      })
    })
  })

  it('denies reserved paths without reading them', async () => {
    const context = await start()
    ready(context)
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/request-file',
        id: 'r4',
        payload: { path: '/exo.json', encoding: 'utf8' },
      },
      PLUGIN_ORIGIN,
    )
    await vi.waitFor(() => {
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'permission-denied' },
        replyTo: 'r4',
      })
    })
    expect(
      context.frame.posted.some(
        (entry) => (entry.message as { type?: string }).type === 'shell/file-content',
      ),
    ).toBe(false)
  })

  it('denies a directory and an oversized file', async () => {
    const session = await makeSession({ initialFiles: { '/src/a.ts': 'small' } })
    const stat = await session.stat('/src/a.ts')
    const context = await start({ session, maxRequestBytes: 4 }, '/src/a.ts')
    expect(stat.size).toBeGreaterThan(4)
    ready(context)
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/request-file',
        id: 'r5',
        payload: { path: '/src', encoding: 'utf8' },
      },
      PLUGIN_ORIGIN,
    )
    await vi.waitFor(() => {
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'not-a-file' },
      })
    })
    const big = await start({ maxRequestBytes: 4 })
    ready(big)
    big.frame.emit(
      {
        exo: 1,
        type: 'plugin/request-file',
        id: 'r6',
        payload: { path: '/src/a.ts', encoding: 'utf8' },
      },
      PLUGIN_ORIGIN,
    )
    await vi.waitFor(() => {
      expect(postedType(big.frame, 'shell/error')).toMatchObject({
        payload: { code: 'too-large' },
      })
    })
  })

  it('serves a repeated read from the cache and re-reads after a change', async () => {
    const session = await makeSession()
    const reads: string[] = []
    const facade = session.forPlugin('com.example.code')
    const originalRead = facade.read.bind(facade)
    const counted = {
      capabilities: () => session.capabilities(),
      forPlugin: () => ({
        ...facade,
        read: (path: WorkspacePath, options?: { maxBytes?: number }) => {
          reads.push(path)
          return originalRead(path, options)
        },
      }),
    } as unknown as WorkspaceSession
    const context = await start({ session: counted }, '/src/a.ts')
    ready(context)
    await requestFile(context, 'r7', '/src/a.ts')
    await requestFile(context, 'r8', '/src/a.ts')
    expect(reads).toEqual(['/src/a.ts'])
    context.handler.notifyChange({
      kind: 'changed',
      path: '/src/a.ts',
      stat: { ...context.stat, version: `${context.stat.version}-next` },
    })
    expect((context.frame.posted.at(-1)?.message as { type?: string } | undefined)?.type).toBe(
      'shell/file-changed',
    )
    await requestFile(context, 'r9', '/src/a.ts')
    expect(reads).toHaveLength(2)
  })

  it('tracks only plugin dirty reports', async () => {
    const context = await start()
    ready(context)
    expect(context.dirty).toEqual([])
    context.frame.emit({ exo: 1, type: 'plugin/dirty', payload: { dirty: true } }, PLUGIN_ORIGIN)
    expect(context.dirty).toEqual([true])
    expect(context.handler.dirtySequence()).toBe(1)
  })

  it('answers a file picker request with paths only', async () => {
    const requests: Array<Record<string, unknown>> = []
    const context = await start({
      onRequestFiles: async (request) => {
        requests.push(request as unknown as Record<string, unknown>)
        return { ok: true, paths: ['/notes.txt'] }
      },
    })
    ready(context)
    requestFiles(context, 'pick-1')
    await vi.waitFor(() => expect(selection(context, 'pick-1')).toBeDefined())
    const reply = selection(context, 'pick-1')
    expect(reply?.payload).toEqual({ paths: ['/notes.txt'] })
    expect(Object.keys(reply?.payload as object)).toEqual(['paths'])
    expect(requests[0]).toMatchObject({
      path: '/src/a.ts',
      pluginId: 'com.example.code',
      pluginName: 'Code Plugin',
      multiple: false,
    })
    expect(requests[0].signal).toBeInstanceOf(AbortSignal)
    expect(requests[0].session).toBe(context.session)

    const read = await requestFile(context, 'read-after-pick', '/notes.txt')
    expect(read).toMatchObject({ payload: { path: '/notes.txt', text: 'hello' } })
  })

  it('passes multiple and directory and returns several paths', async () => {
    const context = await start({
      onRequestFiles: async (request) => {
        expect(request.multiple).toBe(true)
        expect(request.directory).toBe('/notes')
        return { ok: true, paths: ['/notes.txt', '/src/types.ts'] }
      },
    })
    ready(context)
    requestFiles(context, 'pick-2', { multiple: true, directory: '/notes' })
    await vi.waitFor(() => expect(selection(context, 'pick-2')).toBeDefined())
    expect(selection(context, 'pick-2')?.payload).toEqual({
      paths: ['/notes.txt', '/src/types.ts'],
    })
  })

  it('returns an empty path list when the picker is cancelled', async () => {
    const context = await start({ onRequestFiles: async () => ({ ok: true, paths: [] }) })
    ready(context)
    requestFiles(context, 'pick-3')
    await vi.waitFor(() => expect(selection(context, 'pick-3')).toBeDefined())
    expect(selection(context, 'pick-3')?.payload).toEqual({ paths: [] })
  })

  it('rejects reserved, traversal and oversized picker results before replying', async () => {
    const context = await start({
      onRequestFiles: async () => ({ ok: true, paths: ['/.exo/state.json'] }),
    })
    ready(context)
    requestFiles(context, 'pick-reserved')
    await vi.waitFor(() =>
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'permission-denied' },
        replyTo: 'pick-reserved',
      }),
    )
    expect(selection(context, 'pick-reserved')).toBeUndefined()

    const traversal = await start({
      onRequestFiles: async () => ({ ok: true, paths: ['/../outside'] }),
    })
    ready(traversal)
    requestFiles(traversal, 'pick-traversal')
    await vi.waitFor(() =>
      expect(postedType(traversal.frame, 'shell/error')).toMatchObject({
        payload: { code: 'permission-denied' },
        replyTo: 'pick-traversal',
      }),
    )

    const many = await start({
      onRequestFiles: async () => ({
        ok: true,
        paths: Array.from({ length: 33 }, (_, index) => `/file-${index}.txt`),
      }),
    })
    ready(many)
    requestFiles(many, 'pick-many', { multiple: true })
    await vi.waitFor(() =>
      expect(postedType(many.frame, 'shell/error')).toMatchObject({
        payload: { code: 'internal' },
        replyTo: 'pick-many',
      }),
    )
  })

  it('denies the picker without workspace read', async () => {
    const onRequestFiles = vi.fn(async () => ({ ok: true as const, paths: ['/notes.txt'] }))
    const context = await start({
      candidate: candidate({ permissions: ['events:subscribe'] }),
      onRequestFiles,
    })
    ready(context)
    requestFiles(context, 'pick-4')
    await vi.waitFor(() =>
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'permission-denied' },
        replyTo: 'pick-4',
      }),
    )
    expect(onRequestFiles).not.toHaveBeenCalled()
  })

  it('rejects malformed picker payloads and unknown fields', async () => {
    const onRequestFiles = vi.fn(async () => ({ ok: true as const, paths: [] }))
    const context = await start({ onRequestFiles })
    ready(context)
    requestFiles(context, 'pick-5', { multiple: 'yes' })
    requestFiles(context, 'pick-6', { directory: 1 })
    requestFiles(context, 'pick-7', { title: 'not allowed' })
    context.frame.emit({ exo: 1, type: 'plugin/request-files', payload: {} }, PLUGIN_ORIGIN)
    await vi.waitFor(() => {
      expect(
        context.frame.posted.filter(
          (entry) =>
            (entry.message as { type?: string }).type === 'shell/error' &&
            (entry.message as { payload?: { code?: string } }).payload?.code ===
              'protocol-violation',
        ),
      ).toHaveLength(3)
    })
    expect(onRequestFiles).not.toHaveBeenCalled()
    expect(selection(context, 'pick-5')).toBeUndefined()
    expect(selection(context, 'pick-7')).toBeUndefined()
  })

  it('rate-limits a second picker request in the same frame', async () => {
    let release: ((value: { ok: true; paths: string[] }) => void) | undefined
    const context = await start({
      onRequestFiles: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    ready(context)
    requestFiles(context, 'pick-8')
    await vi.waitFor(() => expect(release).toBeDefined())
    requestFiles(context, 'pick-9')
    await vi.waitFor(() =>
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'rate-limited' },
        replyTo: 'pick-9',
      }),
    )
    release?.({ ok: true, paths: ['/notes.txt'] })
    await vi.waitFor(() => expect(selection(context, 'pick-8')).toBeDefined())
    expect(selection(context, 'pick-8')?.payload).toEqual({ paths: ['/notes.txt'] })
  })

  it('drops a picker continuation after disposal', async () => {
    let release: ((value: { ok: true; paths: string[] }) => void) | undefined
    const context = await start({
      onRequestFiles: () =>
        new Promise((resolve) => {
          release = resolve
        }),
    })
    ready(context)
    requestFiles(context, 'pick-10')
    await vi.waitFor(() => expect(release).toBeDefined())
    const disposing = context.handler.dispose('closed')
    context.frame.emit({ exo: 1, type: 'plugin/dispose-ack' }, PLUGIN_ORIGIN)
    await disposing
    release?.({ ok: true, paths: ['/notes.txt'] })
    await Promise.resolve()
    expect(selection(context, 'pick-10')).toBeUndefined()
  })

  it('accepts an id-less save intent without sending content', async () => {
    const context = await start()
    ready(context)
    context.frame.emit({ exo: 1, type: 'plugin/request-save' }, PLUGIN_ORIGIN)
    expect(context.saveRequests).toHaveLength(1)
    expect(postedType(context.frame, 'shell/request-save')).toBeUndefined()
    expect(postedType(context.frame, 'shell/save-result')).toBeUndefined()
    expect(postedType(context.frame, 'shell/error')).toBeUndefined()

    context.frame.emit({ exo: 1, type: 'plugin/request-save', payload: {} }, PLUGIN_ORIGIN)
    expect(context.saveRequests).toHaveLength(2)
  })

  it('rejects a correlated or content-bearing save intent', async () => {
    const context = await start()
    ready(context)
    context.frame.emit({ exo: 1, type: 'plugin/request-save', id: 'save-me' }, PLUGIN_ORIGIN)
    context.frame.emit(
      { exo: 1, type: 'plugin/request-save', payload: { text: 'sneaky' } },
      PLUGIN_ORIGIN,
    )
    expect(context.saveRequests).toEqual([])
    expect(postedType(context.frame, 'shell/request-save')).toBeUndefined()
    expect(postedType(context.frame, 'shell/error')).toMatchObject({
      payload: { code: 'protocol-violation' },
    })
  })

  it('ignores a save intent before ready and after disposal', async () => {
    const early = await start()
    early.frame.emit({ exo: 1, type: 'plugin/request-save' }, PLUGIN_ORIGIN)
    expect(early.saveRequests).toEqual([])
    expect(postedType(early.frame, 'shell/error')).toMatchObject({
      payload: { code: 'protocol-violation' },
    })

    const context = await start()
    ready(context)
    const disposing = context.handler.dispose('closed')
    context.frame.emit({ exo: 1, type: 'plugin/dispose-ack' }, PLUGIN_ORIGIN)
    await disposing
    context.frame.emit({ exo: 1, type: 'plugin/request-save' }, PLUGIN_ORIGIN)
    expect(context.saveRequests).toEqual([])
  })

  it('round-trips a save and answers with the request id', async () => {
    const context = await start()
    ready(context)
    const request = context.handler.requestSave()
    const saveRequest = await vi.waitFor(() => {
      const message = postedType(context.frame, 'shell/request-save')
      expect(message).toBeDefined()
      return message
    })
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/save-content',
        replyTo: saveRequest?.id,
        payload: { text: 'edited' },
      },
      PLUGIN_ORIGIN,
    )
    const answer = await request
    expect(answer).toMatchObject({ ok: true, content: { text: 'edited' } })
    if (!answer.ok) return
    context.handler.completeSave({ ok: true, version: 'v2' })
    expect(postedType(context.frame, 'shell/save-result')).toMatchObject({
      payload: { ok: true, version: 'v2' },
      replyTo: saveRequest?.id,
    })
  })

  it('counts unsolicited save content as a violation and writes nothing', async () => {
    const context = await start()
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/save-content', replyTo: 'missing', payload: { text: 'x' } },
      PLUGIN_ORIGIN,
    )
    expect(postedType(context.frame, 'shell/save-result')).toBeUndefined()
    expect(postedType(context.frame, 'shell/error')).toMatchObject({
      payload: { code: 'protocol-violation' },
    })
  })

  it('times out a save after five seconds', async () => {
    vi.useFakeTimers()
    const context = await start()
    ready(context)
    const request = context.handler.requestSave()
    vi.advanceTimersByTime(SAVE_TIMEOUT_MS)
    await expect(request).resolves.toMatchObject({ ok: false, code: 'timeout' })
    expect(postedType(context.frame, 'shell/save-result')).toMatchObject({
      payload: { ok: false, code: 'timeout' },
    })
  })

  it('queues one save and rejects a third', async () => {
    const context = await start()
    ready(context)
    const first = context.handler.requestSave()
    const second = context.handler.requestSave()
    await expect(context.handler.requestSave()).resolves.toMatchObject({
      ok: false,
      code: 'rate-limited',
    })
    const firstRequest = postedType(context.frame, 'shell/request-save')
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/save-content',
        replyTo: firstRequest?.id,
        payload: { text: 'one' },
      },
      PLUGIN_ORIGIN,
    )
    await expect(first).resolves.toMatchObject({ ok: true })
    context.handler.completeSave({ ok: true, version: 'v2' })
    const secondRequest = context.frame.posted
      .filter((entry) => (entry.message as { type?: string }).type === 'shell/request-save')
      .at(-1)?.message as { id?: string } | undefined
    expect(secondRequest?.id).toBeDefined()
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/save-content',
        replyTo: secondRequest?.id,
        payload: { text: 'two' },
      },
      PLUGIN_ORIGIN,
    )
    await expect(second).resolves.toMatchObject({ ok: true })
    context.handler.completeSave({ ok: true, version: 'v3' })
  })

  it('disposes after the acknowledgement and drops later messages', async () => {
    vi.useFakeTimers()
    const context = await start()
    ready(context)
    const disposing = context.handler.dispose('closed')
    expect(postedType(context.frame, 'shell/dispose')).toMatchObject({
      payload: { reason: 'closed' },
    })
    context.frame.emit({ exo: 1, type: 'plugin/dispose-ack' }, PLUGIN_ORIGIN)
    await disposing
    expect(context.frame.closed).toBe(true)
    const postedBefore = context.frame.posted.length
    context.frame.emit(
      {
        exo: 1,
        type: 'plugin/request-file',
        id: 'late',
        payload: { path: '/notes.txt', encoding: 'utf8' },
      },
      PLUGIN_ORIGIN,
    )
    expect(context.frame.posted.length).toBe(postedBefore)
  })

  it('removes a frame that never acknowledges disposal', async () => {
    vi.useFakeTimers()
    const context = await start()
    ready(context)
    const disposing = context.handler.dispose('closed')
    vi.advanceTimersByTime(DISPOSE_TIMEOUT_MS)
    await disposing
    expect(context.frame.closed).toBe(true)
  })

  it('handles subscription messages', async () => {
    const context = await start()
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )
    expect(postedType(context.frame, 'shell/error')).toMatchObject({
      payload: { code: 'permission-denied' },
      replyTo: 's1',
    })
    context.frame.emit({ exo: 1, type: 'plugin/dirty', payload: { dirty: true } }, PLUGIN_ORIGIN)
    expect(context.dirty).toEqual([true])
  })
})

const listingCandidate = () => candidate({ permissions: ['workspace:read', 'workspace:list'] })

describe('handler directory listing', () => {
  it('advertises the support bit and serves the first page without metadata', async () => {
    const context = await start({ candidate: listingCandidate() })
    ready(context)
    expect(postedType(context.frame, 'shell/init')?.payload).toMatchObject({
      capabilities: { directoryListing: true },
    })

    requestList(context, 'l1', { path: '/' })
    const reply = await waitForList(context, 'l1')
    expect(reply?.payload).toEqual({
      entries: [
        { path: '/src', kind: 'directory' },
        { path: '/notes.txt', kind: 'file', size: 5 },
      ],
    })
    expect(JSON.stringify(reply?.payload)).not.toContain('mtime')
    expect(JSON.stringify(reply?.payload)).not.toContain('version')
    expect(JSON.stringify(reply?.payload)).not.toContain('hello')
  })

  it('resolves relative and absolute directories', async () => {
    const context = await start({ candidate: listingCandidate() }, '/src/a.ts')
    ready(context)

    requestList(context, 'rel', { path: '.' })
    expect((await waitForList(context, 'rel'))?.payload).toEqual({
      entries: [
        { path: '/src/a.ts', kind: 'file', size: 18 },
        { path: '/src/types.ts', kind: 'file', size: 17 },
      ],
    })

    requestList(context, 'abs', { path: '/src' })
    expect((await waitForList(context, 'abs'))?.payload).toEqual({
      entries: [
        { path: '/src/a.ts', kind: 'file', size: 18 },
        { path: '/src/types.ts', kind: 'file', size: 17 },
      ],
    })
  })

  it('maps missing, file and reserved paths', async () => {
    const context = await start({ candidate: listingCandidate() })
    ready(context)

    requestList(context, 'missing', { path: '/missing' })
    await vi.waitFor(() => {
      expect(errorFor(context, 'missing')).toMatchObject({ code: 'not-found' })
    })

    requestList(context, 'file', { path: '/notes.txt' })
    await vi.waitFor(() => {
      expect(errorFor(context, 'file')).toMatchObject({ code: 'not-a-directory' })
    })

    requestList(context, 'reserved-file', { path: '/exo.json' })
    await vi.waitFor(() => {
      expect(errorFor(context, 'reserved-file')).toMatchObject({ code: 'permission-denied' })
    })
    requestList(context, 'reserved-dir', { path: '/.exo' })
    await vi.waitFor(() => {
      expect(errorFor(context, 'reserved-dir')).toMatchObject({ code: 'permission-denied' })
    })
    expect(listReply(context, 'missing')).toBeUndefined()
  })

  it('denies listing without workspace:list and performs no provider call', async () => {
    const session = await makeSession()
    const facade = session.forPlugin('com.example.code')
    const providerList = vi.spyOn(facade, 'list')
    const context = await start({ session }, '/src/a.ts')
    ready(context)

    requestList(context, 'denied', { path: '/' })
    await vi.waitFor(() => {
      expect(postedType(context.frame, 'shell/error')).toMatchObject({
        payload: { code: 'permission-denied' },
        replyTo: 'denied',
      })
    })
    expect(providerList).not.toHaveBeenCalled()
  })

  it('rejects malformed and out-of-phase requests', async () => {
    const malformed: Array<{ id?: string; payload?: Record<string, unknown> }> = [
      { payload: { path: '/' } },
      { id: 'bad-path', payload: { path: 1 } },
      { id: 'bad-cursor', payload: { path: '/', cursor: 1 } },
      { id: 'extra', payload: { path: '/', extra: true } },
      { id: 'no-payload' },
    ]
    for (const item of malformed) {
      const context = await start({ candidate: listingCandidate() })
      ready(context)
      requestList(context, item.id, item.payload)
      expect(errorFor(context, item.id)).toMatchObject({ code: 'protocol-violation' })
      expect(listReply(context, item.id ?? '')).toBeUndefined()
    }

    const early = await start({ candidate: listingCandidate() })
    requestList(early, 'early', { path: '/' })
    expect(postedType(early.frame, 'shell/error')).toMatchObject({
      payload: { code: 'protocol-violation' },
    })
  })

  it('paginates a 1,001-entry directory and keeps the entry payload minimal', async () => {
    const initialFiles: Record<string, string> = {}
    for (let index = 0; index < 1001; index += 1) {
      initialFiles[`/big/f${String(index).padStart(4, '0')}.txt`] = 'x'
    }
    const session = await makeSession({ initialFiles })
    const context = await start({ session, candidate: listingCandidate() }, '/src/a.ts')
    ready(context)

    requestList(context, 'p1', { path: '/big' })
    const first = await waitForList(context, 'p1')
    const firstPayload = first?.payload as {
      entries: Array<Record<string, unknown>>
      nextCursor?: string
    }
    expect(firstPayload.entries).toHaveLength(1000)
    expect(firstPayload.nextCursor).toBeDefined()
    expect(Object.keys(firstPayload.entries[0]).sort()).toEqual(['kind', 'path', 'size'])

    requestList(context, 'p2', { path: '/big', cursor: firstPayload.nextCursor })
    const second = await waitForList(context, 'p2')
    expect(second?.payload).toEqual({
      entries: [{ path: '/big/f1000.txt', kind: 'file', size: 1 }],
    })
  })

  it('keeps reads on the normal request-file path after discovery', async () => {
    const context = await start({ candidate: listingCandidate() })
    ready(context)
    requestList(context, 'l1', { path: '/' })
    const reply = await waitForList(context, 'l1')
    const entries = (reply?.payload as { entries: Array<{ path: string }> }).entries
    expect(entries.map((entry) => entry.path)).toContain('/notes.txt')
    await requestFile(context, 'read-after-list', '/notes.txt')
    expect(postedType(context.frame, 'shell/file-content')).toMatchObject({
      payload: { path: '/notes.txt', text: 'hello' },
      replyTo: 'read-after-list',
    })
  })

  it.each(['closed', 'workspace-switch'] as const)(
    'drops a page that resolves after %s disposal',
    async (reason) => {
      const session = await makeSession()
      const facade = session.forPlugin('com.example.code')
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const delayed = {
        capabilities: () => session.capabilities(),
        forPlugin: () => ({
          ...facade,
          list: () => gate.then(() => []),
        }),
      } as unknown as WorkspaceSession
      const context = await start({ session: delayed, candidate: listingCandidate() }, '/src/a.ts')
      ready(context)
      requestList(context, 'late', { path: '/' })
      const disposing = context.handler.dispose(reason)
      context.frame.emit({ exo: 1, type: 'plugin/dispose-ack' }, PLUGIN_ORIGIN)
      await disposing
      release()
      await Promise.resolve()
      await Promise.resolve()
      expect(listReply(context, 'late')).toBeUndefined()
      expect(postedType(context.frame, 'shell/error')).toBeUndefined()
    },
  )
})

describe('handler subscriptions', () => {
  const subscribed = () => candidate({ permissions: ['workspace:read', 'events:subscribe'] })

  function messages(frame: FakeFrame, type: string) {
    return frame.posted
      .map((entry) => entry.message as { type: string; payload?: unknown; replyTo?: string })
      .filter((message) => message.type === type)
  }

  it('grants a subscribe and delivers topic events', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )
    expect(messages(context.frame, 'shell/subscribed').at(-1)).toMatchObject({
      payload: { topic: 'theme/changed', seq: 0 },
      replyTo: 's1',
    })

    context.events.publish('theme/changed', { theme: 'light' })
    context.events.flush()
    expect(messages(context.frame, 'shell/event').at(-1)).toMatchObject({
      payload: {
        topic: 'theme/changed',
        seq: 1,
        payload: { theme: 'light' },
      },
    })
  })

  it('reports the current sequence on a repeated subscribe', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    for (const id of ['s1', 's2']) {
      context.frame.emit(
        { exo: 1, type: 'plugin/subscribe', id, payload: { topic: 'theme/changed' } },
        PLUGIN_ORIGIN,
      )
    }
    context.events.publish('theme/changed', { theme: 'dark' })
    context.events.flush()
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's3', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )
    expect(messages(context.frame, 'shell/subscribed').at(-1)).toMatchObject({
      payload: { topic: 'theme/changed', seq: 1 },
      replyTo: 's3',
    })
    expect(messages(context.frame, 'shell/event')).toHaveLength(1)
  })

  it('rejects an unknown topic and delivers nothing for it', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'workspace/*' } },
      PLUGIN_ORIGIN,
    )
    expect(messages(context.frame, 'shell/subscribed').at(-1)).toMatchObject({
      payload: { topic: 'workspace/*', code: 'unsupported-topic' },
    })
    context.events.publish('workspace/file-changed', { path: '/a.txt', kind: 'changed' })
    context.events.flush()
    expect(messages(context.frame, 'shell/event')).toHaveLength(0)
  })

  it('stops delivery after unsubscribe', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )
    context.frame.emit(
      { exo: 1, type: 'plugin/unsubscribe', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )
    context.events.publish('theme/changed', { theme: 'dark' })
    context.events.flush()
    expect(messages(context.frame, 'shell/event')).toHaveLength(0)
  })

  it('drops subscriptions and queued events on dispose', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )
    context.events.publish('theme/changed', { theme: 'dark' })
    await context.handler.dispose('closed')
    context.events.flush()
    expect(messages(context.frame, 'shell/event')).toHaveLength(0)

    context.events.publish('theme/changed', { theme: 'light' })
    context.events.flush()
    expect(messages(context.frame, 'shell/event')).toHaveLength(0)
  })

  it('accepts the reserved config topic and keeps it silent', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'config/changed' } },
      PLUGIN_ORIGIN,
    )
    expect(messages(context.frame, 'shell/subscribed').at(-1)).toMatchObject({
      payload: { topic: 'config/changed', seq: 0 },
    })
    context.events.flush()
    expect(messages(context.frame, 'shell/event')).toHaveLength(0)
  })

  it('treats a malformed subscription as a protocol violation', async () => {
    const context = await start({ candidate: subscribed() })
    ready(context)
    context.frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topics: ['theme/changed'] } },
      PLUGIN_ORIGIN,
    )
    expect(postedType(context.frame, 'shell/error')).toMatchObject({
      payload: { code: 'protocol-violation' },
      replyTo: 's1',
    })
  })
})

describe('resolveHandlerReadPath', () => {
  it('resolves siblings, parents inside the root and absolute paths', () => {
    expect(resolveHandlerReadPath('/src/editor.ts', './types.ts')).toBe('/src/types.ts')
    expect(resolveHandlerReadPath('/src/editor.ts', 'types.ts')).toBe('/src/types.ts')
    expect(resolveHandlerReadPath('/src/deep/editor.ts', '../types.ts')).toBe('/src/types.ts')
    expect(resolveHandlerReadPath('/src/editor.ts', '/notes.txt')).toBe('/notes.txt')
  })

  it('refuses a path above the workspace root', () => {
    expect(() => resolveHandlerReadPath('/editor.ts', '../secret')).toThrow()
    expect(() => resolveHandlerReadPath('/editor.ts', '')).toThrow()
  })
})
