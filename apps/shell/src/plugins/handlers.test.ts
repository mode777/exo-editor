import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspacePath, WorkspaceSession } from '../workspace/contract'
import { FakeFrameTransport } from './frame-test-support'
import { HandlerPool, type HandlerPoolHost } from './handlers'
import type { EditorCandidate } from './registry'
import { MAX_HANDLER_FRAMES } from './protocol'

const SHELL_ORIGIN = 'https://editor.example.com'
const PLUGIN_ORIGIN = 'https://plugins.example.com'

function candidate(
  identity = `${PLUGIN_ORIGIN}::com.example.code`,
  overrides: Partial<EditorCandidate> = {},
): EditorCandidate {
  return {
    identity,
    pluginOrder: 0,
    pluginName: 'Code Plugin',
    pluginId: 'com.example.code',
    pluginVersion: '1.0.0',
    origin: identity.split('::')[0],
    permissions: ['workspace:read', 'workspace:write'],
    glob: '**/*.ts',
    entry: 'editors/code.html',
    entryUrl: `${identity.split('::')[0]}/monaco/editors/code.html`,
    label: 'Code',
    priority: 10,
    registrationOrder: 0,
    ...overrides,
  }
}

interface Harness {
  pool: HandlerPool
  transport: FakeFrameTransport
  session: WorkspaceSession
  host: HandlerPoolHost & { entries: Array<{ identity: string; phase: string; code?: string }> }
}

async function harness(files: Record<string, string> = { '/src/a.ts': 'a' }): Promise<Harness> {
  const provider = new MemoryWorkspaceProvider({ now: () => 1000, initialFiles: files })
  const handle = await provider.open()
  const session = new Session(handle)
  const transport = new FakeFrameTransport()
  const entries: Array<{ identity: string; phase: string; code?: string }> = []
  const candidates = new Map<WorkspacePath, EditorCandidate[]>()
  const host: Harness['host'] = {
    entries,
    match: (path) => candidates.get(path as WorkspacePath) ?? [],
    logHandler: (identity, phase, code) => entries.push({ identity, phase, code }),
  }
  const pool = new HandlerPool({
    transport,
    shellOrigin: SHELL_ORIGIN,
    shellVersion: '0.1.0',
    theme: () => 'dark',
    locale: 'en',
    createSessionId: () => 'session-1',
  })
  pool.attach({ session, host, workspaceName: 'demo' })
  return { pool, transport, session, host }
}

async function open(harness: Harness, path: WorkspacePath) {
  const stat = await harness.session.stat(path)
  const candidates = harness.pool.candidates(path)
  const chosen = candidates[0] ?? candidate()
  return harness.pool.open(
    { path, file: stat, candidate: chosen },
    {
      onActive: () => undefined,
      onDirty: () => undefined,
      onFailure: () => undefined,
      onVersion: () => undefined,
    },
  )
}

async function openWith(harness: Harness, path: WorkspacePath, chosen: EditorCandidate) {
  const stat = await harness.session.stat(path)
  return harness.pool.open(
    { path, file: stat, candidate: chosen },
    {
      onActive: () => undefined,
      onDirty: () => undefined,
      onFailure: () => undefined,
      onVersion: () => undefined,
    },
  )
}

function readyFrame(
  frame: ReturnType<FakeFrameTransport['open']>,
  origin: string,
  sessionId = 'session-1',
) {
  frame.emit({ exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId } }, origin)
}

function subscribe(frame: ReturnType<FakeFrameTransport['open']>, origin: string, topic: string) {
  frame.emit({ exo: 1, type: 'plugin/subscribe', id: `sub-${topic}`, payload: { topic } }, origin)
}

function eventsFor(frame: ReturnType<FakeFrameTransport['open']>): unknown[] {
  return frame.posted
    .map((posted) => posted.message as { type?: string; payload?: unknown })
    .filter((message) => message.type === 'shell/event')
    .map((message) => message.payload)
}

describe('handler pool', () => {
  it('shows a frame surface only after the handler is active and hides on detach', async () => {
    const context = await harness({ '/src/a.ts': 'a' })
    const frameCandidate = candidate(undefined, { rendering: 'frame' })
    await openWith(context, '/src/a.ts', frameCandidate)
    const frame = context.transport.frames[0]
    expect(frame.options.visible).toBe(true)

    const slot = document.createElement('div')
    slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
    context.pool.attachSurface('/src/a.ts', slot)
    expect(frame.surfaceShown).toBe(false)

    readyFrame(frame, PLUGIN_ORIGIN)
    expect(frame.surfaceShown).toBe(true)
    expect(frame.surfaceBounds).toEqual({ left: 10, top: 20, width: 800, height: 600 })

    context.pool.attachSurface('/src/a.ts', null)
    expect(frame.surfaceShown).toBe(false)
    expect(frame.closed).toBe(false)
  })

  it('keeps hidden contributions headless when a surface is attached', async () => {
    const context = await harness({ '/src/a.ts': 'a' })
    await open(context, '/src/a.ts')
    const frame = context.transport.frames[0]
    expect(frame.options.visible).toBeUndefined()

    const slot = document.createElement('div')
    slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
    context.pool.attachSurface('/src/a.ts', slot)
    readyFrame(frame, PLUGIN_ORIGIN)
    expect(frame.surfaceShown).toBe(false)
    expect(frame.surface).toBeUndefined()
  })

  it('delivers config changes only to the target plugin frame', async () => {
    const context = await harness({ '/src/a.ts': 'a', '/src/b.ts': 'b' })
    const first = candidate('https://a.example.com::com.example.a', {
      pluginId: 'com.example.a',
      origin: 'https://a.example.com',
      permissions: ['workspace:read', 'events:subscribe'],
      entryUrl: 'https://a.example.com/plugins/a/editors/code.html',
    })
    const second = candidate('https://b.example.com::com.example.b', {
      pluginId: 'com.example.b',
      origin: 'https://b.example.com',
      permissions: ['workspace:read', 'events:subscribe'],
      entryUrl: 'https://b.example.com/plugins/b/editors/code.html',
    })
    await openWith(context, '/src/a.ts', first)
    await openWith(context, '/src/b.ts', second)
    const firstFrame = context.transport.frames[0]
    const secondFrame = context.transport.frames[1]
    readyFrame(firstFrame, 'https://a.example.com')
    readyFrame(secondFrame, 'https://b.example.com')
    subscribe(firstFrame, 'https://a.example.com', 'config/changed')
    subscribe(secondFrame, 'https://b.example.com', 'config/changed')

    context.pool.updateSettings(first.identity, { greeting: 'hi' })

    await vi.waitFor(() => expect(eventsFor(firstFrame)).toHaveLength(1))
    expect(eventsFor(secondFrame)).toEqual([])
    expect(eventsFor(firstFrame)[0]).toMatchObject({
      topic: 'config/changed',
      payload: { pluginId: 'com.example.a', values: { greeting: 'hi' } },
    })
  })

  it('refuses a 21st frame for one plugin', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < MAX_HANDLER_FRAMES + 1; index += 1) {
      files[`/f/${index}.ts`] = `${index}`
    }
    const context = await harness(files)
    const list = [candidate()]
    ;(context.host as unknown as { match: (path: string) => EditorCandidate[] }).match = () => list

    for (let index = 0; index < MAX_HANDLER_FRAMES; index += 1) {
      const result = await open(context, `/f/${index}.ts`)
      expect(result).toEqual({ ok: true })
    }
    expect(context.pool.count(candidate().identity)).toBe(MAX_HANDLER_FRAMES)
    expect(await open(context, `/f/${MAX_HANDLER_FRAMES}.ts`)).toEqual({
      ok: false,
      reason: 'cap',
    })
    expect(context.transport.frames).toHaveLength(MAX_HANDLER_FRAMES)
  })

  it('filters out candidates without read permission', async () => {
    const context = await harness()
    const list = [candidate(undefined, { permissions: ['events:subscribe'] })]
    ;(context.host as unknown as { match: (path: string) => EditorCandidate[] }).match = () => list
    expect(context.pool.candidates('/src/a.ts')).toEqual([])
  })

  it('closes every handler for an identity and logs the reason', async () => {
    const context = await harness({ '/src/a.ts': 'a', '/src/b.ts': 'b' })
    const list = [candidate()]
    ;(context.host as unknown as { match: (path: string) => EditorCandidate[] }).match = () => list
    await open(context, '/src/a.ts')
    await open(context, '/src/b.ts')
    context.pool.closeFor(candidate().identity, 'plugin-removed')
    expect(context.pool.has('/src/a.ts')).toBe(false)
    expect(context.pool.has('/src/b.ts')).toBe(false)
    expect(
      context.host.entries
        .filter((entry) => entry.phase === 'handler-dispose')
        .map((entry) => entry.code),
    ).toEqual(['plugin-removed', 'plugin-removed'])
  })

  it('re-keys a renamed document and forwards the change', async () => {
    const context = await harness({ '/src/a.ts': 'a' })
    const list = [candidate()]
    ;(context.host as unknown as { match: (path: string) => EditorCandidate[] }).match = () => list
    await open(context, '/src/a.ts')
    context.transport.frames[0].emit(
      {
        exo: 1,
        type: 'plugin/ready',
        payload: { protocolVersion: '1', sessionId: 'session-1' },
      },
      PLUGIN_ORIGIN,
    )
    context.pool.rename('/src/a.ts', '/src/b.ts')
    expect(context.pool.has('/src/a.ts')).toBe(false)
    const session = context.pool.get('/src/b.ts')
    expect(session?.path).toBe('/src/b.ts')
    context.pool.notifyChange({
      kind: 'renamed',
      previousPath: '/src/a.ts',
      path: '/src/b.ts',
      stat: {
        path: '/src/b.ts',
        kind: 'file',
        size: 1,
        mtime: 1000,
        version: 'v2',
      },
    })
    const posted = context.transport.frames[0].posted.at(-1)?.message as {
      type?: string
      payload?: unknown
    }
    expect(posted).toMatchObject({
      type: 'shell/file-changed',
      payload: { path: '/src/b.ts', kind: 'renamed', version: 'v2' },
    })
  })

  it('publishes only to subscribed frames and delivers workspace closure', async () => {
    const context = await harness({ '/src/a.ts': 'a', '/src/b.ts': 'b' })
    const list = [candidate(undefined, { permissions: ['workspace:read', 'events:subscribe'] })]
    ;(context.host as unknown as { match: (path: string) => EditorCandidate[] }).match = () => list
    await open(context, '/src/a.ts')
    await open(context, '/src/b.ts')
    const [first, second] = context.transport.frames
    for (const frame of [first, second]) {
      frame.emit(
        {
          exo: 1,
          type: 'plugin/ready',
          payload: { protocolVersion: '1', sessionId: 'session-1' },
        },
        PLUGIN_ORIGIN,
      )
    }
    first.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's1', payload: { topic: 'theme/changed' } },
      PLUGIN_ORIGIN,
    )

    context.pool.publish('theme/changed', { theme: 'light' })
    context.pool.events.flush()
    const delivered = (frame: typeof first) =>
      frame.posted
        .map((entry) => entry.message as { type?: string })
        .filter((message) => message.type === 'shell/event')
    expect(delivered(first)).toHaveLength(1)
    expect(delivered(second)).toHaveLength(0)

    first.emit(
      { exo: 1, type: 'plugin/subscribe', id: 's2', payload: { topic: 'workspace/closed' } },
      PLUGIN_ORIGIN,
    )
    context.pool.publishWorkspaceClosed('switch')
    expect(delivered(first).at(-1)).toMatchObject({
      payload: { topic: 'workspace/closed', payload: { reason: 'switch' } },
    })
  })

  it('awaits disposal of every handler when detaching', async () => {
    vi.useFakeTimers()
    const context = await harness({ '/src/a.ts': 'a' })
    const list = [candidate()]
    ;(context.host as unknown as { match: (path: string) => EditorCandidate[] }).match = () => list
    await open(context, '/src/a.ts')
    const detached = context.pool.detach()
    expect(context.pool.has('/src/a.ts')).toBe(false)
    context.transport.frames[0].emit(
      { exo: 1, type: 'plugin/dispose-ack' },
      PLUGIN_ORIGIN,
      context.transport.frames[0].window,
    )
    await detached
    expect(context.transport.frames[0].closed).toBe(true)
    vi.useRealTimers()
  })
})
