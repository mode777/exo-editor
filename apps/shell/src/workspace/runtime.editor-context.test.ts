import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from './runtime'
import { MemoryWorkspaceProvider } from './providers/memory'
import { MemoryHandleStore } from './providers/folder/handle-store'
import type { DocumentState } from './documents'
import type { PluginHost, PluginHostRecord } from '../plugins/host'
import { EventBus } from '../plugins/events'
import { HandlerPool } from '../plugins/handlers'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import { validateManifest } from '../plugins/manifest'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'

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
      recordFor(ORIGIN_A, 'com.example.viewer'),
      recordFor(ORIGIN_B, 'com.example.other'),
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
})
