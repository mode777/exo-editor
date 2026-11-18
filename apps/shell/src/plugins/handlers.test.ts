import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspacePath, WorkspaceSession } from '../workspace/contract'
import { FakeFrameTransport } from './frame-test-support'
import { HandlerPool, type HandlerPoolHost } from './handlers'
import {
  FilePickerController,
  type FilePickerOpenRequest,
  type FilePickerOutcome,
} from './file-picker'
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
  saveRequests: WorkspacePath[]
  pickerRequests: FilePickerOpenRequest[]
  host: HandlerPoolHost & { entries: Array<{ identity: string; phase: string; code?: string }> }
}

async function harness(
  files: Record<string, string> = { '/src/a.ts': 'a' },
  options: {
    onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
    isPickerOpen?: () => boolean
  } = {},
): Promise<Harness> {
  const provider = new MemoryWorkspaceProvider({ now: () => 1000, initialFiles: files })
  const handle = await provider.open()
  const session = new Session(handle)
  const transport = new FakeFrameTransport()
  const entries: Array<{ identity: string; phase: string; code?: string }> = []
  const saveRequests: WorkspacePath[] = []
  const pickerRequests: FilePickerOpenRequest[] = []
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
    onSaveRequested: (path) => saveRequests.push(path),
    onRequestFiles: (request) => {
      pickerRequests.push(request)
      return options.onRequestFiles?.(request) ?? Promise.resolve({ ok: true, paths: [] })
    },
    isPickerOpen: options.isPickerOpen,
  })
  pool.attach({ session, host, workspaceName: 'demo' })
  return { pool, transport, session, saveRequests, pickerRequests, host }
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

function requestFiles(
  frame: ReturnType<FakeFrameTransport['open']>,
  origin: string,
  id: string,
  payload: Record<string, unknown> = {},
) {
  frame.emit({ exo: 1, type: 'plugin/request-files', id, payload }, origin)
}

function selection(frame: ReturnType<FakeFrameTransport['open']>, id: string) {
  return frame.posted
    .map((posted) => posted.message as { type?: string; replyTo?: string; payload?: unknown })
    .find((message) => message.type === 'shell/files-selected' && message.replyTo === id)
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

  it('opens a picker only for an active visible focused handler', async () => {
    const context = await harness({ '/src/a.ts': 'a' })
    const frameCandidate = candidate(undefined, { rendering: 'frame' })
    await openWith(context, '/src/a.ts', frameCandidate)
    const frame = context.transport.frames[0]
    const slot = document.createElement('div')
    slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
    context.pool.attachSurface('/src/a.ts', slot)
    readyFrame(frame, PLUGIN_ORIGIN)

    frame.focused = false
    requestFiles(frame, PLUGIN_ORIGIN, 'pick-unfocused')
    await vi.waitFor(() =>
      expect(
        frame.posted
          .map((posted) => posted.message as { type?: string; payload?: { code?: string } })
          .find(
            (message) =>
              message.type === 'shell/error' && message.payload?.code === 'permission-denied',
          ),
      ).toBeDefined(),
    )
    expect(context.pickerRequests).toHaveLength(0)

    frame.focused = true
    requestFiles(frame, PLUGIN_ORIGIN, 'pick-visible')
    await vi.waitFor(() => expect(context.pickerRequests).toHaveLength(1))
    await vi.waitFor(() => expect(selection(frame, 'pick-visible')).toBeDefined())
    expect(selection(frame, 'pick-visible')?.payload).toEqual({ paths: [] })
  })

  it('allows one picker across frames and rate-limits the second', async () => {
    const controller = new FilePickerController()
    const context = await harness(
      { '/src/a.ts': 'a', '/src/b.ts': 'b' },
      {
        onRequestFiles: (request) => controller.request(request),
        isPickerOpen: () => controller.getSnapshot() !== null,
      },
    )
    const frameCandidate = candidate(undefined, { rendering: 'frame' })
    await openWith(context, '/src/a.ts', frameCandidate)
    await openWith(context, '/src/b.ts', frameCandidate)
    const first = context.transport.frames[0]
    const second = context.transport.frames[1]
    for (const frame of [first, second]) {
      const slot = document.createElement('div')
      slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
      const path = frame === first ? '/src/a.ts' : '/src/b.ts'
      context.pool.attachSurface(path, slot)
      readyFrame(frame, PLUGIN_ORIGIN)
    }

    requestFiles(first, PLUGIN_ORIGIN, 'pick-a')
    await vi.waitFor(() => expect(controller.getSnapshot()).not.toBeNull())
    requestFiles(second, PLUGIN_ORIGIN, 'pick-b')
    await vi.waitFor(() =>
      expect(
        second.posted
          .map((posted) => posted.message as { type?: string; payload?: { code?: string } })
          .find(
            (message) => message.type === 'shell/error' && message.payload?.code === 'rate-limited',
          ),
      ).toBeDefined(),
    )
    controller.cancel()
    await vi.waitFor(() => expect(selection(first, 'pick-a')).toBeDefined())
    expect(selection(first, 'pick-a')?.payload).toEqual({ paths: [] })
  })

  it('denies a picker from a hidden handler', async () => {
    const context = await harness({ '/src/a.ts': 'a' })
    await open(context, '/src/a.ts')
    const frame = context.transport.frames[0]
    readyFrame(frame, PLUGIN_ORIGIN)
    requestFiles(frame, PLUGIN_ORIGIN, 'pick-hidden')
    await vi.waitFor(() =>
      expect(
        frame.posted
          .map((posted) => posted.message as { type?: string; payload?: { code?: string } })
          .find(
            (message) =>
              message.type === 'shell/error' && message.payload?.code === 'permission-denied',
          ),
      ).toBeDefined(),
    )
    expect(context.pickerRequests).toHaveLength(0)
    expect(selection(frame, 'pick-hidden')).toBeUndefined()
  })

  it('closes a picker silently when the document surface detaches', async () => {
    let release: ((value: FilePickerOutcome) => void) | undefined
    const context = await harness(
      { '/src/a.ts': 'a' },
      {
        onRequestFiles: () =>
          new Promise<FilePickerOutcome>((resolve) => {
            release = resolve
          }),
      },
    )
    const frameCandidate = candidate(undefined, { rendering: 'frame' })
    await openWith(context, '/src/a.ts', frameCandidate)
    const frame = context.transport.frames[0]
    const slot = document.createElement('div')
    slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
    context.pool.attachSurface('/src/a.ts', slot)
    readyFrame(frame, PLUGIN_ORIGIN)
    requestFiles(frame, PLUGIN_ORIGIN, 'pick-detach')
    await vi.waitFor(() => expect(context.pickerRequests).toHaveLength(1))
    expect(context.pickerRequests[0].signal.aborted).toBe(false)

    context.pool.attachSurface('/src/a.ts', null)
    expect(context.pickerRequests[0].signal.aborted).toBe(true)
    release?.({ ok: true, paths: ['/src/a.ts'] })
    await Promise.resolve()
    expect(selection(frame, 'pick-detach')).toBeUndefined()
  })

  it('closes a picker silently on tab close and plugin removal', async () => {
    let release: ((value: FilePickerOutcome) => void) | undefined
    const context = await harness(
      { '/src/a.ts': 'a' },
      {
        onRequestFiles: () =>
          new Promise<FilePickerOutcome>((resolve) => {
            release = resolve
          }),
      },
    )
    const frameCandidate = candidate(undefined, { rendering: 'frame' })
    await openWith(context, '/src/a.ts', frameCandidate)
    const frame = context.transport.frames[0]
    const slot = document.createElement('div')
    slot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
    context.pool.attachSurface('/src/a.ts', slot)
    readyFrame(frame, PLUGIN_ORIGIN)
    requestFiles(frame, PLUGIN_ORIGIN, 'pick-close')
    await vi.waitFor(() => expect(context.pickerRequests).toHaveLength(1))
    context.pool.close('/src/a.ts')
    expect(context.pickerRequests[0].signal.aborted).toBe(true)
    release?.({ ok: true, paths: ['/src/a.ts'] })
    await Promise.resolve()
    expect(selection(frame, 'pick-close')).toBeUndefined()

    let releaseRemoval: ((value: FilePickerOutcome) => void) | undefined
    const removal = await harness(
      { '/src/a.ts': 'a' },
      {
        onRequestFiles: () =>
          new Promise<FilePickerOutcome>((resolve) => {
            releaseRemoval = resolve
          }),
      },
    )
    await openWith(removal, '/src/a.ts', frameCandidate)
    const removalFrame = removal.transport.frames[0]
    const removalSlot = document.createElement('div')
    removalSlot.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect
    removal.pool.attachSurface('/src/a.ts', removalSlot)
    readyFrame(removalFrame, PLUGIN_ORIGIN)
    requestFiles(removalFrame, PLUGIN_ORIGIN, 'pick-remove')
    await vi.waitFor(() => expect(removal.pickerRequests).toHaveLength(1))
    removal.pool.closeFor(frameCandidate.identity, 'plugin-removed')
    expect(removal.pickerRequests[0].signal.aborted).toBe(true)
    releaseRemoval?.({ ok: true, paths: ['/src/a.ts'] })
    await Promise.resolve()
    expect(selection(removalFrame, 'pick-remove')).toBeUndefined()
  })

  it('passes an id-less save intent to the owning document path', async () => {
    const context = await harness({ '/src/a.ts': 'a' })
    await open(context, '/src/a.ts')
    const frame = context.transport.frames[0]
    readyFrame(frame, PLUGIN_ORIGIN)
    frame.emit({ exo: 1, type: 'plugin/request-save' }, PLUGIN_ORIGIN)
    expect(context.saveRequests).toEqual(['/src/a.ts'])
    expect(
      frame.posted.some(
        (posted) => (posted.message as { type?: string }).type === 'shell/request-save',
      ),
    ).toBe(false)
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
