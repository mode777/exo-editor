import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchTab } from 'vscode-workbench'
import { WorkspaceRuntime } from '../workspace/runtime'
import { WorkspaceRuntimeProvider } from '../workspace/context'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import type { PluginHost, PluginHostRecord } from '../plugins/host'
import type { DocumentState } from '../workspace/documents'
import type { RegisteredCommand } from '../plugins/registration'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { DocumentArea } from './DocumentArea'
import { describeAxeViolations, runAxe } from '../test-a11y'

configurePresetStore()

const IDENTITY = 'https://plugins.example.com::com.example.test'
const OTHER = 'https://other.example.com::com.example.other'

function command(overrides: Partial<RegisteredCommand> = {}): RegisteredCommand {
  return {
    id: 'format',
    title: 'Format Document',
    target: 'activeEditor',
    menus: ['commandPalette', 'editor/title'],
    registrationOrder: 0,
    ...overrides,
  }
}

function record(identity: string, name: string, commands: RegisteredCommand[]): PluginHostRecord {
  return {
    manifestUrl: `https://plugins.example.com/${name}/exo-manifest.json`,
    entryIndex: identity === IDENTITY ? 0 : 1,
    enabled: true,
    phase: 'active',
    identity,
    consent: 'granted',
    registrations: [],
    panels: [],
    contentViews: [],
    commands,
    newFiles: [],
    manifest: {
      schemaVersion: 1,
      manifestUrl: 'https://plugins.example.com/test/exo-manifest.json',
      manifestOrigin: 'https://plugins.example.com',
      controllerUrl: 'https://plugins.example.com/test/plugin.html',
      pluginRoot: '/test/',
      id: 'com.example.test',
      name,
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      permissions: ['workspace:read'],
      fileEditors: [],
      panels: [],
      contentViews: [],
      commands,
      newFiles: [],
    },
  }
}

function host(records: PluginHostRecord[]): PluginHost {
  const snapshot = {
    phase: 'ready' as const,
    records,
    consentRequest: null,
    log: [],
    revision: 1,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    listCommands: () => [],
    findCommand: () => undefined,
    logCommand: vi.fn(),
    logHandler: vi.fn(),
    logView: vi.fn(),
    setHandlerLifecycle: vi.fn(),
    setViewLifecycle: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    dispose: vi.fn(),
    match: () => [],
  } as unknown as PluginHost
}

function documentState(identity: string): DocumentState {
  return {
    path: '/notes.txt',
    title: 'notes.txt',
    status: 'ready',
    surface: 'plugin',
    pluginPhase: 'active',
    editor: {
      identity,
      pluginName: 'Example Plugin',
      pluginId: 'com.example.test',
      label: 'Example Editor',
      entryUrl: 'https://plugins.example.com/test/editor.html',
      rendering: 'hidden',
      canWrite: true,
    },
    dirty: false,
    text: 'hello',
    savedText: 'hello',
    loadId: 1,
    size: 5,
    version: '1',
    readOnly: false,
    external: null,
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  clearWorkspaceTabs()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

async function render(
  records: PluginHostRecord[],
  identity: string,
): Promise<{
  runtime: WorkspaceRuntime
  container: HTMLDivElement
  invoke: ReturnType<typeof vi.spyOn>
}> {
  const runtime = new WorkspaceRuntime({
    providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1, initialFiles: {} }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginHost: host(records),
  })
  const state = documentState(identity)
  runtime.documents.get = () => state
  runtime.documents.subscribe = () => () => undefined
  runtime.documents.open = vi.fn(async () => undefined)
  const invoke = vi.spyOn(runtime.commands, 'invoke').mockResolvedValue({ ok: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const tab: WorkbenchTab = {
    id: 'tab-1',
    title: 'notes.txt',
    kind: 'file',
    path: '/notes.txt',
  }
  await act(async () =>
    root?.render(
      <WorkspaceRuntimeProvider runtime={runtime}>
        <DocumentArea tab={tab} />
      </WorkspaceRuntimeProvider>,
    ),
  )
  return { runtime, container, invoke }
}

describe('document command actions', () => {
  it('renders editor-title actions only for the matching plugin, attributed by name', async () => {
    const { container: rendered, invoke } = await render(
      [
        record(IDENTITY, 'Example Plugin', [
          command(),
          command({ id: 'palette-only', title: 'Palette Only', menus: ['commandPalette'] }),
        ]),
        record(OTHER, 'Other Plugin', [command({ id: 'other-format', title: 'Other Format' })]),
      ],
      IDENTITY,
    )
    const toolbar = rendered.querySelector('[role="toolbar"]')
    expect(toolbar?.getAttribute('aria-label')).toBe('Actions from Example Plugin')
    const buttons = Array.from(rendered.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons.map((button) => button.textContent)).toEqual(['Format Document'])
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Format Document (Example Plugin)')
    await act(async () => buttons[0]?.click())
    expect(invoke).toHaveBeenCalledWith(IDENTITY, 'format', 'editorTitle')
    expect(describeAxeViolations(await runAxe(rendered))).toEqual([])
  })

  it('shows no toolbar when the active document belongs to another plugin', async () => {
    const { container: rendered } = await render(
      [record(IDENTITY, 'Example Plugin', [command()])],
      OTHER,
    )
    expect(rendered.querySelector('[role="toolbar"]')).toBeNull()
    expect(rendered.textContent).not.toContain('Format Document')
  })
})
