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
import type { RegisteredContentView } from '../plugins/registration'
import {
  clearWorkspaceTabs,
  configurePresetStore,
  type ContentViewTabInfo,
} from '../workbench/tabs'
import { DocumentArea } from './DocumentArea'
import { describeAxeViolations, runAxe } from '../test-a11y'

const ORIGIN = 'https://plugins.example.com'
const IDENTITY = `${ORIGIN}::com.example.other`

configurePresetStore()

function manifest(): PluginManifest {
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
        contentViews: [{ id: 'tutorial', title: 'Tutorial', entry: 'views/tutorial.html' }],
      },
    },
    `${ORIGIN}/other/exo-manifest.json`,
    '0.3.0',
  )
  if (!result.ok) throw new Error(`Invalid fixture: ${result.error.code}`)
  return result.manifest
}

function record(): PluginHostRecord {
  const value = manifest()
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
    panels: [],
    contentViews: value.contentViews.map<RegisteredContentView>((view, order) => ({
      ...view,
      registrationOrder: order,
    })),
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
  it('renders shell chrome and attaches the frame to its placeholder', async () => {
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

    expect(container.textContent).toContain('Tutorial')
    expect(container.textContent).toContain('Other Plugin')
    const placeholder = container.querySelector('.exo-view-placeholder')
    expect(placeholder).not.toBeNull()
    expect(placeholder?.getAttribute('aria-label')).toBe('Tutorial — Other Plugin')
    expect(transport.frames).toHaveLength(1)
    expect(info.key).toBe(tab.id)
    const results = await runAxe(container)
    expect(describeAxeViolations(results)).toEqual([])
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
