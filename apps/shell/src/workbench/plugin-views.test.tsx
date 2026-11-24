import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { validateManifest, type PluginManifest } from '../plugins/manifest'
import type { PluginHost, PluginHostRecord, PluginHostSnapshot } from '../plugins/host'
import type { RegisteredContentView, RegisteredPanel } from '../plugins/registration'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { WorkspaceRuntime } from '../workspace/runtime'
import { WorkspaceRuntimeProvider } from '../workspace/context'
import { FakeFrameTransport, type FakeFrame } from '../plugins/frame-test-support'
import { describeAxeViolations, runAxe } from '../test-a11y'
import { configurePresetStore } from './tabs'
import { derivePluginWorkbench, pluginViewId } from './plugin-views'

configurePresetStore()

let container: HTMLDivElement | null = null
let root: Root | null = null
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

function mockLayout(): void {
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
      right: 300,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
  document.body.innerHTML = ''
})

const IDENTITY = 'https://plugins.example.com::com.example.viewer'

function manifest(): PluginManifest {
  const result = validateManifest(
    {
      schemaVersion: 1,
      id: 'com.example.viewer',
      name: 'Viewer',
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read'],
      contributes: {
        fileEditors: [],
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
          {
            id: 'validation',
            title: 'Validation',
            location: 'bottom',
            entry: 'views/validation.html',
          },
        ],
        contentViews: [{ id: 'tutorial', title: 'Tutorial', entry: 'views/tutorial.html' }],
      },
    },
    'https://plugins.example.com/viewer/exo-manifest.json',
    '0.3.0',
  )
  if (!result.ok) throw new Error(`Invalid fixture: ${result.error.code}`)
  return result.manifest
}

function record(active = true): PluginHostRecord {
  const value = manifest()
  return {
    manifestUrl: value.manifestUrl,
    entryIndex: 0,
    enabled: true,
    phase: active ? 'active' : 'disabled',
    ...(active ? { identity: IDENTITY } : {}),
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

function snapshot(records: PluginHostRecord[]): PluginHostSnapshot {
  return { phase: 'ready', records, consentRequest: null, log: [], revision: 1 }
}

function hostStub(records: PluginHostRecord[]): PluginHost {
  const value = snapshot(records)
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
  } as unknown as PluginHost
}

function ready(frame: FakeFrame, origin = 'https://plugins.example.com'): void {
  const url = new URL(frame.options.url)
  const sessionId = new URLSearchParams(url.hash.slice(1)).get('exo-session') ?? ''
  frame.emit({ exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId } }, origin)
}

describe('derived plugin workbench', () => {
  it('adds primary panels after the explorer and enables the secondary region', () => {
    const derived = derivePluginWorkbench(snapshot([record()]))
    const primaryId = pluginViewId(IDENTITY, 'outline')
    const secondaryId = pluginViewId(IDENTITY, 'inspector')
    const inspectionId = pluginViewId(IDENTITY, 'inspection')
    const validationId = pluginViewId(IDENTITY, 'validation')

    expect(derived.config.activityBar.items.map((item) => item.id)).toEqual(['explorer', primaryId])
    expect(derived.config.activityBar.items[1]).toMatchObject({
      title: 'Outline — Viewer',
      icon: 'list-tree',
    })
    expect(derived.config.primarySideBar.views).toEqual(['explorer', primaryId])
    expect(derived.config.secondarySideBar).toMatchObject({
      enabled: true,
      views: [secondaryId],
    })
    expect(derived.config.bottomPanel).toMatchObject({
      enabled: true,
      views: [inspectionId, validationId],
    })
    expect(derived.views.primary[primaryId]).toMatchObject({
      title: 'Outline — Viewer',
      icon: 'list-tree',
    })
    expect(derived.views.secondary[secondaryId]?.actions).toEqual([
      { icon: 'list-selection', label: 'Select View', commandId: 'exo.views.selectSecondary' },
    ])
    expect(derived.views.panel[inspectionId]).toMatchObject({
      title: 'Inspection — Viewer',
      icon: 'window',
    })
    expect(derived.views.panel[validationId]).toMatchObject({
      title: 'Validation — Viewer',
      icon: 'window',
    })
    expect(derived.views.secondary[inspectionId]).toBeUndefined()
    expect(derived.views.primary[inspectionId]).toBeUndefined()
  })

  it('keeps the shell composition when no panel is active', () => {
    const derived = derivePluginWorkbench(snapshot([record(false)]))
    expect(derived.config.activityBar.items.map((item) => item.id)).toEqual(['explorer'])
    expect(derived.config.primarySideBar.views).toEqual(['explorer'])
    expect(derived.config.secondarySideBar.enabled).toBe(false)
    expect(derived.config.bottomPanel.enabled).toBe(false)
    expect(derived.config.bottomPanel.views).toEqual([])
    expect(derived.views.secondary).toEqual({})
    expect(derived.views.panel).toEqual({})
  })

  it('uses the default icon for a panel without one', () => {
    const derived = derivePluginWorkbench(snapshot([record()]))
    const secondaryId = pluginViewId(IDENTITY, 'inspector')
    expect(derived.views.secondary[secondaryId]?.icon).toBe('window')
  })

  it('mounts only the active bottom tab and retains frames across tab switches', async () => {
    const transport = new FakeFrameTransport()
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: hostStub([record()]),
      viewTransport: transport,
    })
    await runtime.openFolder()
    const derived = derivePluginWorkbench(snapshot([record()]))
    const inspectionId = pluginViewId(IDENTITY, 'inspection')
    const validationId = pluginViewId(IDENTITY, 'validation')
    const Inspection = derived.views.panel[inspectionId]?.component
    const Validation = derived.views.panel[validationId]?.component
    if (!Inspection || !Validation) throw new Error('Bottom panel fixture missing')
    useWorkbenchStore.setState({ activePanelView: inspectionId, bottomPanelVisible: true })
    mockLayout()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <Inspection />
          <Validation />
        </WorkspaceRuntimeProvider>,
      ),
    )
    expect(container.querySelectorAll('.exo-view-placeholder')).toHaveLength(1)
    const placeholder = container.querySelector('.exo-view-placeholder')
    expect(placeholder?.getAttribute('aria-label')).toBe('Inspection — Viewer')
    expect(transport.frames).toHaveLength(1)
    const firstFrame = transport.frames[0]
    if (!firstFrame) throw new Error('First bottom frame missing')
    await act(async () => ready(firstFrame))
    expect(firstFrame.surfaceShown).toBe(true)
    const results = await runAxe(container)
    expect(describeAxeViolations(results)).toEqual([])

    await act(async () => useWorkbenchStore.setState({ activePanelView: validationId }))
    expect(container.querySelectorAll('.exo-view-placeholder')).toHaveLength(1)
    expect(transport.frames).toHaveLength(2)
    const secondFrame = transport.frames[1]
    if (!secondFrame) throw new Error('Second bottom frame missing')
    await act(async () => ready(secondFrame))
    expect(firstFrame.surfaceShown).toBe(false)
    expect(secondFrame.surfaceShown).toBe(true)

    await act(async () => useWorkbenchStore.setState({ activePanelView: inspectionId }))
    expect(transport.frames).toHaveLength(2)
    expect(firstFrame.surfaceShown).toBe(true)
    expect(secondFrame.surfaceShown).toBe(false)
    await runtime.dispose()
  })

  it('falls back to the first bottom tab when the active view is unknown', async () => {
    const transport = new FakeFrameTransport()
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: hostStub([record()]),
      viewTransport: transport,
    })
    await runtime.openFolder()
    const derived = derivePluginWorkbench(snapshot([record()]))
    const inspectionId = pluginViewId(IDENTITY, 'inspection')
    const validationId = pluginViewId(IDENTITY, 'validation')
    const Inspection = derived.views.panel[inspectionId]?.component
    const Validation = derived.views.panel[validationId]?.component
    if (!Inspection || !Validation) throw new Error('Bottom panel fixture missing')
    useWorkbenchStore.setState({ activePanelView: 'problems', bottomPanelVisible: true })
    mockLayout()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () =>
      root?.render(
        <WorkspaceRuntimeProvider runtime={runtime}>
          <Inspection />
          <Validation />
        </WorkspaceRuntimeProvider>,
      ),
    )
    expect(container.querySelectorAll('.exo-view-placeholder')).toHaveLength(1)
    expect(transport.frames).toHaveLength(1)
    const frame = transport.frames[0]
    if (!frame) throw new Error('Bottom frame missing')
    await act(async () => ready(frame))
    expect(frame.surfaceShown).toBe(true)
    await runtime.dispose()
  })
})
