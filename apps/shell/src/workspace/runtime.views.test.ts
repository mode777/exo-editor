import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { FakeFrameTransport, type FakeFrame } from '../plugins/frame-test-support'
import type { PluginHost, PluginHostRecord, ViewLifecycle } from '../plugins/host'
import type { CommandEntry } from '../plugins/commands'
import { validateManifest, type PluginManifest } from '../plugins/manifest'
import type { RegisteredContentView, RegisteredPanel } from '../plugins/registration'
import { pluginViewId } from '../workbench/plugin-views'
import {
  clearWorkspaceTabs,
  configurePresetStore,
  contentViewOf,
  openFileTab,
} from '../workbench/tabs'

const ORIGIN_A = 'https://plugins.example.com'
const ORIGIN_B = 'https://other.example.com'
const IDENTITY_A = `${ORIGIN_A}::com.example.viewer`
const IDENTITY_B = `${ORIGIN_B}::com.example.other`

configurePresetStore()

function manifestFor(
  origin: string,
  id: string,
  kind: 'panel' | 'content',
  companionPanels?: string | string[],
): PluginManifest {
  const companions =
    companionPanels === undefined
      ? []
      : Array.isArray(companionPanels)
        ? companionPanels
        : [companionPanels]
  const companionLocation = (panelId: string) =>
    panelId === 'outline' ? 'primary' : panelId === 'inspection' ? 'bottom' : 'secondary'
  const result = validateManifest(
    {
      schemaVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read', 'events:subscribe'],
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
                {
                  id: 'inspection',
                  title: 'Inspection',
                  location: 'bottom',
                  entry: 'views/inspection.html',
                },
              ],
            }
          : {}),
        ...(kind === 'content'
          ? {
              ...(companions.length === 0
                ? {}
                : {
                    panels: companions.map((panelId) => ({
                      id: panelId,
                      title: panelId,
                      location: companionLocation(panelId),
                      entry: `views/${panelId}.html`,
                    })),
                  }),
              contentViews: [
                {
                  id: 'tutorial',
                  title: 'Tutorial',
                  entry: 'views/tutorial.html',
                  ...(companions.length === 0 ? {} : { companionPanels: companions }),
                },
              ],
            }
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
    newFiles: [],
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
    logCommand: vi.fn(),
    findCommand: vi.fn(),
    listCommands: vi.fn(() => []),
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

  it('shows, hides and toggles a bottom panel through request-panel', async () => {
    const record = recordFor(manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'), IDENTITY_A, 0)
    const { runtime, transport } = await createRuntime([record])
    const bottom = record.panels.find((panel) => panel.location === 'bottom')
    if (!bottom) throw new Error('Bottom panel fixture missing')
    const input = panelInput(record)
    runtime.views.attachPanelSurface(
      {
        ...input,
        panel: {
          ...input.panel,
          id: bottom.id,
          title: bottom.title,
          location: 'bottom',
          entryUrl: bottom.entryUrl,
        },
      },
      placeholder(),
    )
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_A)
    const viewId = pluginViewId(IDENTITY_A, bottom.id)
    useWorkbenchStore.setState({ bottomPanelVisible: false, activePanelView: 'problems' })

    send(frame, ORIGIN_A, 'plugin/request-panel', 'show', { panel: bottom.id, action: 'show' })
    await flush()
    expect(useWorkbenchStore.getState()).toMatchObject({
      bottomPanelVisible: true,
      activePanelView: viewId,
    })
    expect(posted(frame, 'shell/panel-result')?.payload).toMatchObject({
      panel: bottom.id,
      open: true,
    })

    useWorkbenchStore.setState({ bottomPanelVisible: true, activePanelView: 'other-panel' })
    send(frame, ORIGIN_A, 'plugin/request-panel', 'hide-other', {
      panel: bottom.id,
      action: 'hide',
    })
    await flush()
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(true)
    const hideResults = frame.posted
      .map((entry) => entry.message as { type?: string; payload?: unknown })
      .filter((message) => message.type === 'shell/panel-result')
    expect(hideResults.at(-1)?.payload).toMatchObject({
      panel: bottom.id,
      open: false,
    })

    useWorkbenchStore.setState({ bottomPanelVisible: true, activePanelView: viewId })
    send(frame, ORIGIN_A, 'plugin/request-panel', 'hide', { panel: bottom.id, action: 'hide' })
    await flush()
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(false)

    send(frame, ORIGIN_A, 'plugin/request-panel', 'toggle', { panel: bottom.id, action: 'toggle' })
    await flush()
    expect(useWorkbenchStore.getState()).toMatchObject({
      bottomPanelVisible: true,
      activePanelView: viewId,
    })
    runtime.dispose()
  })

  it('reveals a bottom panel for a command and delivers after the handshake', async () => {
    const record = recordFor(manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'), IDENTITY_A, 0)
    const { runtime, transport } = await createRuntime([record])
    const bottom = record.panels.find((panel) => panel.location === 'bottom')
    if (!bottom) throw new Error('Bottom panel fixture missing')
    const command: CommandEntry = {
      identity: IDENTITY_A,
      pluginId: 'com.example.viewer',
      pluginName: 'com.example.viewer',
      pluginVersion: '1.0.0',
      origin: ORIGIN_A,
      pluginOrder: 0,
      command: {
        id: 'inspect',
        title: 'Inspect',
        target: { kind: 'panel', id: bottom.id },
        menus: ['commandPalette'],
        registrationOrder: 0,
      },
    }
    vi.spyOn(runtime.pluginHost, 'findCommand').mockReturnValue(command)
    useWorkbenchStore.setState({ bottomPanelVisible: false, activePanelView: 'problems' })
    const invocation = runtime.commands.invoke(IDENTITY_A, 'inspect', 'palette')
    expect(useWorkbenchStore.getState()).toMatchObject({
      bottomPanelVisible: true,
      activePanelView: pluginViewId(IDENTITY_A, bottom.id),
    })

    const input = panelInput(record)
    runtime.views.attachPanelSurface(
      {
        ...input,
        panel: {
          ...input.panel,
          id: bottom.id,
          title: bottom.title,
          location: 'bottom',
          entryUrl: bottom.entryUrl,
        },
      },
      placeholder(),
    )
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_A)
    const delivered = (await vi.waitFor(() => {
      const message = posted(frame, 'shell/command')
      if (!message) throw new Error('Command not delivered')
      return message
    })) as { id?: string; payload?: unknown }
    expect(delivered.payload).toMatchObject({ command: 'inspect' })
    frame.emit(
      { exo: 1, type: 'plugin/command-result', replyTo: delivered.id, payload: { ok: true } },
      ORIGIN_A,
    )
    await expect(invocation).resolves.toEqual({ ok: true })
    runtime.dispose()
  })

  it('opens a cross-plugin content view with openedBy and reuses an instance key', async () => {
    const panelRecord = recordFor(
      manifestFor(ORIGIN_A, 'com.example.viewer', 'panel'),
      IDENTITY_A,
      0,
    )
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      1,
    )
    const { runtime, transport } = await createRuntime([panelRecord, contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })
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
      activeContentView: {
        pluginId: 'com.example.other',
        viewId: 'tutorial',
        instanceKey: 'chapter-2',
      },
    })
    expect(
      useWorkbenchStore
        .getState()
        .tabs.some((tab) => (tab as { contentView?: unknown }).contentView),
    ).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(
      pluginViewId(IDENTITY_B, 'inspector'),
    )

    useWorkbenchStore.setState({ secondarySideBarVisible: false })
    send(panelFrame, ORIGIN_A, 'plugin/open-view', 'view-2', {
      pluginId: 'com.example.other',
      viewId: 'tutorial',
      instanceKey: 'chapter-2',
    })
    await flush()
    expect(transport.frames).toHaveLength(2)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(
      pluginViewId(IDENTITY_B, 'inspector'),
    )
    runtime.dispose()
  })

  it('reveals a companion when a content view opens and hides it when the tab closes', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })
    const companion = pluginViewId(IDENTITY_B, 'inspector')

    runtime.openContentView(IDENTITY_B, 'tutorial')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(companion)

    const tab = useWorkbenchStore
      .getState()
      .tabs.find((entry) => (entry as { contentView?: unknown }).contentView)
    if (!tab) throw new Error('Content tab not found')
    useWorkbenchStore.getState().closeTab(tab.id)
    runtime.closeTabs([tab])
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.dispose()
  })

  it('reveals content-view companions in every region and hides them on a text tab', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', ['outline', 'inspector', 'inspection']),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({
      primarySideBarVisible: false,
      secondarySideBarVisible: false,
      bottomPanelVisible: false,
    })

    runtime.openContentView(IDENTITY_B, 'tutorial')
    const state = useWorkbenchStore.getState()
    expect(state.primarySideBarVisible).toBe(true)
    expect(state.activePrimaryView).toBe(pluginViewId(IDENTITY_B, 'outline'))
    expect(state.secondarySideBarVisible).toBe(true)
    expect(state.activeSecondaryView).toBe(pluginViewId(IDENTITY_B, 'inspector'))
    expect(state.bottomPanelVisible).toBe(true)
    expect(state.activePanelView).toBe(pluginViewId(IDENTITY_B, 'inspection'))

    openFileTab('/notes.txt')
    runtime.setActiveTab('/notes.txt')
    expect(useWorkbenchStore.getState().primarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(false)
    runtime.dispose()
  })

  it('skips an unregistered companion without blocking the content view', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    contentRecord.panels = []
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })

    runtime.openContentView(IDENTITY_B, 'tutorial')
    expect(
      useWorkbenchStore
        .getState()
        .tabs.some((tab) => (tab as { contentView?: unknown }).contentView),
    ).toBe(true)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe('chat')
    runtime.dispose()
  })

  it('keeps a shared companion open until the last content view closes', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })

    runtime.openContentView(IDENTITY_B, 'tutorial')
    runtime.openContentView(IDENTITY_B, 'tutorial')
    const tabs = useWorkbenchStore
      .getState()
      .tabs.filter((entry) => (entry as { contentView?: unknown }).contentView)
    expect(tabs).toHaveLength(2)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)

    useWorkbenchStore.getState().closeTab((tabs[0] as (typeof tabs)[number]).id)
    runtime.closeTabs([tabs[0] as (typeof tabs)[number]])
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    useWorkbenchStore.getState().closeTab((tabs[1] as (typeof tabs)[number]).id)
    runtime.closeTabs([tabs[1] as (typeof tabs)[number]])
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.dispose()
  })

  it('publishes view/active when the active content tab changes', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime, transport } = await createRuntime([contentRecord])
    runtime.openContentView(IDENTITY_B, 'tutorial')
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    ready(frame, ORIGIN_B)
    send(frame, ORIGIN_B, 'plugin/subscribe', 'sub', { topic: 'view/active' })
    await flush()
    const tab = useWorkbenchStore.getState().tabs.find((entry) => contentViewOf(entry))
    if (!tab) throw new Error('Content tab not found')
    const content = contentViewOf(tab)
    if (!content) throw new Error('Content view metadata missing')

    openFileTab('/notes.txt')
    runtime.setActiveTab('/notes.txt')
    await flush()
    expect(
      frame.posted
        .map((entry) => entry.message as { type?: string; payload?: unknown })
        .filter((message) => message.type === 'shell/event')
        .at(-1)?.payload,
    ).toMatchObject({
      topic: 'view/active',
      payload: { pluginId: 'com.example.other', active: false },
    })

    useWorkbenchStore.getState().activateTab(tab.id)
    runtime.setActiveTab(tab.id)
    await flush()
    expect(
      frame.posted
        .map((entry) => entry.message as { type?: string; payload?: unknown })
        .filter((message) => message.type === 'shell/event')
        .at(-1)?.payload,
    ).toMatchObject({
      topic: 'view/active',
      payload: {
        pluginId: 'com.example.other',
        active: true,
        viewId: 'tutorial',
        instanceId: content.key,
        instanceKey: content.instanceKey,
      },
    })
    runtime.dispose()
  })

  it('hides the companion when the active tab leaves its content view', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })
    const companion = pluginViewId(IDENTITY_B, 'inspector')

    runtime.openContentView(IDENTITY_B, 'tutorial')
    const tab = useWorkbenchStore.getState().tabs.find((entry) => contentViewOf(entry))
    if (!tab) throw new Error('Content tab not found')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(companion)

    openFileTab('/notes.txt')
    runtime.setActiveTab('/notes.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)

    useWorkbenchStore.getState().activateTab(tab.id)
    runtime.setActiveTab(tab.id)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(companion)
    runtime.dispose()
  })

  it('opens a content view normally when its companion is not registered', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    contentRecord.panels = []
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })

    runtime.openContentView(IDENTITY_B, 'tutorial')
    expect(useWorkbenchStore.getState().tabs).toHaveLength(1)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe('chat')
    runtime.dispose()
  })

  it('respects a manual companion hide until the view is focused again', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })
    const companion = pluginViewId(IDENTITY_B, 'inspector')

    runtime.openContentView(IDENTITY_B, 'tutorial')
    useWorkbenchStore.getState().toggleSecondarySideBar(companion)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.refreshExplorer()
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)

    const tab = useWorkbenchStore.getState().tabs.find((entry) => contentViewOf(entry))
    if (!tab) throw new Error('Content tab not found')
    runtime.setActiveTab('/notes.txt')
    runtime.setActiveTab(tab.id)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(companion)

    useWorkbenchStore.getState().closeTab(tab.id)
    runtime.closeTabs([tab])
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.dispose()
  })

  it('leaves a manually selected other panel open when the content view closes', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })

    runtime.openContentView(IDENTITY_B, 'tutorial')
    useWorkbenchStore.getState().showSecondaryView('other-panel')
    const tab = useWorkbenchStore
      .getState()
      .tabs.find((entry) => (entry as { contentView?: unknown }).contentView)
    if (!tab) throw new Error('Content tab not found')
    useWorkbenchStore.getState().closeTab(tab.id)
    runtime.closeTabs([tab])
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe('other-panel')
    runtime.dispose()
  })

  it('hides an orphaned companion on workspace switch', async () => {
    const contentRecord = recordFor(
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      0,
    )
    const { runtime } = await createRuntime([contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })

    runtime.openContentView(IDENTITY_B, 'tutorial')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    await runtime.disconnect()
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
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
      manifestFor(ORIGIN_B, 'com.example.other', 'content', 'inspector'),
      IDENTITY_B,
      1,
    )
    const { runtime, transport, stub } = await createRuntime([record, contentRecord])
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })
    runtime.openContentView(IDENTITY_B, 'tutorial')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    const frame = transport.frames[0]
    if (!frame) throw new Error('Frame not found')
    expect(
      useWorkbenchStore
        .getState()
        .tabs.some((tab) => (tab as { contentView?: unknown }).contentView),
    ).toBe(true)

    stub.lifecycle.value?.closeFor(IDENTITY_B, 'plugin-removed')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
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
