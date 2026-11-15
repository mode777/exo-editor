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
    onFailure: (failure) => failures.push(failure),
    onVersion: (version) => versions.push(version),
    onLog: (event) => logs.push(event),
    ...overrides,
  }
  const handler = new HandlerSession(options)
  handler.start()
  const frame = transport.frames[0] as FakeFrame
  return { transport, frame, handler, dirty, failures, logs, versions, session, stat, events }
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
      capabilities: { read: true, write: true, requestFiles: true },
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
