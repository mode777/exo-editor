import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import type { FileStat, WorkspacePath, WorkspaceProvider } from '../workspace/contract'
import type { HandlerPool } from '../plugins/handlers'
import type { HandlerSaveRequest } from '../plugins/handler'
import type { EditorCandidate } from '../plugins/registry'
import type { DocumentEditorHost, PluginCallbacks } from '../workspace/documents'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { EXO_CONFIG_PATH } from '../plugins/config'
import { ConsentStore, type ConsentStorage, type Digest } from '../plugins/consent'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import { PluginHost } from '../plugins/host'

const decoder = new TextDecoder()
const FIXED_FINGERPRINT = `v1:${'0'.repeat(64)}`
const fixedDigest: Digest = async () => new Uint8Array(32).buffer

class MemoryStorage implements ConsentStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function testManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'com.example.test',
    name: 'Test Plugin',
    version: '1.0.0',
    publisher: { name: 'Test Publisher' },
    engines: { exo: '*' },
    runtime: { entry: 'plugin.html' },
    permissions: ['workspace:read'],
    contributes: {
      fileEditors: [{ glob: '**/*.txt', entry: 'editor.html', label: 'Text', priority: 0 }],
    },
  }
}

function manifestResponse(url: string): Response {
  const response = new Response(JSON.stringify(testManifest()), {
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function testHost() {
  const storage = new MemoryStorage()
  const consentStore = new ConsentStore({ storage })
  for (const origin of ['https://plugins.example.com', 'https://a.example', 'https://b.example']) {
    consentStore.grant({
      manifestOrigin: origin,
      pluginId: 'com.example.test',
      manifestUrl: `${origin}/exo-manifest.json`,
      version: '1.0.0',
      fingerprint: FIXED_FINGERPRINT,
      grantedAt: '2026-11-14T00:00:00.000Z',
    })
  }
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => manifestResponse(String(url)))
  const host = new PluginHost({
    transport: new FakeFrameTransport(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    consentStore,
    digest: fixedDigest,
    shellOrigin: 'https://editor.example.com',
    shellVersion: '0.1.0',
    now: () => 1,
    createSessionId: () => 'session-1',
  })
  return { host, fetchImpl, storage }
}

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

class FakePluginPool implements DocumentEditorHost {
  list: EditorCandidate[] = []
  callbacks: PluginCallbacks | null = null
  saveFailure: HandlerSaveRequest | null = null
  baseVersion = ''

  candidates(): EditorCandidate[] {
    return this.list
  }
  open(
    _input: { path: WorkspacePath; file: FileStat; candidate: EditorCandidate },
    callbacks: PluginCallbacks,
  ) {
    this.callbacks = callbacks
    return { ok: true } as const
  }
  close(): void {}
  save(): Promise<HandlerSaveRequest> {
    if (this.saveFailure) return Promise.resolve(this.saveFailure)
    return Promise.resolve({
      ok: true,
      requestId: 'save-1',
      content: { text: 'edited' },
      baseVersion: this.baseVersion,
    })
  }
  completeSave(): void {}
  notifyChange(): void {}
  rename(): void {}
  dirtySequence(): number {
    return 0
  }
  closeFor(): void {}
  attach(): void {}
  async detach(): Promise<void> {}
  disposeTransport(): void {}
}

async function mount(
  files: Record<string, string | Uint8Array>,
  options: { writable?: boolean; open?: boolean; editors?: FakePluginPool } = {},
) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: files,
    writable: options.writable ?? true,
  })
  const host = testHost()
  const runtime = new WorkspaceRuntime({
    providerFactory: () => provider,
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginHost: host.host,
    handlerPool: options.editors as unknown as HandlerPool | undefined,
  })
  await runtime.start()
  if (options.open !== false) await runtime.openFolder()

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return {
    provider,
    runtime,
    container,
    root,
    handle: await provider.open(),
    host: host.host,
    fetchImpl: host.fetchImpl,
    editors: options.editors,
  }
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

async function openPluginSettings(workspace: {
  runtime: WorkspaceRuntime
  container: HTMLElement
}) {
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

  it('creates exo.json and starts the host after adding an entry', async () => {
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
      await vi.waitFor(() =>
        expect(workspace.host.getSnapshot().records[0]?.phase).toBe('registering'),
      )
      expect(decoder.decode(await workspace.handle.read(EXO_CONFIG_PATH))).toBe(
        configJson(['https://plugins.example.com/exo-manifest.json']),
      )
      expect(workspace.container.querySelectorAll('iframe')).toHaveLength(0)
      expect(workspace.fetchImpl).toHaveBeenCalledWith(
        'https://plugins.example.com/exo-manifest.json',
        expect.objectContaining({ mode: 'cors', credentials: 'omit' }),
      )
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
        expect(workspace.container.querySelector('.exo-plugin-list')?.textContent).not.toContain(
          'https://a.example/m.json',
        ),
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

  it('prompts before disabling a plugin with dirty documents', async () => {
    const editors = new FakePluginPool()
    editors.list = [
      {
        identity: 'https://plugins.example.com::com.example.test',
        pluginOrder: 0,
        pluginName: 'Test Plugin',
        pluginId: 'com.example.test',
        pluginVersion: '1.0.0',
        origin: 'https://plugins.example.com',
        permissions: ['workspace:read'],
        glob: '**/*.txt',
        entry: 'editor.html',
        entryUrl: 'https://plugins.example.com/editor.html',
        label: 'Text',
        priority: 0,
        registrationOrder: 0,
      },
    ]
    const workspace = await mount(
      {
        '/a.txt': 'one',
        '/exo.json': configJson(['https://plugins.example.com/exo-manifest.json']),
      },
      { editors },
    )
    try {
      await vi.waitFor(() =>
        expect(workspace.host.getSnapshot().records[0]?.identity).toBe(
          'https://plugins.example.com::com.example.test',
        ),
      )
      await act(async () => workspace.runtime.openDocument('/a.txt'))
      await act(async () => editors.callbacks?.onActive())
      await act(async () => editors.callbacks?.onDirty(true))
      await openPluginSettings(workspace)
      const toggle = workspace.container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      expect(toggle?.checked).toBe(true)
      await act(async () => toggle?.click())
      expect(workspace.container.textContent).toContain('Unsaved changes')
      await act(async () => click(button(workspace.container, 'Cancel')))
      expect(workspace.container.textContent).not.toContain('Unsaved changes')
      expect(toggle?.checked).toBe(true)
    } finally {
      await unmount(workspace)
    }
  })

  it('keeps the plugin intact when the guarded save fails', async () => {
    const editors = new FakePluginPool()
    editors.list = [
      {
        identity: 'https://plugins.example.com::com.example.test',
        pluginOrder: 0,
        pluginName: 'Test Plugin',
        pluginId: 'com.example.test',
        pluginVersion: '1.0.0',
        origin: 'https://plugins.example.com',
        permissions: ['workspace:read'],
        glob: '**/*.txt',
        entry: 'editor.html',
        entryUrl: 'https://plugins.example.com/editor.html',
        label: 'Text',
        priority: 0,
        registrationOrder: 0,
      },
    ]
    const workspace = await mount(
      {
        '/a.txt': 'one',
        '/exo.json': configJson(['https://plugins.example.com/exo-manifest.json']),
      },
      { editors },
    )
    try {
      await vi.waitFor(() =>
        expect(workspace.host.getSnapshot().records[0]?.identity).toBe(
          'https://plugins.example.com::com.example.test',
        ),
      )
      await act(async () => workspace.runtime.openDocument('/a.txt'))
      await act(async () => editors.callbacks?.onActive())
      await act(async () => editors.callbacks?.onDirty(true))
      await openPluginSettings(workspace)
      const toggle = workspace.container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      await act(async () => toggle?.click())
      editors.saveFailure = { ok: false, code: 'timeout' }
      await act(async () => click(button(workspace.container, 'Save and close')))
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('Could not save /a.txt'),
      )
      expect(toggle?.checked).toBe(true)
    } finally {
      await unmount(workspace)
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
