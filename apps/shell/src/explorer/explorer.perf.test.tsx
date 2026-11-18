import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { configurePresetStore, clearWorkspaceTabs } from '../workbench/tabs'

let cleanup: (() => Promise<void>) | null = null

beforeEach(() => {
  localStorage.clear()
  configurePresetStore()
  clearWorkspaceTabs()
})

afterEach(async () => {
  await cleanup?.()
  cleanup = null
  document.body.innerHTML = ''
})

describe('explorer listing structure', () => {
  it('lists a 10k-entry directory once, with no per-entry stat and no recursive traversal', async () => {
    const files: Record<string, string> = {}
    for (let index = 0; index < 10_000; index += 1) {
      files[`/file-${index}.txt`] = 'x'
    }
    files['/dir/child.txt'] = 'y'

    const provider = new MemoryWorkspaceProvider({ now: () => 1, initialFiles: files })
    const runtime = new WorkspaceRuntime({
      providerFactory: () => provider,
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
    })
    await runtime.start()
    await runtime.openFolder()
    const session = runtime.getSession()
    expect(session).not.toBeNull()
    const list = vi.spyOn(session!, 'list')
    const stat = vi.spyOn(session!, 'stat')

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    cleanup = async () => {
      await act(async () => root.unmount())
      container.remove()
      await runtime.dispose()
    }

    await act(async () => root.render(<App runtime={runtime} />))

    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1), { timeout: 20_000 })
    await vi.waitFor(
      () => expect(container.querySelectorAll('.exo-tree-row').length).toBe(10_001),
      { timeout: 20_000 },
    )
    expect(list.mock.calls[0][0]).toBe('/')
    expect(stat).not.toHaveBeenCalled()

    const directory = Array.from(container.querySelectorAll<HTMLElement>('.exo-tree-row')).find(
      (row) => row.textContent?.includes('dir'),
    )
    await act(async () => {
      directory?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2), { timeout: 10_000 })
    expect(list.mock.calls[1][0]).toBe('/dir')
    expect(stat).not.toHaveBeenCalled()
  }, 40_000)
})
