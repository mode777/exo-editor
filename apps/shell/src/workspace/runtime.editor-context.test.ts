import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from './runtime'
import { MemoryWorkspaceProvider } from './providers/memory'
import { MemoryHandleStore } from './providers/folder/handle-store'
import type { DocumentState } from './documents'
import type { PluginHost, PluginHostRecord, ViewLifecycle } from '../plugins/host'
import { EventBus } from '../plugins/events'
import { HandlerPool } from '../plugins/handlers'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import { validateManifest } from '../plugins/manifest'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { pluginViewId } from '../workbench/plugin-views'

const ORIGIN_A = 'https://plugins.example.com'
const ORIGIN_B = 'https://other.example.com'
const IDENTITY_A = `${ORIGIN_A}::com.example.viewer`
const IDENTITY_B = `${ORIGIN_B}::com.example.other`

configurePresetStore()

function recordFor(origin: string, id: string): PluginHostRecord {
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
      contributes: { fileEditors: [] },
    },
    `${origin}/${id}/exo-manifest.json`,
    '0.10.0',
  )
  if (!result.ok) throw new Error(`Invalid fixture: ${result.error.code}`)
  return {
    manifestUrl: result.manifest.manifestUrl,
    entryIndex: 0,
    enabled: true,
    phase: 'active',
    identity: `${origin}::${id}`,
    manifest: result.manifest,
    fingerprint: 'v1:test',
    consent: 'granted',
    registrations: [],
    panels: [],
    contentViews: [],
    commands: [],
    newFiles: [],
  }
}

function recordWithPanels(origin: string, id: string, panelIds: string[]): PluginHostRecord {
  const record = recordFor(origin, id)
  record.panels = panelIds.map((panelId, order) => ({
    id: panelId,
    title: panelId,
    location: panelId === 'outline' ? 'primary' : panelId === 'inspection' ? 'bottom' : 'secondary',
    entry: `views/${panelId}.html`,
    entryUrl: `${origin}/${id}/views/${panelId}.html`,
    registrationOrder: order,
  }))
  return record
}

function hostStub(records: PluginHostRecord[]): PluginHost {
  const value = { phase: 'ready' as const, records, consentRequest: null, log: [], revision: 1 }
  return {
    getSnapshot: () => value,
    subscribe: () => () => undefined,
    match: () => [],
    attach: vi.fn(),
    detach: vi.fn(),
    dispose: vi.fn(),
    setHandlerLifecycle: vi.fn(),
    setViewLifecycle: vi.fn(),
    logHandler: vi.fn(),
    logView: vi.fn(),
    logCommand: vi.fn(),
    findCommand: vi.fn(),
    listCommands: vi.fn(() => []),
  } as unknown as PluginHost
}

function documentFor(path: string, overrides: Partial<DocumentState> = {}): DocumentState {
  return {
    path,
    title: path.slice(1),
    status: 'plugin',
    surface: 'plugin',
    text: '',
    savedText: '',
    version: 'v1',
    size: 1,
    dirty: false,
    readOnly: false,
    external: null,
    editor: {
      identity: IDENTITY_A,
      pluginId: 'com.example.viewer',
      pluginName: 'Viewer',
      label: 'Code',
      entryUrl: `${ORIGIN_A}/viewer/editor.html`,
      rendering: 'frame',
      companionPanels: ['outline', 'inspector', 'inspection'],
      canWrite: true,
    },
    pluginPhase: 'active',
    loadId: 1,
    ...overrides,
  }
}

function fileTab(path: string) {
  return { id: path, title: path.slice(1), kind: 'file' as const, path }
}

function handler(instanceId: string) {
  return { active: true, instanceId } as never
}

async function createRuntime() {
  const events = new EventBus()
  const handlerPool = new HandlerPool({
    transport: new FakeFrameTransport(),
    events,
    shellVersion: '0.10.0',
    shellOrigin: 'https://editor.example.com',
    createSessionId: () => 'handler-1',
  })
  const runtime = new WorkspaceRuntime({
    providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginHost: hostStub([
      recordWithPanels(ORIGIN_A, 'com.example.viewer', ['outline', 'inspector', 'inspection']),
      recordWithPanels(ORIGIN_B, 'com.example.other', ['inspector']),
    ]),
    handlerPool,
    viewTransport: new FakeFrameTransport(),
  })
  await runtime.openFolder()
  return runtime
}

interface PublishSpy {
  mock: { calls: Array<unknown[]> }
}

function editorEvents(publish: PublishSpy) {
  return publish.mock.calls
    .filter((call) => call[0] === 'editor/active')
    .map((call) => {
      const payload = call[1] as unknown
      const options = call[2] as { target?: string } | undefined
      return { payload, target: options?.target }
    })
}

beforeEach(() => {
  clearWorkspaceTabs()
  document.body.innerHTML = ''
})

describe('runtime active editor context', () => {
  it('publishes the active editor and follows same-plugin tab changes', async () => {
    const runtime = await createRuntime()
    const publish = vi.spyOn(runtime.events, 'publish')
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')

    useWorkbenchStore.setState({ tabs: [fileTab('/a.txt')], activeTabId: '/a.txt' })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')

    expect(editorEvents(publish).at(-1)).toEqual({
      payload: {
        pluginId: 'com.example.viewer',
        active: true,
        path: '/a.txt',
        instanceId: 'editor-1',
      },
      target: IDENTITY_A,
    })

    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt'), fileTab('/b.txt')],
      activeTabId: '/b.txt',
    })
    documents.mockImplementation((path) =>
      path === '/b.txt' ? documentFor('/b.txt') : documentFor('/a.txt'),
    )
    handlers.mockReturnValue(handler('editor-2'))
    runtime.setActiveTab('/b.txt')

    const events = editorEvents(publish)
    expect(events).toHaveLength(2)
    expect(events.at(-1)).toEqual({
      payload: {
        pluginId: 'com.example.viewer',
        active: true,
        path: '/b.txt',
        instanceId: 'editor-2',
      },
      target: IDENTITY_A,
    })
    runtime.dispose()
  })

  it('clears for a text file, a content view, another plugin and no tab', async () => {
    const runtime = await createRuntime()
    const publish = vi.spyOn(runtime.events, 'publish')
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')

    useWorkbenchStore.setState({ tabs: [fileTab('/a.txt')], activeTabId: '/a.txt' })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')

    documents.mockReturnValue(
      documentFor('/plain.md', { surface: 'text', editor: undefined, pluginPhase: undefined }),
    )
    useWorkbenchStore.setState({ tabs: [fileTab('/plain.md')], activeTabId: '/plain.md' })
    runtime.setActiveTab('/plain.md')
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: { pluginId: 'com.example.viewer', active: false },
      target: IDENTITY_A,
    })

    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-2'))
    useWorkbenchStore.setState({ tabs: [fileTab('/a.txt')], activeTabId: '/a.txt' })
    runtime.setActiveTab('/a.txt')

    useWorkbenchStore.setState({
      tabs: [{ id: 'content', title: 'Tutorial', kind: 'content' as never }],
      activeTabId: 'content',
    })
    runtime.setActiveTab('content')
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: { pluginId: 'com.example.viewer', active: false },
      target: IDENTITY_A,
    })

    documents.mockReturnValue(
      documentFor('/other.txt', {
        editor: {
          identity: IDENTITY_B,
          pluginId: 'com.example.other',
          pluginName: 'Other',
          label: 'Other',
          entryUrl: `${ORIGIN_B}/other/editor.html`,
          rendering: 'frame',
          canWrite: true,
        },
      }),
    )
    handlers.mockReturnValue(handler('editor-other'))
    useWorkbenchStore.setState({ tabs: [fileTab('/other.txt')], activeTabId: '/other.txt' })
    runtime.setActiveTab('/other.txt')
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: {
        pluginId: 'com.example.other',
        active: true,
        path: '/other.txt',
        instanceId: 'editor-other',
      },
      target: IDENTITY_B,
    })

    useWorkbenchStore.setState({ tabs: [], activeTabId: null })
    runtime.setActiveTab(null)
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: { pluginId: 'com.example.other', active: false },
      target: IDENTITY_B,
    })
    runtime.dispose()
  })

  it('updates the path on rename and the instance on remount', async () => {
    const runtime = await createRuntime()
    const publish = vi.spyOn(runtime.events, 'publish')
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')

    useWorkbenchStore.setState({ tabs: [fileTab('/a.txt')], activeTabId: '/a.txt' })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')

    vi.spyOn(runtime.documents, 'rename').mockImplementation(() => undefined)
    documents.mockImplementation((path) =>
      path === '/b.txt' ? documentFor('/b.txt') : documentFor('/a.txt'),
    )
    runtime.renameOpenPath('/a.txt', '/b.txt', {
      path: '/b.txt',
      kind: 'file',
      size: 1,
      mtime: 2,
      version: 'v2',
    })
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: {
        pluginId: 'com.example.viewer',
        active: true,
        path: '/b.txt',
        instanceId: 'editor-1',
      },
      target: IDENTITY_A,
    })

    handlers.mockReturnValue(handler('editor-2'))
    runtime.setActiveTab('/b.txt')
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: {
        pluginId: 'com.example.viewer',
        active: true,
        path: '/b.txt',
        instanceId: 'editor-2',
      },
      target: IDENTITY_A,
    })
    runtime.dispose()
  })

  it('does not advertise a mounting or inactive handler', async () => {
    const runtime = await createRuntime()
    const publish = vi.spyOn(runtime.events, 'publish')
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')

    useWorkbenchStore.setState({ tabs: [fileTab('/a.txt')], activeTabId: '/a.txt' })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')

    documents.mockReturnValue(documentFor('/a.txt', { pluginPhase: 'mounting' }))
    runtime.setActiveTab('/a.txt')
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: { pluginId: 'com.example.viewer', active: false },
      target: IDENTITY_A,
    })

    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue({ active: false, instanceId: 'editor-1' } as never)
    runtime.setActiveTab('/a.txt')
    expect(editorEvents(publish).at(-1)).toEqual({
      payload: { pluginId: 'com.example.viewer', active: false },
      target: IDENTITY_A,
    })
    runtime.dispose()
  })

  it('reveals editor companions in every region only after the handler is active', async () => {
    const runtime = await createRuntime()
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')
    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt')],
      activeTabId: '/a.txt',
      primarySideBarVisible: false,
      secondarySideBarVisible: false,
      bottomPanelVisible: false,
    })

    documents.mockReturnValue(documentFor('/a.txt', { pluginPhase: 'mounting' }))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().primarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(false)

    documents.mockReturnValue(documentFor('/a.txt'))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().primarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activePrimaryView).toBe(pluginViewId(IDENTITY_A, 'outline'))
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(
      pluginViewId(IDENTITY_A, 'inspector'),
    )
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(true)
    expect(useWorkbenchStore.getState().activePanelView).toBe(
      pluginViewId(IDENTITY_A, 'inspection'),
    )
    runtime.dispose()
  })

  it('hides editor companions when the handler clears or the tab is not the editor', async () => {
    const runtime = await createRuntime()
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')
    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt')],
      activeTabId: '/a.txt',
      secondarySideBarVisible: false,
      bottomPanelVisible: false,
    })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)

    documents.mockReturnValue(documentFor('/a.txt', { pluginPhase: 'failed' }))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(false)

    documents.mockReturnValue(
      documentFor('/plain.md', { surface: 'text', editor: undefined, pluginPhase: undefined }),
    )
    useWorkbenchStore.setState({ tabs: [fileTab('/plain.md')], activeTabId: '/plain.md' })
    runtime.setActiveTab('/plain.md')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.dispose()
  })

  it('keeps shared editor companions and diffs a different contribution', async () => {
    const runtime = await createRuntime()
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')
    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt')],
      activeTabId: '/a.txt',
      primarySideBarVisible: false,
      secondarySideBarVisible: false,
      bottomPanelVisible: false,
    })
    documents.mockImplementation((path) =>
      path === '/b.txt' ? documentFor('/b.txt') : documentFor('/a.txt'),
    )
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(true)

    useWorkbenchStore.setState({ tabs: [fileTab('/b.txt')], activeTabId: '/b.txt' })
    runtime.setActiveTab('/b.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(true)

    const editor = documentFor('/c.txt').editor
    if (!editor) throw new Error('Editor fixture missing')
    documents.mockReturnValue(
      documentFor('/c.txt', {
        editor: { ...editor, companionPanels: ['inspector'] },
      }),
    )
    useWorkbenchStore.setState({ tabs: [fileTab('/c.txt')], activeTabId: '/c.txt' })
    runtime.setActiveTab('/c.txt')
    expect(useWorkbenchStore.getState().primarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(false)
    runtime.dispose()
  })

  it('keeps a manual editor companion hide until refocus', async () => {
    const runtime = await createRuntime()
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')
    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt')],
      activeTabId: '/a.txt',
      secondarySideBarVisible: false,
    })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')
    useWorkbenchStore.getState().toggleSecondarySideBar(pluginViewId(IDENTITY_A, 'inspector'))
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)

    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)

    documents.mockReturnValue(
      documentFor('/plain.md', { surface: 'text', editor: undefined, pluginPhase: undefined }),
    )
    useWorkbenchStore.setState({ tabs: [fileTab('/plain.md')], activeTabId: '/plain.md' })
    runtime.setActiveTab('/plain.md')
    documents.mockReturnValue(documentFor('/a.txt'))
    useWorkbenchStore.setState({ tabs: [fileTab('/a.txt')], activeTabId: '/a.txt' })
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    runtime.dispose()
  })

  it('does not move focus when an editor companion reveals', async () => {
    const runtime = await createRuntime()
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()
    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt')],
      activeTabId: '/a.txt',
      secondarySideBarVisible: false,
    })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(document.activeElement).toBe(button)
    runtime.dispose()
  })

  it('hides editor companions on plugin removal and workspace switch', async () => {
    const runtime = await createRuntime()
    const documents = vi.spyOn(runtime.documents, 'get')
    const handlers = vi.spyOn(runtime.handlers, 'get')
    useWorkbenchStore.setState({
      tabs: [fileTab('/a.txt')],
      activeTabId: '/a.txt',
      secondarySideBarVisible: false,
      bottomPanelVisible: false,
    })
    documents.mockReturnValue(documentFor('/a.txt'))
    handlers.mockReturnValue(handler('editor-1'))
    runtime.setActiveTab('/a.txt')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)

    const lifecycle = (
      runtime.pluginHost.setViewLifecycle as unknown as {
        mock: { calls: Array<[ViewLifecycle]> }
      }
    ).mock.calls[0]?.[0]
    lifecycle?.closeFor(IDENTITY_A, 'plugin-removed')
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    expect(useWorkbenchStore.getState().bottomPanelVisible).toBe(false)

    await runtime.openFolder()
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)
    runtime.dispose()
  })
})
