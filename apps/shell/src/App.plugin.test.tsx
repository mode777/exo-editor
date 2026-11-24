import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { WorkspaceRuntime } from './workspace/runtime'
import { MemoryWorkspaceProvider } from './workspace/providers/memory'
import { MemoryHandleStore } from './workspace/providers/folder/handle-store'
import type { HandlerPool } from './plugins/handlers'
import type { HandlerSaveRequest } from './plugins/handler'
import type { EditorCandidate } from './plugins/registry'
import type { DocumentEditorHost, PluginCallbacks } from './workspace/documents'
import type { FileStat, WorkspacePath } from './workspace/contract'

function candidate(overrides: Partial<EditorCandidate> = {}): EditorCandidate {
  return {
    identity: 'https://plugins.example.com::com.example.code',
    pluginOrder: 0,
    pluginName: 'Code Plugin',
    pluginId: 'com.example.code',
    pluginVersion: '1.0.0',
    origin: 'https://plugins.example.com',
    permissions: ['workspace:read', 'workspace:write'],
    glob: '**/*.txt',
    entry: 'editor.html',
    entryUrl: 'https://plugins.example.com/editor.html',
    label: 'Code',
    priority: 0,
    registrationOrder: 0,
    ...overrides,
  }
}

class FakePool implements DocumentEditorHost {
  list: EditorCandidate[] = [candidate()]
  openResult: { ok: true } | { ok: false; reason: 'cap' | 'failed' } = { ok: true }
  callbacks: PluginCallbacks | null = null
  closed: WorkspacePath[] = []
  saveContent = 'edited'
  baseVersion = ''
  seq = 0
  surfaces = new Map<WorkspacePath, HTMLElement | null>()

  candidates(): EditorCandidate[] {
    return this.list
  }
  open(
    _input: { path: WorkspacePath; file: FileStat; candidate: EditorCandidate },
    callbacks: PluginCallbacks,
  ) {
    this.callbacks = callbacks
    return this.openResult
  }
  close(path: WorkspacePath): void {
    this.closed.push(path)
  }
  attachSurface(path: WorkspacePath, element: HTMLElement | null): void {
    this.surfaces.set(path, element)
  }
  save(): Promise<HandlerSaveRequest> {
    return Promise.resolve({
      ok: true,
      requestId: 'save-1',
      content: { text: this.saveContent },
      baseVersion: this.baseVersion,
    })
  }
  completeSave(): void {}
  notifyChange(): void {}
  rename(): void {}
  dirtySequence(): number {
    return this.seq
  }
  get(): undefined {
    return undefined
  }
  attach(): void {}
  async detach(): Promise<void> {}
  publish(): boolean {
    return true
  }
  publishWorkspaceClosed(): void {}
  disposeTransport(): void {}
}

async function mount(options: { writable?: boolean } = {}) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: { '/a.txt': 'one' },
    writable: options.writable ?? true,
  })
  const editors = new FakePool()
  const runtime = new WorkspaceRuntime({
    providerFactory: () => provider,
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    handlerPool: editors as unknown as HandlerPool,
  })
  await runtime.start()
  await runtime.openFolder()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { provider, runtime, container, root, editors }
}

async function unmount(workspace: Awaited<ReturnType<typeof mount>>) {
  await act(async () => workspace.root.unmount())
  workspace.container.remove()
  await workspace.runtime.dispose()
}

async function activate(workspace: Awaited<ReturnType<typeof mount>>) {
  const stat = await workspace.runtime.getSession()?.stat('/a.txt')
  workspace.editors.baseVersion = stat?.version ?? ''
  await act(async () => workspace.editors.callbacks?.onActive())
}

describe('plugin document surface', () => {
  let workspace: Awaited<ReturnType<typeof mount>>

  beforeEach(async () => {
    localStorage.clear()
    useWorkbenchStore.setState({ tabs: [], activeTabId: null, closedTabs: [] })
    workspace = await mount()
  })

  afterEach(async () => {
    await unmount(workspace)
    useWorkbenchStore.setState({ tabs: [], activeTabId: null, closedTabs: [] })
  })

  it('opens a plugin editor under the breadcrumbs without a second header', async () => {
    await act(async () => workspace.runtime.openDocument('/a.txt'))
    await activate(workspace)
    expect(workspace.container.querySelector('.editor-breadcrumbs')?.textContent).toContain('a.txt')
    expect(workspace.container.querySelector('.exo-document-header')).toBeNull()
    expect(workspace.container.querySelector('.exo-document-editor')).toBeNull()
    expect(workspace.container.querySelector('.exo-plugin-surface')).toBeNull()
    expect(workspace.container.textContent).toContain('Opened with Code')
  })

  it('reserves a document-area slot for a frame contribution', async () => {
    workspace.editors.list = [candidate({ rendering: 'frame' })]
    await act(async () => workspace.runtime.openDocument('/a.txt'))
    await activate(workspace)
    const slot = workspace.container.querySelector('.exo-plugin-surface')
    expect(slot).not.toBeNull()
    expect(workspace.editors.surfaces.get('/a.txt')).toBe(slot)
    expect(workspace.container.textContent).not.toContain('Opened with Code')
  })

  it('prompts before closing a dirty plugin document and keeps it on cancel', async () => {
    await act(async () => workspace.runtime.openDocument('/a.txt'))
    await activate(workspace)
    await act(async () => workspace.editors.callbacks?.onDirty(true))
    await act(async () => useWorkbenchStore.getState().closeTab('/a.txt'))
    expect(workspace.container.textContent).toContain('Unsaved changes')

    const cancel = Array.from(workspace.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    )
    await act(async () => cancel?.click())
    expect(workspace.container.textContent).not.toContain('Unsaved changes')
    expect(useWorkbenchStore.getState().tabs.map((tab) => tab.path)).toContain('/a.txt')
  })

  it('saves through the plugin when the close prompt chooses save', async () => {
    await act(async () => workspace.runtime.openDocument('/a.txt'))
    await activate(workspace)
    await act(async () => workspace.editors.callbacks?.onDirty(true))
    await act(async () => useWorkbenchStore.getState().closeTab('/a.txt'))
    const save = Array.from(workspace.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save and close',
    )
    await act(async () => save?.click())
    await act(async () => {})
    const session = workspace.runtime.getSession()
    expect(new TextDecoder().decode(await session?.read('/a.txt'))).toBe('edited')
    expect(useWorkbenchStore.getState().tabs.map((tab) => tab.path)).not.toContain('/a.txt')
  })

  it('renders a failed handler without presenting an empty buffer', async () => {
    await act(async () => workspace.runtime.openDocument('/a.txt'))
    await activate(workspace)
    await act(async () => workspace.editors.callbacks?.onDirty(true))
    await act(async () =>
      workspace.editors.callbacks?.onFailure({
        code: 'protocol-violation',
        phase: 'editor',
        message: 'bad',
      }),
    )
    expect(workspace.container.textContent).toContain('The plugin editor could not start')
    expect(workspace.container.textContent).toContain('cannot be recovered')
    expect(workspace.container.querySelector('.exo-document-editor')).toBeNull()
    expect(workspace.container.textContent).not.toContain('one')
  })

  it('falls back to text when a handler never becomes ready', async () => {
    await act(async () => workspace.runtime.openDocument('/a.txt'))
    await activate(workspace)
    await act(async () =>
      workspace.editors.callbacks?.onFailure({ code: 'timeout', phase: 'ready' }),
    )
    await act(async () => {})
    expect(workspace.container.textContent).toContain('did not start')
    expect(workspace.container.querySelector('.exo-document-editor')).not.toBeNull()
    expect(workspace.container.textContent).toContain('one')
  })
})

describe('read-only plugin document', () => {
  it('shows no save action and an explicit notice', async () => {
    const readOnly = await mount({ writable: false })
    try {
      await act(async () => readOnly.runtime.openDocument('/a.txt'))
      const stat = await readOnly.runtime.getSession()?.stat('/a.txt')
      readOnly.editors.baseVersion = stat?.version ?? ''
      await act(async () => readOnly.editors.callbacks?.onActive())
      await act(async () => readOnly.editors.callbacks?.onDirty(true))
      expect(readOnly.container.textContent).toContain('Read-only workspace')
      expect(
        Array.from(readOnly.container.querySelectorAll('button')).some(
          (button) => button.textContent === 'Save',
        ),
      ).toBe(false)
    } finally {
      await unmount(readOnly)
    }
  })

  it('shows a read-only editor notice without a second header', async () => {
    const readOnly = await mount()
    try {
      readOnly.editors.list = [candidate({ permissions: ['workspace:read'] })]
      await act(async () => readOnly.runtime.openDocument('/a.txt'))
      await activate(readOnly)
      expect(readOnly.container.textContent).toContain('Read-only editor')
      expect(readOnly.container.querySelector('.exo-document-header')).toBeNull()
      expect(
        Array.from(readOnly.container.querySelectorAll('button')).some(
          (button) => button.textContent === 'Save',
        ),
      ).toBe(false)
    } finally {
      await unmount(readOnly)
    }
  })
})
