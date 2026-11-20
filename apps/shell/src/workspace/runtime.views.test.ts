import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { FakeFrameTransport, type FakeFrame } from '../plugins/frame-test-support'
import type { PluginHost, PluginHostRecord, ViewLifecycle } from '../plugins/host'
import { validateManifest, type PluginManifest } from '../plugins/manifest'
import type { RegisteredContentView, RegisteredPanel } from '../plugins/registration'
import { pluginViewId } from '../workbench/plugin-views'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'

const ORIGIN_A = 'https://plugins.example.com'
const ORIGIN_B = 'https://other.example.com'
const IDENTITY_A = `${ORIGIN_A}::com.example.viewer`
const IDENTITY_B = `${ORIGIN_B}::com.example.other`

configurePresetStore()

function manifestFor(origin: string, id: string, kind: 'panel' | 'content'): PluginManifest {
  const result = validateManifest(
    {
      schemaVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read'],
      contributes: {
        fileEditors: [],
        ...(kind === 'panel'
          ? {
              panels: [
                {
                  id: 'outline',
                  title: 'Outline',
                  icon: 'list-tree',
                  location: 'primary',
                  entry: 'views/outline.html',
                },
                {
                  id: 'inspector',
                  title: 'Inspector',
                  location: 'secondary',
                  entry: 'views/inspector.html',
                },
              ],
            }
          : {}),
        ...(kind === 'content'
          ? { contentViews: [{ id: 'tutorial', title: 'Tutorial', entry: 'views/tutorial.html' }] }
          : {}),
      },
    },
    `${origin}/${id}/exo-manifest.json`,
    '0.3.0',
  )
  if (!result.ok) throw new Error(`Invalid fixture: ${result.error.code}`)
  return result.manifest
}

function recordFor(manifest: PluginManifest, identity: string, index: number): PluginHostRecord {
  return {
    manifestUrl: manifest.manifestUrl,
    entryIndex: index,
    enabled: true,
    phase: 'active',
    identity,
    manifest,
    fingerprint: 'v1:test',
    consent: 'granted',
    registrations: [],
    panels: manifest.panels.map<RegisteredPanel>((panel, order) => ({
      ...panel,
      registrationOrder: order,
    })),
    contentViews: manifest.contentViews.map<RegisteredContentView>((view, order) => ({
      ...view,
      registrationOrder: order,
    })),
    commands: [],
  }
}

function hostStub(records: PluginHostRecord[]) {
  let current = records
  const lifecycle: { value: ViewLifecycle | null } = { value: null }
  const host = {
    getSnapshot: () => ({
      phase: 'ready' as const,
      records: current,
      consentRequest: null,
      log: [],
      revision: 1,
    }),
    subscribe: () => () => undefined,
    match: () => [],
    attach: vi.fn(),
    detach: vi.fn(),
    dispose: vi.fn(),
    setHandlerLifecycle: vi.fn(),
    setViewLifecycle: vi.fn((next: ViewLifecycle) => {
      lifecycle.value = next
    }),
    logHandler: vi.fn(),
    logView: vi.fn(),
  }
  return {
    host: host as unknown as PluginHost,
    lifecycle,
    setRecords: (next: PluginHostRecord[]) => {
      current = next
    },
  }
}

function ready(frame: FakeFrame, origin: string) {
  const url = new URL(frame.options.url)
  const sessionId = new URLSearchParams(url.hash.slice(1)).get('exo-session') ?? ''
  frame.emit({ exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId } }, origin)
}

function send(frame: FakeFrame, origin: string, type: string, id: string, payload: unknown) {
  frame.emit({ exo: 1, type, id, payload }, origin)
}

function posted(frame: FakeFrame, type: string) {
  return frame.posted.find((entry) => (entry.message as { type?: string }).type === type)
    ?.message as { type: string; payload?: unknown; replyTo?: string } | undefined
}

function placeholder(): HTMLDivElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240 }) as DOMRect
  return element
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function createRuntime(records: PluginHostRecord[]) {
  const transport = new FakeFrameTransport()
  const stub = hostStub(records)
  const runtime = new WorkspaceRuntime({
    providerFactory: () =>
      new MemoryWorkspaceProvider({
        now: () => 1,
        initialFiles: { '/notes.txt': 'hello', '/second.txt': 'second' },
      }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginHost: stub.host,
    viewTransport: transport,
  })
  await runtime.openFolder()
  return { runtime, transport, stub }
}

function panelInput(record: PluginHostRecord) {
  if (!record.manifest || !record.identity) throw new Error('Fixture is incomplete')
  const panel = record.panels[0]
  if (!panel) throw new Error('Fixture has no panel')
  return {
    plugin: {
      identity: record.identity,
      pluginId: record.manifest.id,
      pluginName: record.manifest.name,
      pluginVersion: record.manifest.version,
      origin: record.manifest.manifestOrigin,
      permissions: record.manifest.permissions,
    },
    panel: {
      id: panel.id,
      title: panel.title,
      ...(panel.icon === undefined ? {} : { icon: panel.icon }),
      location: panel.location,
      entryUrl: panel.entryUrl,
    },
  }
}

beforeEach(() => {
  clearWorkspaceTabs()
  document.body.innerHTML = ''
})

describe('runtime view intents', () => {
  it('opens a workspace file from a visible panel frame', async () => {
    const record = recordFor(manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'), IDENTITY_A, 0)
    const { runtime, transport } = await createRuntime([record])
    runtime.views.attachPanelSurface(panelInput(record), placeholder())
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_A)
    send(frame, ORIGIN_A, 'plugin/open-file', 'open', { path: '/notes.txt' })
    await flush()
    expect(posted(frame, 'shell/open-result')).toMatchObject({ replyTo: 'open' })
    expect(useWorkbenchStore.getState().tabs.some((tab) => tab.path === '/notes.txt')).toBe(true)
    runtime.dispose()
  })

  it('opens a cross-plugin content view with openedBy and reuses an instance key', async () => {
    const panelRecord = recordFor(
      manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'),
      IDENTITY_A,
      0,
    )
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content'),
      IDENTITY_B,
      1,
    )
    const { runtime, transport } = await createRuntime([panelRecord, contentRecord])
    runtime.views.attachPanelSurface(panelInput(panelRecord), placeholder())
    const panelFrame = transport.frames[0]
    if (!panelFrame) throw new Error('Frame not found')
    ready(panelFrame, ORIGIN_A)
    send(panelFrame, ORIGIN_A, 'plugin/open-view', 'view-1', {
      pluginId: 'com.example.other',
      viewId: 'tutorial',
      instanceKey: 'chapter-2',
      payload: { chapter: 2 },
    })
    await flush()
    expect(posted(panelFrame, 'shell/open-result')).toMatchObject({ replyTo: 'view-1' })
    const contentFrame = transport.frames[1]
    if (!contentFrame) throw new Error('Content frame not found')
    ready(contentFrame, ORIGIN_B)
    expect(posted(contentFrame, 'shell/init')?.payload).toMatchObject({
      mode: 'view',
      view: {
        kind: 'content',
        id: 'tutorial',
        payload: { chapter: 2 },
        openedBy: {
          pluginId: 'com.example.viewer',
          pluginName: 'com.example.viewer',
          origin: ORIGIN_A,
        },
      },
    })
    expect(
      useWorkbenchStore
        .getState()
        .tabs.some((tab) => (tab as { contentView?: unknown }).contentView),
    ).toBe(true)

    send(panelFrame, ORIGIN_A, 'plugin/open-view', 'view-2', {
      pluginId: 'com.example.other',
      viewId: 'tutorial',
      instanceKey: 'chapter-2',
    })
    await flush()
    expect(transport.frames).toHaveLength(2)
    runtime.dispose()
  })

  it('shows and hides a secondary panel through request-panel', async () => {
    const record = recordFor(manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'), IDENTITY_A, 0)
    const { runtime, transport } = await createRuntime([record])
    runtime.views.attachPanelSurface(panelInput(record), placeholder())
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_A)

    const secondary = record.panels[1]
    if (!secondary) throw new Error('Fixture has no secondary panel')
    send(frame, ORIGIN_A, 'plugin/request-panel', 'show', {
      panel: secondary.id,
      action: 'show',
    })
    await flush()
    expect(posted(frame, 'shell/panel-result')).toMatchObject({
      replyTo: 'show',
      payload: { panel: 'inspector', open: true },
    })
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(
      pluginViewId(IDENTITY_A, 'inspector'),
    )

    send(frame, ORIGIN_A, 'plugin/request-panel', 'hide', {
      panel: secondary.id,
      action: 'hide',
    })
    await flush()
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.dispose()
  })

  it('rejects an unknown panel and caps content-view tabs', async () => {
    const record = recordFor(manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'), IDENTITY_A, 0)
    const { runtime, transport } = await createRuntime([record])
    runtime.views.attachPanelSurface(panelInput(record), placeholder())
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_A)

    send(frame, ORIGIN_A, 'plugin/request-panel', 'missing', {
      panel: 'missing',
      action: 'show',
    })
    await flush()
    const error = frame.posted
      .map((entry) => entry.message as { type?: string; replyTo?: string; payload?: unknown })
      .find((message) => message.type === 'shell/error' && message.replyTo === 'missing')
    expect(error?.payload).toMatchObject({ code: 'not-found' })
    runtime.dispose()
  })

  it('removes content tabs and frames when the host releases the plugin', async () => {
    const record = recordFor(manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'), IDENTITY_A, 0)
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content'),
      IDENTITY_B,
      1,
    )
    const { runtime, transport, stub } = await createRuntime([record, contentRecord])
    runtime.openContentView(IDENTITY_B, 'tutorial')
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    expect(
      useWorkbenchStore
        .getState()
        .tabs.some((tab) => (tab as { contentView?: unknown }).contentView),
    ).toBe(true)

    stub.lifecycle.value?.closeFor(IDENTITY_B, 'plugin-removed')
    expect(
      useWorkbenchStore
        .getState()
        .tabs.some((tab) => (tab as { contentView?: unknown }).contentView),
    ).toBe(false)
    expect(posted(frame, 'shell/dispose')).toMatchObject({
      payload: { reason: 'plugin-removed' },
    })
    runtime.dispose()
  })

  it('opens a content view from the palette with no payload', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content'),
      IDENTITY_B,
      0,
    )
    const { runtime, transport } = await createRuntime([contentRecord])
    runtime.openContentView(IDENTITY_B, 'tutorial')
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_B)
    expect(posted(frame, 'shell/init')?.payload).toMatchObject({
      mode: 'view',
      view: { kind: 'content', id: 'tutorial' },
    })
    expect(
      (posted(frame, 'shell/init')?.payload as { view: { payload?: unknown } }).view.payload,
    ).toBeUndefined()
    runtime.dispose()
  })
})
