import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import type { WorkspaceProvider } from '../workspace/contract'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { EXO_CONFIG_PATH } from '../plugins/config'

const decoder = new TextDecoder()

function configJson(manifests: string[]): string {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      plugins: manifests.map((manifest) => ({ manifest, enabled: true })),
    },
    null,
    2,
  )}\n`
}

async function mount(
  files: Record<string, string | Uint8Array>,
  options: { writable?: boolean; open?: boolean } = {},
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
  if (options.open !== false) await runtime.openFolder()

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { provider, runtime, container, root, handle: await provider.open() }
}

async function unmount(workspace: Awaited<ReturnType<typeof mount>>) {
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

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function submit(form: Element | null) {
  form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

async function openPluginSettings(workspace: Awaited<ReturnType<typeof mount>>) {
  await act(async () => {
    workspace.runtime.openDocument(EXO_CONFIG_PATH)
  })
  await vi.waitFor(() =>
    expect(workspace.container.querySelector('#exo-settings-plugins')).not.toBeNull(),
  )
}

function button(container: HTMLElement, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent?.trim() === label,
    ) ?? null
  )
}

describe('plugin settings surface', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('creates exo.json from the missing state without loading plugin code', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const workspace = await mount({ '/a.txt': 'one' })
    try {
      await openPluginSettings(workspace)
      expect(workspace.container.textContent).toContain('No plugins are declared')
      expect(useWorkbenchStore.getState().tabs).toEqual([])

      const input = workspace.container.querySelector<HTMLInputElement>('#exo-plugin-add-url')
      expect(input).not.toBeNull()
      await act(async () => {
        if (input) setNativeValue(input, 'https://plugins.example.com/exo-manifest.json')
      })
      await act(async () => {
        submit(workspace.container.querySelector('.exo-plugin-add'))
      })

      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain(
          'https://plugins.example.com/exo-manifest.json',
        ),
      )
      expect(decoder.decode(await workspace.handle.read(EXO_CONFIG_PATH))).toBe(
        configJson(['https://plugins.example.com/exo-manifest.json']),
      )
      expect(workspace.container.querySelectorAll('iframe')).toHaveLength(0)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(useWorkbenchStore.getState().tabs).toEqual([])
    } finally {
      await unmount(workspace)
    }
  })

  it('toggles and removes declared entries without touching the others', async () => {
    const workspace = await mount({
      [EXO_CONFIG_PATH]: configJson(['https://a.example/m.json', 'https://b.example/m.json']),
    })
    try {
      await openPluginSettings(workspace)
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('https://b.example/m.json'),
      )

      const first = workspace.container.querySelector<HTMLInputElement>(
        '.exo-plugin-entry input[type="checkbox"]',
      )
      await act(async () => {
        first?.click()
      })
      await vi.waitFor(() =>
        expect(workspace.runtime.pluginConfig.getSnapshot().text).toContain('"enabled": false'),
      )
      expect(decoder.decode(await workspace.handle.read(EXO_CONFIG_PATH))).toContain(
        '"manifest": "https://b.example/m.json",\n      "enabled": true',
      )

      const remove = workspace.container.querySelector<HTMLButtonElement>('.exo-plugin-remove')
      await act(async () => {
        remove?.click()
      })
      await vi.waitFor(() =>
        expect(workspace.container.textContent).not.toContain('https://a.example/m.json'),
      )
      expect(decoder.decode(await workspace.handle.read(EXO_CONFIG_PATH))).toBe(
        configJson(['https://b.example/m.json']),
      )
    } finally {
      await unmount(workspace)
    }
  })

  it('reports invalid declaration issues and repairs through the raw view', async () => {
    const workspace = await mount({
      '/a.txt': 'one',
      [EXO_CONFIG_PATH]:
        '{"schemaVersion":1,"plugins":[{"manifest":"http://bad.example/m.json","extra":true}]}',
    })
    try {
      await openPluginSettings(workspace)
      await vi.waitFor(() => expect(workspace.container.textContent).toContain('invalid-config'))
      expect(workspace.container.textContent).toContain('/plugins/0/manifest')
      expect(workspace.container.textContent).toContain('/plugins/0/extra')
      expect(workspace.container.textContent).not.toContain('Add')
      expect(workspace.container.textContent).toContain('a.txt')

      await act(async () => {
        click(button(workspace.container, 'Open exo.json'))
      })
      const raw = workspace.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="exo.json content"]',
      )
      expect(raw?.value).toBe(
        '{"schemaVersion":1,"plugins":[{"manifest":"http://bad.example/m.json","extra":true}]}',
      )
      await act(async () => {
        if (raw) {
          setNativeValue(
            raw,
            '{"schemaVersion":1,"plugins":[{"manifest":"https://good.example/m.json"}]}',
          )
        }
      })
      await act(async () => {
        click(button(workspace.container, 'Save'))
      })

      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('https://good.example/m.json'),
      )
      expect(decoder.decode(await workspace.handle.read(EXO_CONFIG_PATH))).toBe(
        configJson(['https://good.example/m.json']),
      )
    } finally {
      await unmount(workspace)
    }
  })

  it('reports the 51-entry limit without presenting usable entries', async () => {
    const plugins = Array.from({ length: 51 }, (_, index) => ({
      manifest: `https://example.com/${index}.json`,
      enabled: true,
    }))
    const workspace = await mount({
      [EXO_CONFIG_PATH]: JSON.stringify({ schemaVersion: 1, plugins }, null, 2),
    })
    try {
      await openPluginSettings(workspace)
      await vi.waitFor(() => expect(workspace.container.textContent).toContain('too-many-plugins'))
      expect(workspace.container.querySelector('.exo-plugin-list')).toBeNull()
    } finally {
      await unmount(workspace)
    }
  })

  it('disables configuration edits in a read-only workspace', async () => {
    const workspace = await mount(
      { [EXO_CONFIG_PATH]: configJson(['https://example.com/m.json']) },
      { writable: false },
    )
    try {
      await openPluginSettings(workspace)
      await vi.waitFor(() => expect(workspace.container.textContent).toContain('read-only'))
      expect(
        workspace.container.querySelector<HTMLInputElement>('#exo-plugin-add-url')?.disabled,
      ).toBe(true)
      expect(
        workspace.container.querySelector<HTMLInputElement>(
          '.exo-plugin-entry input[type="checkbox"]',
        )?.disabled,
      ).toBe(true)

      await act(async () => {
        click(button(workspace.container, 'Open exo.json'))
      })
      expect(
        workspace.container.querySelector<HTMLTextAreaElement>('[aria-label="exo.json content"]')
          ?.readOnly,
      ).toBe(true)
      expect(button(workspace.container, 'Save')?.disabled).toBe(true)
    } finally {
      await unmount(workspace)
    }
  })

  it('preserves a raw draft when an external edit makes the save conflict', async () => {
    const workspace = await mount({
      [EXO_CONFIG_PATH]: configJson(['https://a.example/m.json']),
    })
    try {
      await openPluginSettings(workspace)
      await act(async () => {
        click(button(workspace.container, 'Open exo.json'))
      })
      const raw = workspace.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="exo.json content"]',
      )
      const draft = '{"schemaVersion":1,"plugins":[{"manifest":"https://draft.example/m.json"}]}'
      await act(async () => {
        if (raw) setNativeValue(raw, draft)
      })

      const external = configJson(['https://external.example/m.json'])
      workspace.provider.seed(EXO_CONFIG_PATH, external)
      await act(async () => {
        click(button(workspace.container, 'Save'))
      })

      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('exo.json changed on disk'),
      )
      expect(decoder.decode(await workspace.handle.read(EXO_CONFIG_PATH))).toBe(external)
      expect(
        workspace.container.querySelector<HTMLTextAreaElement>('[aria-label="exo.json content"]')
          ?.value,
      ).toBe(draft)

      await act(async () => {
        click(button(workspace.container, 'Reload'))
      })
      await vi.waitFor(() =>
        expect(
          workspace.container.querySelector<HTMLTextAreaElement>('[aria-label="exo.json content"]')
            ?.value,
        ).toBe(external),
      )
    } finally {
      await unmount(workspace)
    }
  })

  it('shows the new declaration after a workspace switch', async () => {
    const first = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: {
        [EXO_CONFIG_PATH]: configJson(['https://first.example/m.json']),
      },
    })
    const second = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: {
        [EXO_CONFIG_PATH]: configJson(['https://second.example/m.json']),
      },
    })
    const queue: WorkspaceProvider[] = [first, second]
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
    const workspace = { provider: first, runtime, container, root, handle: await first.open() }
    try {
      await openPluginSettings(workspace)
      await vi.waitFor(() =>
        expect(container.textContent).toContain('https://first.example/m.json'),
      )

      await act(async () => {
        await runtime.openFolder()
      })

      await vi.waitFor(() =>
        expect(container.textContent).toContain('https://second.example/m.json'),
      )
      expect(container.textContent).not.toContain('https://first.example/m.json')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      await runtime.dispose()
    }
  })

  it('explains the plugins section when no workspace is open', async () => {
    const workspace = await mount({}, { open: false })
    try {
      await openPluginSettings(workspace)
      expect(workspace.container.textContent).toContain(
        'Open a folder to configure workspace plugins.',
      )
    } finally {
      await unmount(workspace)
    }
  })
})
