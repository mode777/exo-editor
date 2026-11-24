import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from '../workspace/runtime'
import { WorkspaceRuntimeProvider } from '../workspace/context'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import type { PluginHost, PluginHostRecord } from '../plugins/host'
import { validateManifest, type PluginManifest } from '../plugins/manifest'
import type { RegisteredContentView, RegisteredPanel } from '../plugins/registration'
import {
  clearWorkspaceTabs,
  configurePresetStore,
  contentViewOf,
  type ContentViewTabInfo,
} from '../workbench/tabs'
import { pluginViewId } from '../workbench/plugin-views'
import { DocumentArea } from './DocumentArea'
import { describeAxeViolations, runAxe } from '../test-a11y'

const ORIGIN = 'https://plugins.example.com'
const IDENTITY = `${ORIGIN}::com.example.other`

configurePresetStore()

function manifest(companionPanel?: string): PluginManifest {
  const result = validateManifest(
    {
      schemaVersion: 1,
      id: 'com.example.other',
      name: 'Other Plugin',
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read'],
      contributes: {
        fileEditors: [],
        ...(companionPanel === undefined
          ? {}
          : {
              panels: [
                {
                  id: companionPanel,
                  title: 'Inspector',
                  location: 'secondary',
                  entry: 'views/inspector.html',
                },
              ],
            }),
        contentViews: [
          {
            id: 'tutorial',
            title: 'Tutorial',
            entry: 'views/tutorial.html',
            ...(companionPanel === undefined ? {} : { companionPanel }),
          },
        ],
      },
    },
    `${ORIGIN}/other/exo-manifest.json`,
    '0.3.0',
  )
  if (!result.ok) throw new Error(`Invalid fixture: ${result.error.code}`)
  return result.manifest
}

function record(companionPanel?: string): PluginHostRecord {
  const value = manifest(companionPanel)
  return {
    manifestUrl: value.manifestUrl,
    entryIndex: 0,
    enabled: true,
    phase: 'active',
    identity: IDENTITY,
    manifest: value,
    fingerprint: 'v1:test',
    consent: 'granted',
    registrations: [],
    panels: value.panels.map<RegisteredPanel>((panel, order) => ({
      ...panel,
      registrationOrder: order,
    })),
    contentViews: value.contentViews.map<RegisteredContentView>((view, order) => ({
      ...view,
      registrationOrder: order,
    })),
    commands: [],
    newFiles: [],
  }
}

function host(recordValue: PluginHostRecord): PluginHost {
  const snapshot = {
    phase: 'ready' as const,
    records: [recordValue],
    consentRequest: null,
    log: [],
    revision: 1,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    match: () => [],
    attach: vi.fn(),
    detach: vi.fn(),
    dispose: vi.fn(),
    setHandlerLifecycle: vi.fn(),
    setViewLifecycle: vi.fn(),
    logHandler: vi.fn(),
    logView: vi.fn(),
  } as unknown as PluginHost
}

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

beforeEach(() => {
  clearWorkspaceTabs()
})

async function openContent(runtime: WorkspaceRuntime): Promise<ContentViewTabInfo> {
  runtime.openContentView(IDENTITY, 'tutorial')
  const tab = useWorkbenchStore.getState().tabs[0]
  if (!tab) throw new Error('No content tab opened')
  const info = (tab as { contentView?: ContentViewTabInfo }).contentView
  if (!info) throw new Error('No content view metadata')
  return info
}

describe('content view surface', () => {
  it('renders the view body and attaches the frame to its placeholder', async () => {
    const transport = new FakeFrameTransport()
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: host(record()),
      viewTransport: transport,
    })
    await runtime.openFolder()
    const info = await openContent(runtime)
    const tab = useWorkbenchStore.getState().tabs[0]
    if (!tab) throw new Error('No tab')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <DocumentArea tab={tab} />
        </WorkspaceRuntimeProvider>,
      ),
    )

    expect(container.querySelector('.exo-content-view-header')).toBeNull()
    const placeholder = container.querySelector('.exo-view-placeholder')
    expect(placeholder).not.toBeNull()
    expect(placeholder?.getAttribute('aria-label')).toBe('Tutorial — Other Plugin')
    expect(transport.frames).toHaveLength(1)
    expect(info.key).toBe(tab.id)
    const results = await runAxe(container)
    expect(describeAxeViolations(results)).toEqual([])
    runtime.dispose()
  })

  it('reveals the companion when the content tab becomes active', async () => {
    const transport = new FakeFrameTransport()
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: host(record('inspector')),
      viewTransport: transport,
    })
    await runtime.openFolder()
    useWorkbenchStore.setState({ secondarySideBarVisible: false, activeSecondaryView: 'chat' })
    await openContent(runtime)
    const companion = pluginViewId(IDENTITY, 'inspector')
    useWorkbenchStore.getState().toggleSecondarySideBar(companion)
    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(false)

    const tab = useWorkbenchStore.getState().tabs[0]
    if (!tab) throw new Error('No tab')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <DocumentArea tab={tab} />
        </WorkspaceRuntimeProvider>,
      ),
    )

    expect(useWorkbenchStore.getState().secondarySideBarVisible).toBe(true)
    expect(useWorkbenchStore.getState().activeSecondaryView).toBe(companion)
    expect(transport.frames).toHaveLength(1)
    runtime.dispose()
  })

  it('reattaches the active frame when switching between content-view tabs', async () => {
    const transport = new FakeFrameTransport()
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: host(record()),
      viewTransport: transport,
    })
    await runtime.openFolder()
    runtime.openContentView(IDENTITY, 'tutorial')
    runtime.openContentView(IDENTITY, 'tutorial')
    const tabs = useWorkbenchStore.getState().tabs
    const first = tabs[0]
    const second = tabs[1]
    if (!first || !second) throw new Error('Expected two content tabs')
    const firstKey = contentViewOf(first)?.key
    const secondKey = contentViewOf(second)?.key
    if (!firstKey || !secondKey) throw new Error('Expected two content views')

    const attach = vi.spyOn(runtime.views, 'attachContentSurface')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <DocumentArea tab={second} />
        </WorkspaceRuntimeProvider>,
      ),
    )
    expect(attach).toHaveBeenCalledWith(secondKey, expect.any(HTMLElement))

    attach.mockClear()
    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <DocumentArea tab={first} />
        </WorkspaceRuntimeProvider>,
      ),
    )
    expect(attach).toHaveBeenCalledWith(firstKey, expect.any(HTMLElement))
    runtime.dispose()
  })

  it('shows an unavailable state when the plugin is gone', async () => {
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: host(record()),
      viewTransport: new FakeFrameTransport(),
    })
    await runtime.openFolder()
    await openContent(runtime)
    const tab = useWorkbenchStore.getState().tabs[0]
    if (!tab) throw new Error('No tab')

    const gone = {
      ...record(),
      phase: 'disabled' as const,
      identity: undefined,
      manifest: undefined,
    }
    const goneSnapshot = {
      phase: 'ready' as const,
      records: [gone],
      consentRequest: null,
      log: [],
      revision: 2,
    }
    runtime.pluginHost.getSnapshot = () => goneSnapshot
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <DocumentArea tab={tab} />
        </WorkspaceRuntimeProvider>,
      ),
    )
    expect(container.textContent).toContain('no longer available')
    runtime.dispose()
  })
})
