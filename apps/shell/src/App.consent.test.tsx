import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { EXO_CONFIG_PATH } from './plugins/config'
import type { Digest } from './plugins/consent'
import { FakeFrameTransport } from './plugins/frame-test-support'
import { PluginHost } from './plugins/host'
import { clearWorkspaceTabs, configurePresetStore } from './workbench/tabs'
import { MemoryHandleStore } from './workspace/providers/folder/handle-store'
import { MemoryWorkspaceProvider } from './workspace/providers/memory'
import { WorkspaceRuntime } from './workspace/runtime'

const MANIFEST_URL = 'https://plugins.example.com/monaco/exo-manifest.json'
const HIGH_MANIFEST_URL = 'https://high.example.com/plugin/exo-manifest.json'
const digest: Digest = async () => new Uint8Array(32).buffer

function manifestJson(): Record<string, unknown> {
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

function highManifestJson(): Record<string, unknown> {
  return {
    ...manifestJson(),
    id: 'com.example.high',
    name: 'High Priority Plugin',
    contributes: {
      fileEditors: [{ glob: '**/*.txt', entry: 'editor.html', label: 'High', priority: 10 }],
    },
  }
}

function configJson(): string {
  return `${JSON.stringify(
    { schemaVersion: 1, plugins: [{ manifest: MANIFEST_URL, enabled: true }] },
    null,
    2,
  )}\n`
}

function manifestResponse(url: string, body: Record<string, unknown> = manifestJson()): Response {
  const response = new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

async function mountApp() {
  const transport = new FakeFrameTransport()
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const target = String(url)
    return target.includes('high.example.com')
      ? manifestResponse(HIGH_MANIFEST_URL, highManifestJson())
      : manifestResponse(MANIFEST_URL)
  })
  const host = new PluginHost({
    transport,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    digest,
    shellOrigin: 'https://editor.example.com',
    shellVersion: '0.1.0',
    now: () => 1,
    createSessionId: () => 'session-1',
  })
  const runtime = new WorkspaceRuntime({
    providerFactory: () =>
      new MemoryWorkspaceProvider({
        now: () => 1,
        initialFiles: { '/exo.json': configJson(), '/a.txt': 'one' },
      }),
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
  const root: Root = createRoot(container)
  await act(async () => root.render(<App runtime={runtime} />))
  return { host, transport, runtime, container, root, fetchImpl }
}

async function teardown(app: Awaited<ReturnType<typeof mountApp>>) {
  await act(async () => app.root.unmount())
  app.container.remove()
  await app.runtime.dispose()
  document.body.innerHTML = ''
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

function readyAndComplete(
  app: Awaited<ReturnType<typeof mountApp>>,
  match = 'plugins.example.com',
) {
  const frame = app.transport.frames.find(
    (candidate) => !candidate.closed && candidate.options.url.includes(match),
  )
  if (!frame) throw new Error('Registration frame missing')
  const origin = new URL(frame.options.url).origin
  frame.emit(
    { exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId: 'session-1' } },
    origin,
  )
  frame.emit(
    {
      exo: 1,
      type: 'plugin/register',
      payload: { fileEditors: [{ glob: '**/*.txt', entry: 'editor.html' }] },
    },
    origin,
  )
  frame.emit({ exo: 1, type: 'plugin/register-complete', payload: {} }, origin)
}

beforeEach(() => {
  localStorage.clear()
  configurePresetStore()
  clearWorkspaceTabs()
})

describe('app consent flow', () => {
  it('shows the consent dialog with settings closed and activates after approval', async () => {
    const app = await mountApp()
    try {
      await vi.waitFor(() =>
        expect(app.container.querySelector('[aria-label="Plugin consent"]')).not.toBeNull(),
      )
      expect(app.container.textContent).toContain('Test Plugin')

      await act(async () => click(button(app.container, 'Allow plugin')))
      await vi.waitFor(() => expect(app.host.getSnapshot().records[0]?.phase).toBe('registering'))
      expect(app.container.querySelector('[aria-label="Plugin consent"]')).toBeNull()

      await act(async () => app.runtime.openDocument(EXO_CONFIG_PATH))
      await vi.waitFor(() =>
        expect(app.container.querySelector('#exo-settings-plugins')).not.toBeNull(),
      )
      expect(app.container.textContent).toContain('Registering…')
      // Consent management moved to the extension details tab; the settings
      // debug surface reports status only.
      expect(button(app.container, 'Revoke consent')).toBeNull()

      await act(async () => readyAndComplete(app))
      await vi.waitFor(() => expect(app.container.textContent).toContain('Active — Text'))
    } finally {
      await teardown(app)
    }
  })

  it('denies without mounting a frame and records the decision in settings', async () => {
    const app = await mountApp()
    try {
      await vi.waitFor(() =>
        expect(app.container.querySelector('[aria-label="Plugin consent"]')).not.toBeNull(),
      )
      await act(async () => click(button(app.container, 'Deny')))
      await vi.waitFor(() => expect(app.container.textContent).not.toContain('Plugin consent'))
      expect(app.transport.frames).toHaveLength(0)

      await act(async () => app.runtime.openDocument(EXO_CONFIG_PATH))
      await vi.waitFor(() =>
        expect(app.container.textContent).toContain('Consent denied for this session'),
      )
      expect(app.host.getSnapshot().records[0].phase).toBe('denied')
    } finally {
      await teardown(app)
    }
  })

  it('handles live add, priority, disable and a workspace switch', async () => {
    const app = await mountApp()
    try {
      await vi.waitFor(() =>
        expect(app.container.querySelector('[aria-label="Plugin consent"]')).not.toBeNull(),
      )
      await act(async () => click(button(app.container, 'Allow plugin')))
      await vi.waitFor(() => expect(app.host.getSnapshot().records[0]?.phase).toBe('registering'))
      await act(async () => readyAndComplete(app, 'plugins.example.com'))
      await vi.waitFor(() => expect(app.host.getSnapshot().records[0]?.phase).toBe('active'))
      const lowFrame = app.transport.frames.find((frame) =>
        frame.options.url.includes('plugins.example.com'),
      )
      if (!lowFrame) throw new Error('low frame missing')

      await act(async () => {
        await app.runtime.pluginConfig.addEntry(HIGH_MANIFEST_URL)
      })
      await vi.waitFor(() =>
        expect(app.container.querySelector('[aria-label="Plugin consent"]')).not.toBeNull(),
      )
      await act(async () => click(button(app.container, 'Allow plugin')))
      await vi.waitFor(() => {
        const high = app.host
          .getSnapshot()
          .records.find((record) => record.manifestUrl === HIGH_MANIFEST_URL)
        expect(high?.phase).toBe('registering')
      })
      await act(async () => readyAndComplete(app, 'high.example.com'))
      await vi.waitFor(() => {
        expect(app.host.getSnapshot().records.every((record) => record.phase === 'active')).toBe(
          true,
        )
      })
      expect(app.host.match('/a.txt')[0].identity).toBe(
        'https://high.example.com::com.example.high',
      )

      await act(async () => {
        await app.runtime.pluginConfig.setEnabled(1, false)
      })
      await vi.waitFor(() => {
        const high = app.host
          .getSnapshot()
          .records.find((record) => record.manifestUrl === HIGH_MANIFEST_URL)
        expect(high?.phase).toBe('disabled')
      })
      expect(app.host.match('/a.txt').map((candidate) => candidate.identity)).toEqual([
        'https://plugins.example.com::com.example.test',
      ])

      await act(async () => {
        await app.runtime.openFolder()
      })
      expect(lowFrame.closed).toBe(true)
      await vi.waitFor(() => {
        const low = app.host
          .getSnapshot()
          .records.find((record) => record.manifestUrl === MANIFEST_URL)
        expect(low?.phase).toBe('registering')
      })
      expect(app.host.match('/a.txt')).toEqual([])
      await act(async () => readyAndComplete(app, 'plugins.example.com'))
      await vi.waitFor(() =>
        expect(app.host.match('/a.txt')[0]?.identity).toBe(
          'https://plugins.example.com::com.example.test',
        ),
      )
    } finally {
      await teardown(app)
    }
  })
})
