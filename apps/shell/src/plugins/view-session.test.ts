import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import { FakeFrameTransport, type FakeFrame } from './frame-test-support'
import { EventBus } from './events'
import {
  MAX_VIEW_PAYLOAD_BYTES,
  type OpenFileIntent,
  type OpenViewIntent,
  type PanelIntent,
  type SessionFailure,
} from './frame-session'
import { ViewSession, type ViewSessionOptions } from './view-session'

const SHELL_ORIGIN = 'https://editor.example.com'
const PLUGIN_ORIGIN = 'https://plugins.example.com'
const IDENTITY = `${PLUGIN_ORIGIN}::com.example.viewer`

async function makeWorkspace(): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    initialFiles: {
      '/notes.txt': 'hello',
      '/src/a.txt': 'a',
      '/exo.json': '{}',
      '/.exo/state.json': '{"private":true}',
    },
  })
  const handle = await provider.open()
  return new Session(handle)
}

interface Started {
  transport: FakeFrameTransport
  frame: FakeFrame
  session: ViewSession
  failures: SessionFailure[]
  logs: Array<{ phase: string; code?: string }>
  openedFiles: OpenFileIntent[]
  openedViews: OpenViewIntent[]
  panels: PanelIntent[]
  visible: boolean
}

async function start(overrides: Partial<ViewSessionOptions> = {}): Promise<Started> {
  const transport = new FakeFrameTransport()
  const session = await makeWorkspace()
  const failures: SessionFailure[] = []
  const logs: Array<{ phase: string; code?: string }> = []
  const openedFiles: OpenFileIntent[] = []
  const openedViews: OpenViewIntent[] = []
  const panels: PanelIntent[] = []
  const state = { visible: true }
  const options: ViewSessionOptions = {
    plugin: {
      identity: IDENTITY,
      pluginId: 'com.example.viewer',
      pluginName: 'Viewer',
      pluginVersion: '1.0.0',
      origin: PLUGIN_ORIGIN,
      permissions: ['workspace:read', 'workspace:list', 'events:subscribe'],
    },
    entryUrl: `${PLUGIN_ORIGIN}/viewer/views/outline.html`,
    view: {
      kind: 'panel',
      id: 'outline',
      title: 'Outline',
      instanceId: 'panel-1',
      location: 'primary',
    },
    session,
    transport,
    shellVersion: '0.3.0',
    shellOrigin: SHELL_ORIGIN,
    workspaceName: 'demo',
    theme: 'dark',
    locale: 'en',
    events: new EventBus(),
    maxFileSize: 10 * 1024 * 1024,
    maxRequestBytes: 16 * 1024 * 1024,
    createSessionId: () => 'view-1',
    onRequestFiles: async () => ({ ok: true, paths: ['/notes.txt'] }),
    onOpenFile: async (request) => {
      openedFiles.push(request)
      return { ok: true }
    },
    onOpenView: async (request) => {
      openedViews.push(request)
      return { ok: true }
    },
    onRequestPanel: async (request) => {
      panels.push(request)
      return { ok: true, open: true }
    },
    isVisible: () => state.visible,
    onFailure: (failure) => failures.push(failure),
    onLog: (event) => logs.push(event),
    ...overrides,
  }
  const view = new ViewSession(options)
  view.start()
  const frame = transport.frames[0] as FakeFrame
  return {
    transport,
    frame,
    session: view,
    failures,
    logs,
    openedFiles,
    openedViews,
    panels,
    get visible() {
      return state.visible
    },
    set visible(value: boolean) {
      state.visible = value
    },
  } as Started
}

function ready(context: Started, options: { origin?: string; sessionId?: string } = {}) {
  context.frame.emit(
    {
      exo: 1,
      type: 'plugin/ready',
      payload: { protocolVersion: '1', sessionId: options.sessionId ?? 'view-1' },
    },
    options.origin ?? PLUGIN_ORIGIN,
  )
}

function send(context: Started, type: string, payload?: unknown, id = 'req-1') {
  context.frame.emit({ exo: 1, type, id, payload }, PLUGIN_ORIGIN)
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function postedReply(frame: FakeFrame, type: string, replyTo: string) {
  return frame.posted.find((entry) => {
    const message = entry.message as { type?: string; replyTo?: string }
    return message.type === type && message.replyTo === replyTo
  })?.message as { type: string; payload?: unknown; replyTo?: string } | undefined
}

function posted(frame: FakeFrame, type: string) {
  return frame.posted.find((entry) => (entry.message as { type?: string }).type === type)
    ?.message as { type: string; payload?: unknown; replyTo?: string; id?: string } | undefined
}

afterEach(() => {
  vi.useRealTimers()
})

describe('view session', () => {
  it('mounts with the view fragment and the cross-origin sandbox', async () => {
    const context = await start()
    const url = new URL(context.frame.options.url)
    expect(url.pathname).toBe('/viewer/views/outline.html')
    expect(url.hash).toContain('exo-mode=view')
    expect(url.hash).toContain('exo-session=view-1')
    expect(context.frame.options.sandbox).toBe('allow-scripts allow-same-origin')
    expect(context.transport.frames).toHaveLength(1)
  })

  it('uses the stricter sandbox for a same-origin plugin', async () => {
    const context = await start({
      entryUrl: `${SHELL_ORIGIN}/viewer/views/outline.html`,
      plugin: {
        identity: `${SHELL_ORIGIN}::com.example.viewer`,
        pluginId: 'com.example.viewer',
        pluginName: 'Viewer',
        pluginVersion: '1.0.0',
        origin: SHELL_ORIGIN,
        permissions: ['workspace:read'],
      },
    })
    expect(context.frame.options.sandbox).toBe('allow-scripts')
  })

  it('initializes with a view block, capabilities and no file metadata', async () => {
    const context = await start()
    ready(context)
    const init = posted(context.frame, 'shell/init')
    expect(init?.payload).toMatchObject({
      protocolVersion: '1',
      mode: 'view',
      sessionId: 'view-1',
      plugin: { id: 'com.example.viewer', version: '1.0.0' },
      shell: { version: '0.3.0', origin: SHELL_ORIGIN },
      workspace: { name: 'demo' },
      theme: 'dark',
      permissions: ['workspace:read', 'workspace:list', 'events:subscribe'],
      capabilities: {
        read: true,
        requestFiles: true,
        directoryListing: true,
        localEvents: true,
        openFile: true,
        openView: true,
        requestPanel: true,
      },
      view: {
        kind: 'panel',
        id: 'outline',
        title: 'Outline',
        instanceId: 'panel-1',
        location: 'primary',
      },
      activeContentView: null,
      activeEditor: null,
    })
    expect((init?.payload as { file?: unknown }).file).toBeUndefined()
    expect(context.session.active).toBe(true)
  })

  it('initializes with the active editor context and no file content', async () => {
    const context = await start({
      activeEditor: () => ({
        identity: IDENTITY,
        pluginId: 'com.example.viewer',
        path: '/src/a.txt',
        instanceId: 'session-a',
      }),
    })
    ready(context)
    const init = posted(context.frame, 'shell/init')
    expect(init?.payload).toMatchObject({
      activeEditor: {
        pluginId: 'com.example.viewer',
        path: '/src/a.txt',
        instanceId: 'session-a',
      },
    })
    const active = (init?.payload as { activeEditor?: Record<string, unknown> }).activeEditor
    expect(active).not.toHaveProperty('identity')
    expect(active).not.toHaveProperty('content')
    expect(active).not.toHaveProperty('bytes')
    expect(JSON.stringify(init?.payload)).not.toContain('hello')
  })

  it('ignores a ready from the wrong origin or session', async () => {
    const context = await start()
    ready(context, { origin: 'https://evil.example.com' })
    expect(posted(context.frame, 'shell/init')).toBeUndefined()
    ready(context, { sessionId: 'other' })
    expect(posted(context.frame, 'shell/init')).toBeUndefined()
    ready(context)
    expect(posted(context.frame, 'shell/init')).toBeDefined()
  })

  it('reads only absolute paths and returns text', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/request-file', { path: 'notes.txt', encoding: 'utf8' }, 'relative')
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'relative',
      payload: { code: 'permission-denied' },
    })
    send(context, 'plugin/request-file', { path: '/notes.txt', encoding: 'utf8' }, 'absolute')
    await flush()
    expect(posted(context.frame, 'shell/file-content')).toMatchObject({
      replyTo: 'absolute',
      payload: { path: '/notes.txt', text: 'hello' },
    })
  })

  it('lists absolute directories and rejects reserved or relative paths', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/request-list', { path: '/' }, 'root')
    await flush()
    expect(posted(context.frame, 'shell/list-result')).toMatchObject({ replyTo: 'root' })
    send(context, 'plugin/request-list', { path: 'src' }, 'relative')
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'relative',
      payload: { code: 'permission-denied' },
    })
    send(context, 'plugin/request-list', { path: '/.exo' }, 'reserved')
    expect(postedReply(context.frame, 'shell/error', 'reserved')).toMatchObject({
      replyTo: 'reserved',
      payload: { code: 'permission-denied' },
    })
  })

  it('opens the shell picker and returns selected paths', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/request-files', { multiple: true }, 'pick')
    await flush()
    expect(posted(context.frame, 'shell/files-selected')).toMatchObject({
      replyTo: 'pick',
      payload: { paths: ['/notes.txt'] },
    })
  })

  it('subscribes and publishes local events under the view identity', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/subscribe', { topic: 'local/state' }, 'sub')
    expect(posted(context.frame, 'shell/subscribed')).toMatchObject({
      replyTo: 'sub',
      payload: { topic: 'local/state', seq: 0 },
    })
    send(context, 'plugin/publish', { topic: 'local/state', payload: { value: 1 } }, 'pub')
    await flush()
    expect(posted(context.frame, 'shell/published')).toMatchObject({
      replyTo: 'pub',
      payload: { topic: 'local/state', seq: 1 },
    })
    expect(posted(context.frame, 'shell/event')).toMatchObject({
      payload: { topic: 'local/state', from: 'view-1', payload: { value: 1 } },
    })
  })

  it('treats editor-only messages as protocol violations', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/dirty', { dirty: true }, 'dirty')
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'dirty',
      payload: { code: 'protocol-violation' },
    })
    send(context, 'plugin/request-save', undefined, 'save')
    expect(
      context.frame.posted.filter(
        (entry) => (entry.message as { type?: string }).type === 'shell/error',
      ),
    ).toHaveLength(2)
  })

  it('opens files through the intent with read and visibility gates', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/open-file', { path: '/notes.txt' }, 'open')
    await flush()
    expect(context.openedFiles).toEqual([{ id: 'open', path: '/notes.txt' }])
    expect(posted(context.frame, 'shell/open-result')).toMatchObject({ replyTo: 'open' })

    send(context, 'plugin/open-file', { path: 'notes.txt' }, 'relative')
    await flush()
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'relative',
      payload: { code: 'permission-denied' },
    })

    send(context, 'plugin/open-file', { path: '/exo.json' }, 'reserved')
    await flush()
    expect(context.openedFiles).toHaveLength(1)

    context.visible = false
    send(context, 'plugin/open-file', { path: '/notes.txt' }, 'hidden')
    await flush()
    expect(postedReply(context.frame, 'shell/error', 'hidden')).toMatchObject({
      replyTo: 'hidden',
      payload: { code: 'permission-denied' },
    })
  })

  it('rejects open-file without workspace:read', async () => {
    const context = await start({
      entryUrl: `${SHELL_ORIGIN}/viewer/views/outline.html`,
      plugin: {
        identity: IDENTITY,
        pluginId: 'com.example.viewer',
        pluginName: 'Viewer',
        pluginVersion: '1.0.0',
        origin: PLUGIN_ORIGIN,
        permissions: [],
      },
    })
    ready(context)
    send(context, 'plugin/open-file', { path: '/notes.txt' }, 'open')
    await flush()
    expect(context.openedFiles).toEqual([])
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'open',
      payload: { code: 'permission-denied' },
    })
  })

  it('opens a view and rejects an oversized payload', async () => {
    const context = await start()
    ready(context)
    send(
      context,
      'plugin/open-view',
      { pluginId: 'com.example.other', viewId: 'tutorial', instanceKey: 'k1', payload: { a: 1 } },
      'view',
    )
    await flush()
    expect(context.openedViews).toEqual([
      {
        id: 'view',
        pluginId: 'com.example.other',
        viewId: 'tutorial',
        instanceKey: 'k1',
        payload: { a: 1 },
      },
    ])
    expect(posted(context.frame, 'shell/open-result')).toMatchObject({ replyTo: 'view' })

    send(
      context,
      'plugin/open-view',
      { viewId: 'tutorial', payload: 'x'.repeat(MAX_VIEW_PAYLOAD_BYTES) },
      'big',
    )
    await flush()
    expect(context.openedViews).toHaveLength(1)
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'big',
      payload: { code: 'too-large' },
    })
  })

  it('requests a panel and returns its resulting state', async () => {
    const context = await start()
    ready(context)
    send(context, 'plugin/request-panel', { panel: 'outline', action: 'show' }, 'panel')
    await flush()
    expect(context.panels).toEqual([{ id: 'panel', panel: 'outline', action: 'show' }])
    expect(posted(context.frame, 'shell/panel-result')).toMatchObject({
      replyTo: 'panel',
      payload: { panel: 'outline', open: true },
    })
  })

  it('rejects the eleventh intent in one rolling second', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const context = await start()
    ready(context)
    for (let index = 0; index < 11; index += 1) {
      context.frame.emit(
        {
          exo: 1,
          type: 'plugin/open-file',
          id: `intent-${index}`,
          payload: { path: '/notes.txt' },
        },
        PLUGIN_ORIGIN,
      )
    }
    await flush()
    expect(context.openedFiles).toHaveLength(10)
    expect(posted(context.frame, 'shell/error')).toMatchObject({
      replyTo: 'intent-10',
      payload: { code: 'rate-limited' },
    })
    now.mockRestore()
  })

  it('disposes with an acknowledgement and drops late messages', async () => {
    const context = await start()
    ready(context)
    const disposing = context.session.dispose('closed')
    expect(posted(context.frame, 'shell/dispose')).toMatchObject({
      payload: { reason: 'closed' },
    })
    send(context, 'plugin/dispose-ack', {}, 'ack')
    await disposing
    expect(context.frame.closed).toBe(true)
    expect(context.session.active).toBe(false)
    send(context, 'plugin/request-file', { path: '/notes.txt', encoding: 'utf8' }, 'late')
    expect(posted(context.frame, 'shell/file-content')).toBeUndefined()
  })

  it('fails a frame that never becomes ready', async () => {
    vi.useFakeTimers()
    const context = await start()
    vi.advanceTimersByTime(10_000)
    expect(context.failures[0]).toMatchObject({ code: 'timeout', phase: 'ready' })
    expect(context.frame.closed).toBe(true)
  })
})
