import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { WorkspaceRuntime } from './workspace/runtime'
import { MemoryWorkspaceProvider } from './workspace/providers/memory'
import { MemoryHandleStore } from './workspace/providers/folder/handle-store'
import { WorkspaceError, type WorkspaceProvider } from './workspace/contract'
import { configurePresetStore, clearWorkspaceTabs } from './workbench/tabs'

const decoder = new TextDecoder()

async function mountWorkspace(
  files: Record<string, string | Uint8Array>,
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
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  await runtime.start()
  await runtime.openFolder()

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { provider, runtime, container, root }
}

async function unmount(workspace: Awaited<ReturnType<typeof mountWorkspace>>) {
  await act(async () => workspace.root.unmount())
  workspace.container.remove()
  await workspace.runtime.dispose()
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function row(container: HTMLElement, name: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).find((element) =>
      element.textContent?.includes(name),
    ) ?? null
  )
}

function key(element: HTMLElement, value: string) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
  )
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function doubleClick(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
}

describe('workspace shell integration', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('browses the workspace, hides reserved entries and opens a text file', async () => {
    const workspace = await mountWorkspace({
      '/a.txt': 'one',
      '/dir/b.txt': 'two',
      '/exo.json': '{}',
      '/.exo/state.json': '{"private":true}',
    })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      expect(row(workspace.container, 'dir')).not.toBeNull()
      expect(row(workspace.container, 'exo.json')).toBeNull()
      expect(workspace.container.textContent).not.toContain('.exo')
      expect(workspace.container.textContent).toContain('memory-workspace · memory')

      doubleClick(row(workspace.container, 'dir'))
      await vi.waitFor(() => expect(row(workspace.container, 'b.txt')).not.toBeNull())

      doubleClick(row(workspace.container, 'a.txt'))
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('textarea')?.value).toBe('one'),
      )
      expect(useWorkbenchStore.getState().tabs.map((tab) => tab.path)).toContain('/a.txt')
    } finally {
      await unmount(workspace)
    }
  })

  it('creates, renames and deletes entries from the explorer', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())

      await act(async () => {
        click(workspace.container.querySelector('[aria-label="New Folder"]'))
      })
      const input = workspace.container.querySelector<HTMLInputElement>('input[aria-label="Name"]')
      expect(input).not.toBeNull()
      await act(async () => {
        if (input) setNativeValue(input, 'newdir')
      })
      const form = workspace.container.querySelector('form')
      await act(async () => {
        form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await vi.waitFor(() => expect(row(workspace.container, 'newdir')).not.toBeNull())
      expect(await workspace.runtime.getSession()?.stat('/newdir')).toMatchObject({
        kind: 'directory',
      })

      const folder = row(workspace.container, 'newdir')
      if (folder) folder.focus()
      await act(async () => {
        if (folder) key(folder, 'F2')
      })
      const rename = workspace.container.querySelector<HTMLInputElement>(
        'input[aria-label="Rename newdir"]',
      )
      expect(rename).not.toBeNull()
      await act(async () => {
        if (rename) setNativeValue(rename, 'renamed')
      })
      await act(async () => {
        if (rename) key(rename, 'Enter')
      })
      await vi.waitFor(() => expect(row(workspace.container, 'renamed')).not.toBeNull())
      expect(await workspace.runtime.getSession()?.stat('/renamed')).toMatchObject({
        kind: 'directory',
      })

      const renamed = row(workspace.container, 'renamed')
      if (renamed) renamed.focus()
      await act(async () => {
        if (renamed) key(renamed, 'Delete')
      })
      const deleteButton = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-dialog button'),
      ).find((button) => button.textContent === 'Delete')
      await act(async () => {
        deleteButton?.click()
      })
      await expect(workspace.runtime.getSession()?.stat('/renamed')).rejects.toMatchObject({
        code: 'not-found',
      })
    } finally {
      await unmount(workspace)
    }
  })

  it('edits, saves, prompts on dirty close and warns on unload', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      doubleClick(row(workspace.container, 'a.txt'))
      await vi.waitFor(() => expect(workspace.container.querySelector('textarea')).not.toBeNull())
      const editor = workspace.container.querySelector<HTMLTextAreaElement>('textarea')
      await act(async () => {
        if (editor) setNativeValue(editor, 'edited')
      })

      expect(workspace.runtime.documents.get('/a.txt')?.dirty).toBe(true)

      const unload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(unload)
      expect(unload.defaultPrevented).toBe(true)

      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      await vi.waitFor(() => expect(workspace.runtime.documents.get('/a.txt')?.dirty).toBe(false))
      const handle = await workspace.provider.open()
      expect(decoder.decode(await handle.read('/a.txt'))).toBe('edited')

      await act(async () => {
        if (editor) setNativeValue(editor, 'dirty again')
      })
      click(workspace.container.querySelector('[aria-label="Close a.txt"]'))
      await vi.waitFor(() => expect(workspace.container.textContent).toContain('Unsaved changes'))
      const discard = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-dialog button'),
      ).find((button) => button.textContent === 'Discard')
      await act(async () => {
        discard?.click()
      })
      await vi.waitFor(() => expect(useWorkbenchStore.getState().tabs).toHaveLength(0))
      expect(workspace.runtime.documents.get('/a.txt')).toBeUndefined()
    } finally {
      await unmount(workspace)
    }
  })

  it('operates the tree from the keyboard and refreshes visible directories', async () => {
    const workspace = await mountWorkspace({
      '/dir/b.txt': 'two',
      '/a.txt': 'one',
    })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'dir')).not.toBeNull())
      const directory = row(workspace.container, 'dir')
      directory?.focus()

      await act(async () => {
        if (directory) key(directory, 'ArrowDown')
      })
      expect(row(workspace.container, 'a.txt')?.getAttribute('aria-selected')).toBe('true')

      await act(async () => {
        const selected = row(workspace.container, 'a.txt')
        if (selected) key(selected, 'ArrowUp')
      })
      expect(row(workspace.container, 'dir')?.getAttribute('aria-selected')).toBe('true')

      await act(async () => {
        const selected = row(workspace.container, 'dir')
        if (selected) key(selected, 'ArrowRight')
      })
      await vi.waitFor(() => expect(row(workspace.container, 'b.txt')).not.toBeNull())

      await act(async () => {
        const selected = row(workspace.container, 'dir')
        if (selected) key(selected, 'ArrowRight')
      })
      await vi.waitFor(() =>
        expect(row(workspace.container, 'b.txt')?.getAttribute('aria-selected')).toBe('true'),
      )

      await act(async () => {
        const selected = row(workspace.container, 'b.txt')
        if (selected) key(selected, 'Enter')
      })
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('textarea')?.value).toBe('two'),
      )

      const session = workspace.runtime.getSession()
      await session?.write('/dir/c.txt', new Uint8Array(), { create: true })
      window.dispatchEvent(new Event('focus'))
      await vi.waitFor(() => expect(row(workspace.container, 'c.txt')).not.toBeNull())
    } finally {
      await unmount(workspace)
    }
  })

  it('saves or cancels from the unsaved changes prompt', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      doubleClick(row(workspace.container, 'a.txt'))
      await vi.waitFor(() => expect(workspace.container.querySelector('textarea')).not.toBeNull())
      const editor = workspace.container.querySelector<HTMLTextAreaElement>('textarea')
      await act(async () => {
        if (editor) setNativeValue(editor, 'edited')
      })

      await act(async () => {
        click(workspace.container.querySelector('[aria-label="Close a.txt"]'))
      })
      const cancel = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-dialog button'),
      ).find((button) => button.textContent === 'Cancel')
      await act(async () => {
        cancel?.click()
      })
      expect(useWorkbenchStore.getState().tabs).toHaveLength(1)
      expect(workspace.runtime.documents.get('/a.txt')?.dirty).toBe(true)

      await act(async () => {
        click(workspace.container.querySelector('[aria-label="Close a.txt"]'))
      })
      const save = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-dialog button'),
      ).find((button) => button.textContent === 'Save and close')
      await act(async () => {
        save?.click()
      })
      await vi.waitFor(() => expect(useWorkbenchStore.getState().tabs).toHaveLength(0))
      const handle = await workspace.provider.open()
      expect(decoder.decode(await handle.read('/a.txt'))).toBe('edited')
    } finally {
      await unmount(workspace)
    }
  })

  it('shows external changes and reloads from disk', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      doubleClick(row(workspace.container, 'a.txt'))
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('textarea')?.value).toBe('one'),
      )

      const external = await workspace.provider.open()
      await external.write('/a.txt', new TextEncoder().encode('outside'))
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('This file changed on disk'),
      )

      const reload = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-document-banner button'),
      ).find((button) => button.textContent === 'Reload')
      await act(async () => {
        reload?.click()
      })
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('textarea')?.value).toBe('outside'),
      )
    } finally {
      await unmount(workspace)
    }
  })

  it('shows a directory error with a retry that keeps the rest of the tree usable', async () => {
    const workspace = await mountWorkspace({
      '/dir/b.txt': 'two',
      '/a.txt': 'one',
    })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'dir')).not.toBeNull())
      const session = workspace.runtime.getSession()
      expect(session).not.toBeNull()
      const original = session!.list.bind(session)
      const spy = vi
        .spyOn(session!, 'list')
        .mockImplementation((path, options) =>
          path === '/dir'
            ? Promise.reject(new WorkspaceError('permission-denied', 'blocked', { path: '/dir' }))
            : original(path, options),
        )

      doubleClick(row(workspace.container, 'dir'))
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('Access to /dir was denied.'),
      )
      expect(row(workspace.container, 'a.txt')).not.toBeNull()

      spy.mockRestore()
      const retry = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-explorer-error button'),
      ).find((button) => button.textContent === 'Retry')
      await act(async () => {
        retry?.click()
      })
      await vi.waitFor(() => expect(row(workspace.container, 'b.txt')).not.toBeNull())
    } finally {
      await unmount(workspace)
    }
  })

  it('renames and deletes the open document without leaving a stale tab', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      doubleClick(row(workspace.container, 'a.txt'))
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('textarea')?.value).toBe('one'),
      )

      const fileRow = row(workspace.container, 'a.txt')
      fileRow?.focus()
      await act(async () => {
        if (fileRow) key(fileRow, 'F2')
      })
      const rename = workspace.container.querySelector<HTMLInputElement>(
        'input[aria-label="Rename a.txt"]',
      )
      await act(async () => {
        if (rename) setNativeValue(rename, 'b.txt')
      })
      await act(async () => {
        if (rename) key(rename, 'Enter')
      })
      await vi.waitFor(() =>
        expect(useWorkbenchStore.getState().tabs.map((tab) => tab.path)).toEqual(['/b.txt']),
      )

      const editor = workspace.container.querySelector<HTMLTextAreaElement>('textarea')
      await act(async () => {
        if (editor) setNativeValue(editor, 'renamed')
      })
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        )
      })
      await vi.waitFor(() => expect(workspace.runtime.documents.get('/b.txt')?.dirty).toBe(false))
      const handle = await workspace.provider.open()
      expect(decoder.decode(await handle.read('/b.txt'))).toBe('renamed')

      const renamed = row(workspace.container, 'b.txt')
      renamed?.focus()
      await act(async () => {
        if (renamed) key(renamed, 'Delete')
      })
      const deleteButton = Array.from(
        workspace.container.querySelectorAll<HTMLButtonElement>('.exo-dialog button'),
      ).find((button) => button.textContent === 'Delete')
      await act(async () => {
        deleteButton?.click()
      })
      await vi.waitFor(() => expect(useWorkbenchStore.getState().tabs).toHaveLength(0))
      await expect(workspace.runtime.getSession()?.stat('/b.txt')).rejects.toMatchObject({
        code: 'not-found',
      })
    } finally {
      await unmount(workspace)
    }
  })

  it('rejects an invalid entry name in the create dialog', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      await act(async () => {
        click(workspace.container.querySelector('[aria-label="New File"]'))
      })
      const input = workspace.container.querySelector<HTMLInputElement>('input[aria-label="Name"]')
      await act(async () => {
        if (input) setNativeValue(input, 'bad/name')
      })
      await act(async () => {
        workspace.container
          .querySelector('form')
          ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('That name is not allowed.'),
      )
      const session = workspace.runtime.getSession()
      await expect(session!.stat('/bad')).rejects.toMatchObject({
        code: 'not-found',
      })
    } finally {
      await unmount(workspace)
    }
  })

  it('drops a document read that resolves after a workspace switch', async () => {
    const first = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { '/a.txt': 'one' },
    })
    const second = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { '/b.txt': 'two' },
    })
    let releaseRead: (() => void) | null = null
    const delayedFirst: WorkspaceProvider = {
      kind: first.kind,
      label: first.label,
      capabilities: () => first.capabilities(),
      open: async () => {
        const handle = await first.open()
        const original = handle.read.bind(handle)
        handle.read = async (path, options) => {
          if (path === '/a.txt') {
            await new Promise<void>((resolve) => {
              releaseRead = resolve
            })
          }
          return original(path, options)
        }
        return handle
      },
      dispose: () => first.dispose(),
    }
    const queue = [delayedFirst, second]
    const runtime = new WorkspaceRuntime({
      providerFactory: () => {
        const next = queue.shift()
        if (!next) throw new Error('No provider queued')
        return next
      },
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
    })
    await runtime.start()
    await runtime.openFolder()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<App runtime={runtime} />))
    try {
      await vi.waitFor(() => expect(row(container, 'a.txt')).not.toBeNull())
      doubleClick(row(container, 'a.txt'))
      await vi.waitFor(() => expect(useWorkbenchStore.getState().tabs).toHaveLength(1))
      await vi.waitFor(() => expect(releaseRead).not.toBeNull())

      await act(async () => {
        await runtime.openFolder()
      })
      ;(releaseRead as unknown as () => void)()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(runtime.documents.get('/a.txt')).toBeUndefined()
      expect(useWorkbenchStore.getState().tabs).toEqual([])
    } finally {
      await act(async () => root.unmount())
      container.remove()
      await runtime.dispose()
    }
  })

  it('shows a deleted notice and refuses to save a removed file', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      doubleClick(row(workspace.container, 'a.txt'))
      await vi.waitFor(() => expect(workspace.container.querySelector('textarea')).not.toBeNull())

      const external = await workspace.provider.open()
      await external.remove('/a.txt')
      await vi.waitFor(() => expect(workspace.container.textContent).toContain('deleted on disk'))
      expect(workspace.runtime.documents.get('/a.txt')?.external).toBe('deleted')
      expect(workspace.container.querySelector<HTMLTextAreaElement>('textarea')?.readOnly).toBe(
        true,
      )
    } finally {
      await unmount(workspace)
    }
  })

  it('shows a no-editor state for binary files', async () => {
    const workspace = await mountWorkspace({
      '/image.bin': new Uint8Array([1, 2, 0, 4]),
    })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'image.bin')).not.toBeNull())
      doubleClick(row(workspace.container, 'image.bin'))
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('No editor for this file'),
      )
      expect(workspace.container.textContent).toContain('binary file')
    } finally {
      await unmount(workspace)
    }
  })

  it('shows the read-only banner and disables mutation', async () => {
    const workspace = await mountWorkspace({ '/a.txt': 'one' }, { writable: false })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'a.txt')).not.toBeNull())
      expect(workspace.container.textContent).toContain('Read-only workspace.')
      expect(
        workspace.container.querySelector<HTMLButtonElement>('[aria-label="New File"]')?.disabled,
      ).toBe(true)
      expect(workspace.container.textContent).toContain('Read-only · Restore access')
    } finally {
      await unmount(workspace)
    }
  })

  it('switches workspaces without leaving a tab or document behind', async () => {
    const first = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { '/a.txt': 'one' },
    })
    const second = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { '/b.txt': 'two' },
    })
    const queue = [first, second]
    const runtime = new WorkspaceRuntime({
      providerFactory: () => {
        const next = queue.shift()
        if (!next) throw new Error('No provider queued')
        return next
      },
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
    })
    await runtime.start()
    await runtime.openFolder()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    await act(async () => root.render(<App runtime={runtime} />))
    try {
      await vi.waitFor(() => expect(row(container, 'a.txt')).not.toBeNull())
      doubleClick(row(container, 'a.txt'))
      await vi.waitFor(() => expect(runtime.documents.get('/a.txt')?.status).toBe('ready'))
      const generation = runtime.getSnapshot().generation

      await act(async () => {
        await runtime.openFolder()
      })

      expect(runtime.getSnapshot().generation).toBeGreaterThan(generation)
      expect(useWorkbenchStore.getState().tabs).toEqual([])
      expect(runtime.documents.paths()).toEqual([])
      await vi.waitFor(() => expect(row(container, 'b.txt')).not.toBeNull())
      expect(row(container, 'a.txt')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
      await runtime.dispose()
    }
  })
})
