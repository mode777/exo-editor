import { describe, expect, it, vi } from 'vitest'
import { WorkspaceRuntime } from '../workspace/runtime'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { MemoryHandleStore } from '../workspace/providers/folder/handle-store'
import { EXO_CONFIG_PATH } from './config'
import { PluginHost } from './host'
import { ConsentStore, type ConsentStorage, type Digest } from './consent'
import { FakeFrameTransport } from './frame-test-support'

const MANIFEST_URL = 'https://plugins.example.com/exo-manifest.json'
const IDENTITY = 'https://plugins.example.com::com.example.test'
const encoder = new TextEncoder()
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

function manifestResponse(): Response {
  const response = new Response(
    JSON.stringify({
      schemaVersion: 1,
      id: 'com.example.test',
      name: 'Test Plugin',
      version: '1.0.0',
      publisher: { name: 'Example' },
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

function configJson(manifests: string[]): string {
  return `${JSON.stringify(
    { schemaVersion: 1, plugins: manifests.map((manifest) => ({ manifest, enabled: true })) },
    null,
    2,
  )}\n`
}

async function setup(
  options: {
    files?: Record<string, string>
    writable?: boolean
    open?: boolean
  } = {},
) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: options.files ?? {},
    writable: options.writable ?? true,
  })
  const transport = new FakeFrameTransport()
  const consentStore = new ConsentStore({ storage: new MemoryStorage() })
  const fetchImpl = vi.fn(async () => manifestResponse())
  const host = new PluginHost({
    transport,
    fetchImpl: fetchImpl as unknown as typeof fetch,
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
  })
  await runtime.start()
  if (options.open !== false) {
    await runtime.openFolder()
    await vi.waitFor(() => {
      const status = runtime.pluginConfig.getSnapshot().status
      expect(status === 'idle' || status === 'loading').toBe(false)
    })
  }
  return { runtime, provider, host, transport, fetchImpl }
}

async function readConfig(runtime: WorkspaceRuntime): Promise<string> {
  const session = runtime.getSession()
  if (!session) throw new Error('No workspace session')
  return decoder.decode(await session.read(EXO_CONFIG_PATH, { maxBytes: 256 * 1024 }))
}

describe('marketplace install path', () => {
  it('writes one entry and waits for consent before mounting a frame', async () => {
    const { runtime, host, transport } = await setup()
    try {
      const result = await runtime.pluginManagement.install(MANIFEST_URL)
      expect(result).toEqual({ ok: true })
      expect(await readConfig(runtime)).toBe(configJson([MANIFEST_URL]))

      await vi.waitFor(() => expect(host.getSnapshot().records[0]?.phase).toBe('awaiting-consent'))
      expect(host.getSnapshot().consentRequest?.identity).toBe(IDENTITY)
      expect(transport.frames).toHaveLength(0)

      host.approveConsent(IDENTITY)
      await vi.waitFor(() => expect(transport.frames.length).toBeGreaterThan(0))
    } finally {
      await runtime.dispose()
    }
  })

  it('creates the declaration on first install and rejects a duplicate', async () => {
    const { runtime } = await setup()
    try {
      expect((await runtime.pluginManagement.install(MANIFEST_URL)).ok).toBe(true)
      const first = await readConfig(runtime)
      expect(first).toBe(configJson([MANIFEST_URL]))

      const duplicate = await runtime.pluginManagement.install(MANIFEST_URL)
      expect(duplicate.ok).toBe(false)
      expect(await readConfig(runtime)).toBe(first)
    } finally {
      await runtime.dispose()
    }
  })

  it('does not write in a read-only workspace', async () => {
    const { runtime } = await setup({ writable: false, files: {} })
    try {
      const result = await runtime.pluginManagement.install(MANIFEST_URL)
      expect(result.ok).toBe(false)
      expect(runtime.pluginConfig.getSnapshot().status).toBe('absent')
    } finally {
      await runtime.dispose()
    }
  })

  it('does not write with no workspace', async () => {
    const { runtime } = await setup({ open: false })
    try {
      const result = await runtime.pluginManagement.install(MANIFEST_URL)
      expect(result.ok).toBe(false)
    } finally {
      await runtime.dispose()
    }
  })

  it('does not write with an invalid declaration', async () => {
    const { runtime } = await setup({ files: { [EXO_CONFIG_PATH]: '{invalid' } })
    try {
      const result = await runtime.pluginManagement.install(MANIFEST_URL)
      expect(result.ok).toBe(false)
      expect(await readConfig(runtime)).toBe('{invalid')
    } finally {
      await runtime.dispose()
    }
  })

  it('reports a conflict instead of overwriting an external edit', async () => {
    const { runtime } = await setup({ files: { [EXO_CONFIG_PATH]: configJson([]) } })
    try {
      const session = runtime.getSession()
      if (!session) throw new Error('No workspace session')
      const external = configJson(['https://external.example.com/exo-manifest.json'])
      await session.write(EXO_CONFIG_PATH, encoder.encode(external))
      const result = await runtime.pluginManagement.install(MANIFEST_URL)
      expect(result.ok).toBe(false)
      expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toContain('conflict')
      expect(await readConfig(runtime)).toBe(external)
    } finally {
      await runtime.dispose()
    }
  })
})
