import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import { FakeFrameTransport, type FakeFrame } from './frame-test-support'
import { EventBus } from './events'
import {
  MAX_CONTENT_VIEW_TABS,
  ViewPool,
  type PanelViewInput,
  type ViewPluginInfo,
} from './view-pool'
import type { ActiveEditor } from './view-session'

const SHELL_ORIGIN = 'https://editor.example.com'
const PLUGIN_ORIGIN = 'https://plugins.example.com'
const IDENTITY = `${PLUGIN_ORIGIN}::com.example.viewer`

async function makeWorkspace(): Promise<WorkspaceSession> {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    initialFiles: { '/notes.txt': 'hello' },
  })
  const handle = await provider.open()
  return new Session(handle)
}

function plugin(): ViewPluginInfo {
  return {
    identity: IDENTITY,
    pluginId: 'com.example.viewer',
    pluginName: 'Viewer',
    pluginVersion: '1.0.0',
    origin: PLUGIN_ORIGIN,
    permissions: ['workspace:read', 'events:subscribe'],
  }
}

function panelInput(): PanelViewInput {
  return {
    plugin: plugin(),
    panel: {
      id: 'outline',
      title: 'Outline',
      icon: 'list-tree',
      location: 'primary',
      entryUrl: `${PLUGIN_ORIGIN}/viewer/views/outline.html`,
    },
  }
}

function sessionIdOf(frame: FakeFrame): string {
  const url = new URL(frame.options.url)
  const params = new URLSearchParams(url.hash.slice(1))
  return params.get('exo-session') ?? ''
}

function ready(frame: FakeFrame, origin = PLUGIN_ORIGIN, sessionId = sessionIdOf(frame)) {
  frame.emit({ exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId } }, origin)
}

function posted(frame: FakeFrame, type: string) {
  return frame.posted.find((entry) => (entry.message as { type?: string }).type === type)?.message
}

function placeholder(): HTMLDivElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  element.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 300, height: 200, right: 310, bottom: 220 }) as DOMRect
  return element
}

let sessionCounter = 0

async function createPool(
  overrides: {
    events?: EventBus
    activeEditor?: () => ActiveEditor | null
  } = {},
) {
  const transport = new FakeFrameTransport()
  const workspace = await makeWorkspace()
  const logs: Array<{ phase: string; code?: string }> = []
  const pool = new ViewPool({
    transport,
    shellVersion: '0.3.0',
    shellOrigin: SHELL_ORIGIN,
    locale: 'en',
    events: overrides.events ?? new EventBus(),
    createSessionId: () => `view-${++sessionCounter}`,
    onRequestFiles: async () => ({ ok: true, paths: [] }),
    onOpenFile: async () => ({ ok: true }),
    onOpenView: async () => ({ ok: true }),
    onRequestPanel: async () => ({ ok: true, open: true }),
  })
  pool.attach({
    session: workspace,
    host: {
      logView: (_identity, phase, code) => logs.push({ phase, ...(code ? { code } : {}) }),
    },
    workspaceName: 'demo',
    ...(overrides.activeEditor === undefined ? {} : { activeEditor: overrides.activeEditor }),
  })
  return { pool, transport, workspace, logs }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  sessionCounter = 0
})

describe('view pool', () => {
  it('waits for a panel that mounts after the wait starts', async () => {
    const { pool, transport } = await createPool()
    const input = panelInput()
    const waiting = pool.waitForPanel(IDENTITY, 'outline', 1000)
    const element = placeholder()
    pool.attachPanelSurface(input, element)
    const frame = transport.frames[0] as FakeFrame
    ready(frame)
    const session = await waiting
    expect(session).toBe(pool.panelSession(IDENTITY, 'outline'))
    expect(session?.active).toBe(true)
  })

  it('mounts a panel only on first reveal and retains it when hidden', async () => {
    const { pool, transport } = await createPool()
    const input = panelInput()
    pool.attachPanelSurface(input, null)
    expect(transport.frames).toHaveLength(0)

    const element = placeholder()
    pool.attachPanelSurface(input, element)
    expect(transport.frames).toHaveLength(1)
    const frame = transport.frames[0] as FakeFrame
    ready(frame)
    expect(pool.getSnapshot()).toMatchObject([
      { kind: 'panel', viewId: 'outline', phase: 'active', visible: true },
    ])
    expect(frame.surfaceShown).toBe(true)
    expect(frame.surfaceBounds).toEqual({ left: 10, top: 20, width: 300, height: 200 })

    pool.attachPanelSurface(input, null)
    expect(posted(frame, 'shell/dispose')).toBeUndefined()
    expect(frame.surfaceShown).toBe(false)

    pool.attachPanelSurface(input, placeholder())
    expect(transport.frames).toHaveLength(1)
    expect(frame.surfaceShown).toBe(true)
  })

  it('mounts a bottom panel with its location and retains it', async () => {
    const { pool, transport } = await createPool()
    const input = panelInput()
    input.panel.location = 'bottom'
    pool.attachPanelSurface(input, placeholder())
    expect(transport.frames).toHaveLength(1)
    const frame = transport.frames[0] as FakeFrame
    ready(frame)
    const init = posted(frame, 'shell/init') as { payload?: unknown } | undefined
    expect(init?.payload).toMatchObject({
      mode: 'view',
      view: { kind: 'panel', id: 'outline', location: 'bottom' },
    })
    expect(pool.getSnapshot()).toMatchObject([
      { kind: 'panel', viewId: 'outline', location: 'bottom', phase: 'active', visible: true },
    ])

    pool.attachPanelSurface(input, null)
    expect(posted(frame, 'shell/dispose')).toBeUndefined()
    expect(frame.surfaceShown).toBe(false)

    pool.attachPanelSurface(input, placeholder())
    expect(transport.frames).toHaveLength(1)
    expect(frame.surfaceShown).toBe(true)
  })

  it('exposes activeEditor only to a view of the same identity', async () => {
    const active: ActiveEditor = {
      identity: IDENTITY,
      pluginId: 'com.example.viewer',
      path: '/notes.txt',
      instanceId: 'editor-1',
    }
    const { pool, transport } = await createPool({ activeEditor: () => active })
    const input = panelInput()
    pool.attachPanelSurface(input, placeholder())
    const matching = transport.frames[0] as FakeFrame
    ready(matching)
    expect(posted(matching, 'shell/init')).toMatchObject({
      payload: {
        activeEditor: {
          pluginId: 'com.example.viewer',
          path: '/notes.txt',
          instanceId: 'editor-1',
        },
      },
    })

    const other = panelInput()
    other.plugin = {
      ...other.plugin,
      identity: 'https://other.example.com::com.example.viewer',
      origin: 'https://other.example.com',
    }
    other.panel = { ...other.panel, id: 'other-outline' }
    pool.attachPanelSurface(other, placeholder())
    const different = transport.frames[1] as FakeFrame
    ready(different, 'https://other.example.com')
    expect(posted(different, 'shell/init')).toMatchObject({ payload: { activeEditor: null } })
  })

  it('opens, deduplicates and closes content-view tabs with frames', async () => {
    const { pool, transport } = await createPool()
    const input = {
      plugin: plugin(),
      view: {
        id: 'tutorial',
        title: 'Tutorial',
        entryUrl: `${PLUGIN_ORIGIN}/viewer/views/tutorial.html`,
      },
      instanceKey: 'k1',
      payload: { chapter: 2 },
    }
    const first = pool.openContent(input)
    expect(first).toMatchObject({ ok: true, existing: false })
    const frame = transport.frames[0] as FakeFrame
    ready(frame)
    const key = first.ok ? first.key : ''
    expect(pool.contentSession(key)?.view).toMatchObject({
      kind: 'content',
      id: 'tutorial',
      payload: { chapter: 2 },
    })

    const second = pool.openContent(input)
    expect(second).toMatchObject({ ok: true, existing: true })
    expect(transport.frames).toHaveLength(1)

    const third = pool.openContent({ ...input, instanceKey: 'k2' })
    expect(third).toMatchObject({ ok: true, existing: false })
    expect(transport.frames).toHaveLength(2)

    pool.closeContent(key)
    expect(posted(frame, 'shell/dispose')).toMatchObject({ payload: { reason: 'closed' } })
    frame.emit({ exo: 1, type: 'plugin/dispose-ack' }, PLUGIN_ORIGIN)
    expect(frame.closed).toBe(true)
    expect(pool.contentSession(key)).toBeUndefined()
  })

  it('preserves declared companion panels on the content handle', async () => {
    const { pool } = await createPool()
    const opened = pool.openContent({
      plugin: plugin(),
      view: {
        id: 'asset-preview',
        title: 'Asset Preview',
        entryUrl: `${PLUGIN_ORIGIN}/viewer/views/preview.html`,
        companionPanels: ['outline', 'asset-params', 'inspection'],
      },
      instanceKey: 'first',
    })
    if (!opened.ok) throw new Error('Content view did not open')
    expect(pool.handle(IDENTITY, 'content', 'asset-preview', 'first')).toMatchObject({
      companionPanels: ['outline', 'asset-params', 'inspection'],
    })
  })

  it('caps content-view tabs per plugin', async () => {
    const { pool } = await createPool()
    const view = {
      id: 'tutorial',
      title: 'Tutorial',
      entryUrl: `${PLUGIN_ORIGIN}/viewer/views/tutorial.html`,
    }
    for (let index = 0; index < MAX_CONTENT_VIEW_TABS; index += 1) {
      expect(pool.openContent({ plugin: plugin(), view, instanceKey: `k${index}` }).ok).toBe(true)
    }
    const over = pool.openContent({ plugin: plugin(), view, instanceKey: 'over' })
    expect(over).toMatchObject({ ok: false, code: 'rate-limited' })
  })

  it('disposes every frame of a stopped plugin', async () => {
    const { pool, transport } = await createPool()
    const element = placeholder()
    pool.attachPanelSurface(panelInput(), element)
    const panelFrame = transport.frames[0] as FakeFrame
    ready(panelFrame)
    const content = pool.openContent({
      plugin: plugin(),
      view: {
        id: 'tutorial',
        title: 'Tutorial',
        entryUrl: `${PLUGIN_ORIGIN}/viewer/views/tutorial.html`,
      },
      instanceKey: 'k1',
    })
    expect(content.ok).toBe(true)

    pool.closeFor(IDENTITY, 'plugin-removed')
    expect(pool.getSnapshot()).toEqual([])
    expect(posted(panelFrame, 'shell/dispose')).toMatchObject({
      payload: { reason: 'plugin-removed' },
    })
  })

  it('disposes all frames on detach', async () => {
    const { pool, transport } = await createPool()
    pool.attachPanelSurface(panelInput(), placeholder())
    const frame = transport.frames[0] as FakeFrame
    ready(frame)
    await pool.detach()
    expect(posted(frame, 'shell/dispose')).toMatchObject({
      payload: { reason: 'workspace-switch' },
    })
    expect(pool.getSnapshot()).toEqual([])
  })

  it('reports a failed panel and retries with a new frame', async () => {
    vi.useFakeTimers()
    const { pool, transport } = await createPool()
    pool.attachPanelSurface(panelInput(), placeholder())
    expect(transport.frames).toHaveLength(1)
    vi.advanceTimersByTime(10_000)
    expect(pool.getSnapshot()[0]).toMatchObject({
      phase: 'failed',
      error: { code: 'timeout' },
    })
    pool.retry(pool.getSnapshot()[0]?.key ?? '')
    expect(transport.frames).toHaveLength(2)
  })

  it('serves config/changed to a subscribed view frame', async () => {
    const events = new EventBus()
    const { pool, transport } = await createPool({ events })
    pool.attachPanelSurface(panelInput(), placeholder())
    const frame = transport.frames[0] as FakeFrame
    ready(frame)
    frame.emit(
      { exo: 1, type: 'plugin/subscribe', id: 'sub', payload: { topic: 'config/changed' } },
      PLUGIN_ORIGIN,
    )
    expect(pool.updateSettings(IDENTITY, { greeting: 'hi' })).toBe(true)
    events.flush()
    expect(posted(frame, 'shell/event')).toMatchObject({
      payload: { topic: 'config/changed', payload: { pluginId: 'com.example.viewer' } },
    })
  })
})
