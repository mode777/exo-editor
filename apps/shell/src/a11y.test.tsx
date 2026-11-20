import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { FilePickerDialog } from './document/FilePickerDialog'
import { ClosePromptDialog } from './components/ClosePromptDialog'
import { ConsentDialog, type ConsentRequestView } from './plugins/ConsentDialog'
import type { PluginManifest } from './plugins/manifest'
import { PluginLog } from './settings/PluginSettings'
import type { PluginLogEntry } from './plugins/host'
import { ConnectRemoteDialog } from './workspace/ConnectRemoteDialog'
import { WorkspaceRuntimeProvider } from './workspace/context'
import { WorkspaceRuntime } from './workspace/runtime'
import { MemoryWorkspaceProvider } from './workspace/providers/memory'
import { MemoryHandleStore } from './workspace/providers/folder/handle-store'
import { MemoryConnectionStore } from './workspace/providers/stratofold/connection-store'
import { configurePresetStore, clearWorkspaceTabs } from './workbench/tabs'
import { describeAxeViolations, runAxe } from './test-a11y'

const SHELL_ORIGIN = 'https://editor.example.com'
let roots: Root[] = []
let containers: HTMLElement[] = []

function track(root: Root, container: HTMLElement) {
  roots.push(root)
  containers.push(container)
  return container
}

async function renderNode(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(node))
  return track(root, container)
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function doubleClick(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
}

async function mountWorkspace(
  files: Record<string, string> = { '/a.txt': 'one' },
  options: { writable?: boolean } = {},
) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: files,
    writable: options.writable ?? true,
  })
  const runtime = new WorkspaceRuntime({
    providerFactory: () => provider,
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    connectionStore: new MemoryConnectionStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  await runtime.start()
  await runtime.openFolder()

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  track(root, container)
  return { container, runtime }
}

function manifest(): PluginManifest {
  return {
    schemaVersion: 1,
    manifestUrl: 'https://plugins.example.com/monaco/exo-manifest.json',
    manifestOrigin: 'https://plugins.example.com',
    controllerUrl: 'https://plugins.example.com/monaco/plugin.html',
    pluginRoot: '/monaco/',
    id: 'com.example.monaco',
    name: 'Monaco Code Editor',
    version: '1.2.0',
    publisher: { name: 'Example Corp' },
    engines: { exo: '^0.1.0' },
    permissions: ['workspace:read', 'workspace:write'],
    fileEditors: [
      {
        glob: '**/*.ts',
        entry: 'editors/code.html',
        entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
        label: 'Code',
        priority: 10,
      },
    ],
    panels: [],
    contentViews: [],
  }
}

function consentRequest(): ConsentRequestView {
  return {
    identity: 'https://plugins.example.com::com.example.monaco',
    manifest: manifest(),
    fingerprint: 'v1:abc',
  }
}

async function expectNoViolations(surface: Element | null) {
  expect(surface).not.toBeNull()
  const results = await runAxe(surface as Element)
  expect(describeAxeViolations(results)).toEqual([])
}

beforeEach(() => {
  localStorage.clear()
  configurePresetStore()
  clearWorkspaceTabs()
})

afterEach(async () => {
  for (const root of roots) {
    await act(async () => root.unmount())
  }
  for (const container of containers) container.remove()
  roots = []
  containers = []
  document.body.innerHTML = ''
})

describe('Exo-owned surface accessibility', () => {
  it('explorer and document area have no WCAG A/AA violations', async () => {
    const { container } = await mountWorkspace({ '/a.txt': 'one' })

    await vi.waitFor(() =>
      expect(container.querySelector('.exo-tree-row')?.textContent).toContain('a.txt'),
    )
    await expectNoViolations(container.querySelector('.exo-explorer'))

    doubleClick(
      Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).find((element) =>
        element.textContent?.includes('a.txt'),
      ) ?? null,
    )
    await vi.waitFor(() => expect(container.querySelector('textarea')?.value).toBe('one'))
    await expectNoViolations(container.querySelector('.exo-document'))
  })

  it('explorer exposes tree semantics with one tab stop', async () => {
    const { container } = await mountWorkspace({ '/a.txt': 'one', '/dir/b.txt': 'two' })
    await vi.waitFor(() =>
      expect(
        Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).some((row) =>
          row.textContent?.includes('a.txt'),
        ),
      ).toBe(true),
    )

    const tree = container.querySelector('[role="tree"][aria-label="Workspace files"]')
    expect(tree).not.toBeNull()
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row'))
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((row) => row.getAttribute('role') === 'treeitem')).toBe(true)
    expect(rows.every((row) => row.getAttribute('aria-level') !== null)).toBe(true)
    expect(rows.filter((row) => row.tabIndex === 0)).toHaveLength(1)

    const directory = rows.find((row) => row.textContent?.includes('dir'))
    expect(directory?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => click(directory ?? null))
    await vi.waitFor(() =>
      expect(
        Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).some((row) =>
          row.textContent?.includes('b.txt'),
        ),
      ).toBe(true),
    )
    expect(directory?.getAttribute('aria-expanded')).toBe('true')
    const child = Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).find((row) =>
      row.textContent?.includes('b.txt'),
    )
    expect(child?.getAttribute('aria-level')).toBe('2')
    expect(
      Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).filter(
        (row) => row.tabIndex === 0,
      ),
    ).toHaveLength(1)
  })

  it('explorer header exposes named controls and the root toggle state', async () => {
    const { container } = await mountWorkspace({ '/dir/b.txt': 'two' })
    await vi.waitFor(() => expect(container.querySelector('.exo-explorer-header')).not.toBeNull())
    const header = container.querySelector('.exo-explorer-header')
    for (const label of [
      'New File',
      'New Folder',
      'Refresh Explorer',
      'Collapse Folders in Explorer',
    ]) {
      expect(header?.querySelector(`[aria-label="${label}"]`), label).not.toBeNull()
    }
    const twisty = header?.querySelector<HTMLButtonElement>('.exo-explorer-twisty')
    expect(twisty?.getAttribute('aria-expanded')).toBe('true')
    await expectNoViolations(header)
    await act(async () => click(twisty ?? null))
    expect(twisty?.getAttribute('aria-expanded')).toBe('false')
  })

  it('announces the read-only state once', async () => {
    const { container } = await mountWorkspace({ '/a.txt': 'one' }, { writable: false })
    await vi.waitFor(() =>
      expect(container.querySelector('.exo-tree-row')?.textContent).toContain('a.txt'),
    )
    expect(container.querySelector<HTMLButtonElement>('[aria-label="New File"]')?.disabled).toBe(
      true,
    )
    expect(container.querySelector<HTMLButtonElement>('[aria-label="New Folder"]')?.disabled).toBe(
      true,
    )
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh Explorer"]')?.disabled,
    ).toBe(false)
    const announcements = Array.from(container.querySelectorAll('[role="status"]')).filter(
      (element) => element.textContent?.includes('Read-only workspace'),
    )
    expect(announcements).toHaveLength(1)
  })

  it('settings dialog has no WCAG A/AA violations', async () => {
    const { container } = await mountWorkspace()
    await act(async () => useWorkbenchStore.getState().setQuickOpen(true, 'commands'))
    const palette = document.querySelector('[role="dialog"][aria-label="Command palette"]')
    await vi.waitFor(() =>
      expect(
        Array.from(palette?.querySelectorAll('button') ?? []).find((element) =>
          element.textContent?.includes('Open Settings'),
        ),
      ).toBeDefined(),
    )
    await act(async () =>
      click(
        Array.from(palette?.querySelectorAll('button') ?? []).find((element) =>
          element.textContent?.includes('Open Settings'),
        ) ?? null,
      ),
    )

    const dialog = document.querySelector('[role="dialog"][aria-labelledby="exo-settings-title"]')
    await vi.waitFor(() => expect(dialog).not.toBeNull())
    await expectNoViolations(dialog)
    expect(container.querySelector('.exo-explorer')).not.toBeNull()
  })

  it('file picker has no WCAG A/AA violations', async () => {
    const { runtime } = await mountWorkspace({ '/a.txt': 'one', '/dir/b.txt': 'two' })
    const session = runtime.getSession()
    if (!session) throw new Error('No workspace session')
    const container = await renderNode(
      <FilePickerDialog
        request={{
          path: '/a.txt',
          pluginId: 'com.example.code',
          pluginName: 'Code Plugin',
          multiple: false,
          session,
        }}
        onCancel={() => undefined}
        onSelect={() => undefined}
      />,
    )
    await vi.waitFor(() => expect(container.querySelector('[data-picker-row]')).not.toBeNull())
    await expectNoViolations(container.querySelector('[role="dialog"]'))
  })

  it('consent dialog has no WCAG A/AA violations', async () => {
    const container = await renderNode(
      <ConsentDialog
        request={consentRequest()}
        shellOrigin={SHELL_ORIGIN}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    )
    await expectNoViolations(container.querySelector('[role="dialog"]'))
  })

  it('close prompt has no WCAG A/AA violations', async () => {
    const container = await renderNode(
      <ClosePromptDialog
        paths={['/a.txt']}
        error={null}
        onSave={vi.fn()}
        onDiscard={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    await expectNoViolations(container.querySelector('[role="dialog"]'))
  })

  it('remote connect dialog has no WCAG A/AA violations', async () => {
    const runtime = new WorkspaceRuntime({
      providerFactory: () => new MemoryWorkspaceProvider({ now: () => 1 }),
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      connectionStore: new MemoryConnectionStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
    })
    await runtime.start()
    const container = await renderNode(
      <WorkspaceRuntimeProvider runtime={runtime}>
        <ConnectRemoteDialog open onClose={vi.fn()} />
      </WorkspaceRuntimeProvider>,
    )
    await vi.waitFor(() => expect(container.querySelector('#exo-connect-title')).not.toBeNull())
    await expectNoViolations(container.querySelector('[role="dialog"]'))
    await act(async () => runtime.dispose())
  })

  it('plugin log has no WCAG A/AA violations', async () => {
    const entries: PluginLogEntry[] = [
      {
        at: 1000,
        manifestUrl: 'https://plugins.example.com/exo-manifest.json',
        pluginId: 'com.example.test',
        origin: 'https://plugins.example.com',
        phase: 'manifest',
        code: 'cors',
        message: 'Could not fetch the origin.',
      },
    ]
    const container = await renderNode(<PluginLog entries={entries} />)
    await expectNoViolations(container.querySelector('.exo-plugin-log'))
  })
})
