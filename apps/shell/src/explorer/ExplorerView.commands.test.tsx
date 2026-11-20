import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRuntime } from '../workspace/runtime'
import { WorkspaceRuntimeProvider } from '../workspace/context'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import type { PluginHost, PluginHostRecord } from '../plugins/host'
import type { RegisteredCommand, RegisteredNewFile } from '../plugins/registration'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { ExplorerView } from './ExplorerView'
import { describeAxeViolations, runAxe } from '../test-a11y'

configurePresetStore()

const IDENTITY = 'https://plugins.example.com::com.example.test'

function command(overrides: Partial<RegisteredCommand> = {}): RegisteredCommand {
  return {
    id: 'generate',
    title: 'Generate Report',
    target: { kind: 'panel', id: 'reports' },
    menus: ['commandPalette', 'explorer/context'],
    registrationOrder: 0,
    ...overrides,
  }
}

function record(
  commands: RegisteredCommand[],
  newFiles: RegisteredNewFile[] = [],
): PluginHostRecord {
  return {
    manifestUrl: 'https://plugins.example.com/test/exo-manifest.json',
    entryIndex: 0,
    enabled: true,
    phase: 'active',
    identity: IDENTITY,
    consent: 'granted',
    registrations: [],
    panels: [],
    contentViews: [],
    commands,
    newFiles,
    manifest: {
      schemaVersion: 1,
      manifestUrl: 'https://plugins.example.com/test/exo-manifest.json',
      manifestOrigin: 'https://plugins.example.com',
      controllerUrl: 'https://plugins.example.com/test/plugin.html',
      pluginRoot: '/test/',
      id: 'com.example.test',
      name: 'Example Plugin',
      version: '1.0.0',
      publisher: { name: 'Example' },
      engines: { exo: '*' },
      permissions: ['workspace:read'],
      fileEditors: [],
      panels: [],
      contentViews: [],
      commands,
      newFiles,
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

async function render(commands: RegisteredCommand[], newFiles: RegisteredNewFile[] = []) {
  const runtime = new WorkspaceRuntime({
    providerFactory: () =>
      new MemoryWorkspaceProvider({
        now: () => 1,
        initialFiles: { '/notes.txt': 'hello', '/reports/a.txt': 'a' },
        initialDirectories: ['/reports'],
      }),
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginHost: host([record(commands, newFiles)]),
  })
  await runtime.openFolder()
  const invoke = vi.spyOn(runtime.commands, 'invoke').mockResolvedValue({ ok: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () =>
    root?.render(
      <WorkspaceRuntimeProvider runtime={runtime}>
        <ExplorerView />
      </WorkspaceRuntimeProvider>,
    ),
  )
  await vi.waitFor(() => expect(container?.textContent).toContain('notes.txt'))
  return { runtime, container, invoke }
}

function row(container: HTMLElement, name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
    (element) => element.textContent?.includes(name),
  )
  if (!found) throw new Error(`Row ${name} not found`)
  return found
}

async function openMenu(container: HTMLElement, name: string): Promise<HTMLElement> {
  await act(async () => {
    row(container, name).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }),
    )
  })
  const menu = container.querySelector<HTMLElement>('[role="menu"]')
  if (!menu) throw new Error('Context menu not found')
  return menu
}

function menuItems(menu: HTMLElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
}

describe('explorer plugin commands', () => {
  it('lists explorer commands with plugin attribution and sends file arguments', async () => {
    const { container: rendered, invoke } = await render([command()])
    const menu = await openMenu(rendered, 'notes.txt')
    const item = menuItems(menu).find((entry) => entry.textContent?.includes('Generate Report'))
    expect(item?.textContent).toContain('Example Plugin')
    expect(item?.title).toContain('Example Plugin')
    await act(async () => item?.click())
    expect(invoke).toHaveBeenCalledWith(IDENTITY, 'generate', 'explorer', {
      path: '/notes.txt',
      kind: 'file',
    })
    expect(rendered.querySelector('[role="menu"]')).toBeNull()
  })

  it('passes an axe scan with the plugin menu open', async () => {
    const { container: rendered } = await render([command()])
    await openMenu(rendered, 'notes.txt')
    expect(describeAxeViolations(await runAxe(rendered))).toEqual([])
  })

  it('sends directory arguments and closes on Escape', async () => {
    const { container: rendered, invoke } = await render([command()])
    const menu = await openMenu(rendered, 'reports')
    const item = menuItems(menu).find((entry) => entry.textContent?.includes('Generate Report'))
    await act(async () => item?.click())
    expect(invoke).toHaveBeenCalledWith(IDENTITY, 'generate', 'explorer', {
      path: '/reports',
      kind: 'directory',
    })

    const second = await openMenu(rendered, 'notes.txt')
    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(rendered.querySelector('[role="menu"]')).toBeNull()
  })

  it('omits non-explorer commands and caps plugin entries at ten', async () => {
    const commands = [
      command({ id: 'palette-only', title: 'Palette Only', menus: ['commandPalette'] }),
      ...Array.from({ length: 12 }, (_, index) =>
        command({
          id: `explorer-${index}`,
          title: `Explorer ${index}`,
          registrationOrder: index + 1,
        }),
      ),
    ]
    const { container: rendered } = await render(commands)
    const menu = await openMenu(rendered, 'notes.txt')
    const pluginItems = menuItems(menu).filter((item) =>
      item.textContent?.includes('Example Plugin'),
    )
    expect(pluginItems).toHaveLength(10)
    expect(menu.textContent).not.toContain('Palette Only')
    expect(menu.querySelector('[role="separator"]')).not.toBeNull()
  })
})

describe('explorer new-file templates', () => {
  const templates: RegisteredNewFile[] = [
    {
      id: 'component',
      label: 'Component',
      fileName: 'Component.tsx',
      encoding: 'utf8',
      bytes: new TextEncoder().encode('export {}'),
      text: 'export {}',
      registrationOrder: 0,
    },
  ]

  it('lists Empty File and each template grouped by plugin name', async () => {
    const { container, runtime } = await render([], templates)
    const newFile = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('aria-label') === 'New File',
    )
    await act(async () => {
      newFile?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    const menu = container.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('Empty File')
    expect(menu?.textContent).toContain('Example Plugin')
    expect(menu?.textContent).toContain('Component')
    expect(menu?.textContent).toContain('Component.tsx')

    const templateButton = Array.from(menu?.querySelectorAll('button') ?? []).find((element) =>
      element.textContent?.includes('Component'),
    )
    await act(async () => {
      templateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(runtime.newFiles.getSnapshot()).toMatchObject({
      kind: 'template',
      pluginName: 'Example Plugin',
      name: 'Component.tsx',
      directory: '/',
    })
    runtime.newFiles.cancel()
  })
})

describe('explorer refresh after creation', () => {
  it('shows a file created outside a React event handler', async () => {
    const template: RegisteredNewFile = {
      id: 'component',
      label: 'Component',
      fileName: 'Component.tsx',
      encoding: 'utf8',
      bytes: new TextEncoder().encode('export {}'),
      text: 'export {}',
      registrationOrder: 0,
    }
    const { runtime, container } = await render([], [template])
    const session = runtime.getSession()
    if (!session) throw new Error('No session')
    const before = runtime.getSnapshot().explorerRevision
    runtime.newFiles.beginTemplate({
      kind: 'template',
      templateId: template.id,
      fileName: template.fileName,
      identity: IDENTITY,
      pluginId: 'com.example.test',
      pluginName: 'Example Plugin',
      content: { bytes: template.bytes, text: template.text },
      fallbackDirectory: '/',
      directory: '/',
      session,
    })
    await runtime.newFiles.submit('/', 'Component.tsx')
    expect(runtime.getSnapshot().explorerRevision).toBeGreaterThan(before)
    await vi.waitFor(
      () =>
        expect(
          Array.from(container.querySelectorAll('.exo-tree-row')).some((row) =>
            row.textContent?.includes('Component.tsx'),
          ),
        ).toBe(true),
      { timeout: 5000 },
    )
  })
})
