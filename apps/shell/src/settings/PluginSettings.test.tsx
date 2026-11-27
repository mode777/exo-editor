import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { EXO_CONFIG_PATH } from '../plugins/config'
import { ConsentStore, type ConsentStorage, type Digest } from '../plugins/consent'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import { PluginHost } from '../plugins/host'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'

const MANIFEST_URL = 'https://plugins.example.com/exo-manifest.json'
const decoder = new TextDecoder()
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

function configJson(manifests: string[]): string {
  return `${JSON.stringify(
    { schemaVersion: 1, plugins: manifests.map((manifest) => ({ manifest, enabled: true })) },
    null,
    2,
  )}\n`
}

function manifestResponse(): Response {
  const response = new Response(
    JSON.stringify({
      schemaVersion: 1,
      id: 'com.example.test',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin.',
      publisher: { name: 'Test Publisher' },
      engines: { exo: '*' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read'],
      contributes: {
        fileEditors: [{ glob: '**/*.txt', entry: 'editor.html', label: 'Text', priority: 0 }],
      },
    }),
    { headers: { 'content-type': 'application/json' } },
  )
  Object.defineProperty(response, 'url', { value: MANIFEST_URL })
  return response
}

async function mount(
  files: Record<string, string>,
  options: { writable?: boolean; open?: boolean } = {},
) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: files,
    writable: options.writable ?? true,
  })
  const host = new PluginHost({
    transport: new FakeFrameTransport(),
    fetchImpl: vi.fn(async () => manifestResponse()) as unknown as typeof fetch,
    consentStore: new ConsentStore({ storage: new MemoryStorage() }),
    digest: fixedDigest,
    shellOrigin: 'https://editor.example.com',
    shellVersion: '0.12.0',
    now: () => 1,
    createSessionId: () => 'session-1',
  })
  const runtime = new WorkspaceRuntime({
    providerFactory: () => provider,
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginHost: host,
  })
  await runtime.start()
  if (options.open !== false) await runtime.openFolder()
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { provider, runtime, container, root, host }
}

async function unmount(workspace: Awaited<ReturnType<typeof mount>>) {
  await act(async () => workspace.root.unmount())
  workspace.container.remove()
  await workspace.runtime.dispose()
}

async function openPluginDebug(workspace: Awaited<ReturnType<typeof mount>>) {
  await act(async () => workspace.runtime.openDocument(EXO_CONFIG_PATH))
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

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function setNativeValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function readConfig(workspace: Awaited<ReturnType<typeof mount>>): Promise<string> {
  const session = workspace.runtime.getSession()
  if (!session) throw new Error('No session')
  return decoder.decode(await session.read(EXO_CONFIG_PATH, { maxBytes: 256 * 1024 }))
}

describe('plugin debugging surface', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('explains the debug surface when no workspace is open', async () => {
    const workspace = await mount({}, { open: false })
    try {
      await openPluginDebug(workspace)
      expect(workspace.container.textContent).toContain('Plugin debugging')
      expect(workspace.container.textContent).toContain('Open a folder to inspect')
      expect(workspace.container.querySelector('#exo-plugin-add-url')).toBeNull()
      expect(workspace.container.querySelector('.exo-plugin-settings')).toBeNull()
    } finally {
      await unmount(workspace)
    }
  })

  it('shows raw exo.json, status rows and the plugin log without management controls', async () => {
    const workspace = await mount({ [EXO_CONFIG_PATH]: configJson([MANIFEST_URL]) })
    try {
      await openPluginDebug(workspace)
      await vi.waitFor(() => expect(workspace.container.textContent).toContain('Test Plugin'))
      expect(workspace.container.textContent).toContain('Awaiting consent')
      expect(workspace.container.textContent).toContain('manifest fetch')
      expect(workspace.container.querySelector('#exo-plugin-add-url')).toBeNull()
      expect(
        workspace.container.querySelector('.exo-plugin-entry input[type="checkbox"]'),
      ).toBeNull()
      expect(workspace.container.querySelector('.exo-plugin-settings')).toBeNull()

      await act(async () => click(button(workspace.container, 'Open exo.json')))
      const raw = workspace.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="exo.json content"]',
      )
      expect(raw?.value).toBe(configJson([MANIFEST_URL]))
      expect(workspace.container.textContent).toContain('canonical 2-space JSON')
    } finally {
      await unmount(workspace)
    }
  })

  it('rejects invalid raw text without writing', async () => {
    const workspace = await mount({ [EXO_CONFIG_PATH]: configJson([MANIFEST_URL]) })
    try {
      await openPluginDebug(workspace)
      await act(async () => click(button(workspace.container, 'Open exo.json')))
      const raw = workspace.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="exo.json content"]',
      )
      if (!raw) throw new Error('Raw editor missing')
      await act(async () => setNativeValue(raw, '{invalid'))
      await act(async () => click(button(workspace.container, 'Save')))
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('exo.json is not valid JSON.'),
      )
      expect(await readConfig(workspace)).toBe(configJson([MANIFEST_URL]))
    } finally {
      await unmount(workspace)
    }
  })

  it('preserves a raw draft when an external edit makes the save conflict', async () => {
    const workspace = await mount({ [EXO_CONFIG_PATH]: configJson([MANIFEST_URL]) })
    try {
      await openPluginDebug(workspace)
      await act(async () => click(button(workspace.container, 'Open exo.json')))
      const raw = workspace.container.querySelector<HTMLTextAreaElement>(
        '[aria-label="exo.json content"]',
      )
      if (!raw) throw new Error('Raw editor missing')
      const draft = '{"schemaVersion":1,"plugins":[{"manifest":"https://draft.example/m.json"}]}'
      await act(async () => setNativeValue(raw, draft))
      const external = configJson(['https://external.example/m.json'])
      workspace.provider.seed(EXO_CONFIG_PATH, external)
      await act(async () => click(button(workspace.container, 'Save')))
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('exo.json changed on disk'),
      )
      expect(raw.value).toBe(draft)
      expect(await readConfig(workspace)).toBe(external)
    } finally {
      await unmount(workspace)
    }
  })

  it('disables raw saves in a read-only workspace', async () => {
    const workspace = await mount(
      { [EXO_CONFIG_PATH]: configJson([MANIFEST_URL]) },
      { writable: false },
    )
    try {
      await openPluginDebug(workspace)
      expect(workspace.container.textContent).toContain('read-only')
      await act(async () => click(button(workspace.container, 'Open exo.json')))
      expect(
        workspace.container.querySelector<HTMLTextAreaElement>('[aria-label="exo.json content"]')
          ?.readOnly,
      ).toBe(true)
      expect(button(workspace.container, 'Save')?.disabled).toBe(true)
    } finally {
      await unmount(workspace)
    }
  })

  it('updates the debug view after a workspace switch', async () => {
    let current = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { [EXO_CONFIG_PATH]: configJson(['https://first.example/m.json']) },
    })
    const host = new PluginHost({
      transport: new FakeFrameTransport(),
      fetchImpl: vi.fn(async () => manifestResponse()) as unknown as typeof fetch,
      consentStore: new ConsentStore({ storage: new MemoryStorage() }),
      digest: fixedDigest,
      shellOrigin: 'https://editor.example.com',
      shellVersion: '0.12.0',
      now: () => 1,
      createSessionId: () => 'session-1',
    })
    const runtime = new WorkspaceRuntime({
      providerFactory: () => current,
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: host,
    })
    await runtime.start()
    await runtime.openFolder()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<App runtime={runtime} />))
    try {
      await openPluginDebug({ runtime, container, root, host, provider: current })
      await vi.waitFor(() =>
        expect(container.textContent).toContain('https://first.example/m.json'),
      )
      current = new MemoryWorkspaceProvider({
        now: () => 1,
        initialFiles: { [EXO_CONFIG_PATH]: configJson(['https://second.example/m.json']) },
      })
      await act(async () => void runtime.openFolder())
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
})
