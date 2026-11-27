import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useWorkbenchStore } from 'vscode-workbench'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { EXO_CONFIG_PATH } from '../plugins/config'
import { ConsentStore, type ConsentStorage, type Digest } from '../plugins/consent'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import { PluginHost } from '../plugins/host'
import { MemoryPluginSettingsStorage } from '../plugins/settings'
import { MarketplaceStore } from '../marketplace/store'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { describeAxeViolations, runAxe } from '../test-a11y'

const TEST_MANIFEST = 'https://plugins.example.com/test/exo-manifest.json'
const CATALOG_MANIFEST = 'https://plugins.example.com/catalog/exo-manifest.json'
const SOURCE_URL = 'https://shell.example.com/marketplace-sources.json'
const FEED_URL = 'https://shell.example.com/marketplace.json'
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

function manifestFor(url: string): Record<string, unknown> {
  const catalog = url === CATALOG_MANIFEST
  return {
    schemaVersion: 1,
    id: catalog ? 'com.example.catalog' : 'com.example.test',
    name: catalog ? 'Catalog Editor' : 'Installed Editor',
    version: '1.2.3',
    description: catalog ? 'A catalog editor.' : 'An installed editor.',
    publisher: { name: 'Example' },
    engines: { exo: '*' },
    runtime: { entry: 'plugin.html' },
    permissions: ['workspace:read', 'events:subscribe'],
    contributes: {
      fileEditors: [
        {
          glob: catalog ? '**/*.cat' : '**/*.txt',
          entry: 'editor.html',
          label: catalog ? 'Catalog' : 'Text',
          priority: 0,
        },
      ],
      configuration: {
        properties: {
          'editor.greeting': {
            type: 'string',
            default: 'hello',
            description: 'Greeting text.',
            scope: 'workspace',
          },
        },
      },
    },
  }
}

function manifestResponse(url: string): Response {
  const response = new Response(JSON.stringify(manifestFor(url)), {
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function marketplace(options: { failSource?: boolean; feedManifests?: string[] } = {}) {
  return new MarketplaceStore({
    sourceUrl: SOURCE_URL,
    fetchImpl: vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === SOURCE_URL) {
        if (options.failSource) return new Response('no', { status: 404 })
        return new Response(JSON.stringify({ schemaVersion: 1, feeds: [FEED_URL] }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url === FEED_URL) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            id: 'test-feed',
            name: 'Test Feed',
            owner: { name: 'Example' },
            plugins: (options.feedManifests ?? [CATALOG_MANIFEST]).map((manifest, index) => ({
              name: index === 0 ? 'Catalog Editor' : `Catalog Editor ${index}`,
              manifest,
              description: 'A catalog editor.',
              version: '1.2.3',
              publisher: { name: 'Example' },
              keywords: ['catalog'],
            })),
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as never,
  })
}

async function mount(
  options: {
    files?: Record<string, string>
    writable?: boolean
    open?: boolean
    openExtensions?: boolean
    failSource?: boolean
  } = {},
) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: options.files ?? {},
    writable: options.writable ?? true,
  })
  const consentStore = new ConsentStore({ storage: new MemoryStorage() })
  const hostFetch = vi.fn(async (input: RequestInfo | URL) => manifestResponse(String(input)))
  const host = new PluginHost({
    transport: new FakeFrameTransport(),
    fetchImpl: hostFetch as unknown as typeof fetch,
    consentStore,
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
    pluginSettingsStorage: new MemoryPluginSettingsStorage(),
    marketplace: marketplace({ failSource: options.failSource }),
  })
  await runtime.start()
  if (options.open !== false) await runtime.openFolder()

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  if (options.openExtensions !== false) {
    await act(async () => useWorkbenchStore.getState().showPrimaryView('extensions'))
  }
  return { provider, runtime, container, root, host, hostFetch }
}

async function unmount(workspace: Awaited<ReturnType<typeof mount>>) {
  await act(async () => workspace.root.unmount())
  workspace.container.remove()
  await workspace.runtime.dispose()
}

function button(element: ParentNode, label: string): HTMLButtonElement | null {
  return (
    Array.from(element.querySelectorAll<HTMLButtonElement>('button')).find(
      (candidate) => candidate.textContent?.trim() === label,
    ) ?? null
  )
}

function row(container: HTMLElement, text: string): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>('.exo-extension-row')).find((element) =>
      element.textContent?.includes(text),
    ) ?? null
  )
}

function setInput(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function click(element: Element | null) {
  element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

async function configText(workspace: Awaited<ReturnType<typeof mount>>): Promise<string> {
  const session = workspace.runtime.getSession()
  if (!session) throw new Error('No session')
  return decoder.decode(await session.read(EXO_CONFIG_PATH, { maxBytes: 256 * 1024 }))
}

describe('extensions view', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
    useWorkbenchStore.setState({ activePrimaryView: 'explorer', primarySideBarVisible: true })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders after Explorer and shows installed and marketplace sections', async () => {
    const workspace = await mount({ files: { [EXO_CONFIG_PATH]: configJson([TEST_MANIFEST]) } })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Installed Editor')).not.toBeNull())
      await vi.waitFor(() => expect(row(workspace.container, 'Catalog Editor')).not.toBeNull())
      const activity = Array.from(
        workspace.container.querySelectorAll('.activitybar .icon-button'),
      ).map((element) => element.getAttribute('aria-label'))
      expect(activity.slice(0, 2)).toEqual(['Explorer', 'Extensions'])
      expect(workspace.container.querySelector('#exo-extensions-search')).not.toBeNull()
      expect(workspace.container.textContent).toContain('Installed')
      expect(workspace.container.textContent).toContain('Marketplace')
      expect(workspace.container.textContent).toContain('Test Feed')
    } finally {
      await unmount(workspace)
    }
  })

  it('filters both sections locally', async () => {
    const workspace = await mount({ files: { [EXO_CONFIG_PATH]: configJson([TEST_MANIFEST]) } })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Catalog Editor')).not.toBeNull())
      const search = workspace.container.querySelector<HTMLInputElement>('#exo-extensions-search')
      if (!search) throw new Error('Search missing')
      await act(async () => setInput(search, 'Catalog'))
      expect(row(workspace.container, 'Installed Editor')).toBeNull()
      expect(row(workspace.container, 'Catalog Editor')).not.toBeNull()
      await act(async () => setInput(search, 'nothing-matches'))
      expect(workspace.container.textContent).toContain('No installed extensions match')
      expect(workspace.container.textContent).toContain('No marketplace extensions match')
    } finally {
      await unmount(workspace)
    }
  })

  it('installs a catalog entry into exo.json and opens details', async () => {
    const workspace = await mount()
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Catalog Editor')).not.toBeNull())
      const catalogRow = row(workspace.container, 'Catalog Editor')
      await act(async () => click(catalogRow ? button(catalogRow, 'Install') : null))
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('.exo-extension-details h2')?.textContent).toBe(
          'Catalog Editor',
        ),
      )
      expect(await configText(workspace)).toContain(CATALOG_MANIFEST)
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('[aria-label="Plugin consent"]')).not.toBeNull(),
      )
      await act(async () =>
        click(
          workspace.container.querySelector<HTMLElement>('[aria-label="Plugin consent"]')
            ? button(
                workspace.container.querySelector<HTMLElement>('[aria-label="Plugin consent"]')!,
                'Deny',
              )
            : null,
        ),
      )
    } finally {
      await unmount(workspace)
    }
  })

  it('rejects an invalid URL and adds a valid one from the form', async () => {
    const workspace = await mount()
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Catalog Editor')).not.toBeNull())
      const input = workspace.container.querySelector<HTMLInputElement>('#exo-extensions-url')
      if (!input) throw new Error('URL input missing')
      await act(async () => setInput(input, 'relative.json'))
      await act(async () => {
        input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain('invalid manifest URL'),
      )

      await act(async () => setInput(input, TEST_MANIFEST))
      await act(async () => {
        input.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await vi.waitFor(async () => expect(await configText(workspace)).toContain(TEST_MANIFEST))
    } finally {
      await unmount(workspace)
    }
  })

  it('explains the no-workspace and read-only states', async () => {
    const noWorkspace = await mount({ open: false })
    try {
      await vi.waitFor(() => expect(row(noWorkspace.container, 'Catalog Editor')).not.toBeNull())
      expect(noWorkspace.container.textContent).toContain(
        'Open a folder to install extensions into a workspace.',
      )
      const install = row(noWorkspace.container, 'Catalog Editor')
      expect(button(install!, 'Install')?.disabled).toBe(true)
    } finally {
      await unmount(noWorkspace)
    }

    const readOnly = await mount({
      writable: false,
      files: { [EXO_CONFIG_PATH]: configJson([]) },
    })
    try {
      await vi.waitFor(() => expect(row(readOnly.container, 'Catalog Editor')).not.toBeNull())
      expect(readOnly.container.textContent).toContain('This workspace is read-only')
      expect(button(row(readOnly.container, 'Catalog Editor')!, 'Install')?.disabled).toBe(true)
    } finally {
      await unmount(readOnly)
    }
  })

  it('keeps installed management available when the Source feed fails', async () => {
    const workspace = await mount({
      files: { [EXO_CONFIG_PATH]: configJson([TEST_MANIFEST]) },
      failSource: true,
    })
    try {
      await vi.waitFor(() =>
        expect(workspace.container.textContent).toContain(
          "This deployment's marketplace sources could not be loaded.",
        ),
      )
      const installed = row(workspace.container, 'Installed Editor')
      expect(installed).not.toBeNull()
      await act(async () => click(installed ? button(installed, 'Manage') : null))
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('.exo-extension-details h2')?.textContent).toBe(
          'Installed Editor',
        ),
      )
      const urlInput = workspace.container.querySelector<HTMLInputElement>('#exo-extensions-url')
      expect(urlInput?.disabled).toBe(false)
    } finally {
      await unmount(workspace)
    }
  })

  it('shows details, settings and manages an installed extension', async () => {
    const workspace = await mount({ files: { [EXO_CONFIG_PATH]: configJson([TEST_MANIFEST]) } })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Installed Editor')).not.toBeNull())
      await act(async () =>
        click(
          row(workspace.container, 'Installed Editor')
            ? button(row(workspace.container, 'Installed Editor')!, 'Manage')
            : null,
        ),
      )
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('.exo-extension-details')).not.toBeNull(),
      )
      const details = workspace.container.querySelector('.exo-extension-details')!
      expect(details.textContent).toContain('Installed Editor')
      expect(details.textContent).toContain('Example')
      expect(details.textContent).toContain('workspace:read')
      expect(details.querySelector('.exo-plugin-settings')).not.toBeNull()
      expect(details.textContent).toContain('editor.greeting')

      await act(async () => click(button(details, 'Disable')))
      await vi.waitFor(async () =>
        expect(await configText(workspace)).toContain('"enabled": false'),
      )
      await act(async () => click(button(details, 'Remove')))
      expect(button(details, 'Confirm remove')).not.toBeNull()
      await act(async () => click(button(details, 'Confirm remove')))
      await vi.waitFor(async () => expect(await configText(workspace)).toBe(configJson([])))
    } finally {
      await unmount(workspace)
    }
  })

  it('has no automated accessibility violations', async () => {
    const workspace = await mount({ files: { [EXO_CONFIG_PATH]: configJson([TEST_MANIFEST]) } })
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Catalog Editor')).not.toBeNull())
      const view = workspace.container.querySelector('.exo-extensions')
      if (!view) throw new Error('Extensions view missing')
      expect(describeAxeViolations(await runAxe(view))).toEqual([])

      await act(async () =>
        click(
          row(workspace.container, 'Installed Editor')
            ? button(row(workspace.container, 'Installed Editor')!, 'Manage')
            : null,
        ),
      )
      await vi.waitFor(() =>
        expect(workspace.container.querySelector('.exo-extension-details')).not.toBeNull(),
      )
      const details = workspace.container.querySelector('.exo-extension-details')
      if (!details) throw new Error('Details missing')
      expect(describeAxeViolations(await runAxe(details))).toEqual([])
    } finally {
      await unmount(workspace)
    }
  })

  it('does not request a manifest or mount a frame while loading the catalog', async () => {
    const workspace = await mount()
    try {
      await vi.waitFor(() => expect(row(workspace.container, 'Catalog Editor')).not.toBeNull())
      // The host was not given a reason to fetch: no installed entries yet.
      expect(workspace.hostFetch).not.toHaveBeenCalled()
      expect(workspace.container.querySelector('.exo-plugin-surface')).toBeNull()
    } finally {
      await unmount(workspace)
    }
  })

  it('loads the catalog only when the Extensions view opens', async () => {
    const workspace = await mount({ openExtensions: false })
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(workspace.runtime.marketplace.getSnapshot().phase).toBe('idle')
      await act(async () => useWorkbenchStore.getState().showPrimaryView('extensions'))
      await vi.waitFor(() =>
        expect(workspace.runtime.marketplace.getSnapshot().phase).toBe('ready'),
      )
    } finally {
      await unmount(workspace)
    }
  })
})
