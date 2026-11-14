import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  ConsentStore,
  computeFingerprint,
  type ConsentStorage,
  type Digest,
} from '../plugins/consent'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import { PluginHost } from '../plugins/host'
import { validateManifest } from '../plugins/manifest'
import { MemoryHandleStore } from './providers/folder/handle-store'
import { MemoryWorkspaceProvider } from './providers/memory'
import { WorkspaceRuntime } from './runtime'
import type { WorkspaceProvider } from './contract'

const SHELL_ORIGIN = 'https://editor.example.com'
const MANIFEST_URL = 'https://plugins.example.com/monaco/exo-manifest.json'

const digest: Digest = async (bytes) => {
  const hash = createHash('sha256').update(bytes).digest()
  return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer
}

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

function manifestJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'com.example.monaco',
    name: 'Monaco Code Editor',
    version: '1.0.0',
    publisher: { name: 'Example Corp' },
    engines: { exo: '*' },
    runtime: { entry: 'plugin.html' },
    permissions: ['workspace:read'],
    contributes: {
      fileEditors: [{ glob: '**/*.ts', entry: 'editor.html', label: 'Code', priority: 0 }],
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

function jsonResponse(body: unknown, url: string): Response {
  const response = new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function provider(): WorkspaceProvider {
  return new MemoryWorkspaceProvider({
    now: () => 1,
    initialFiles: { '/exo.json': configJson(), '/a.txt': 'one' },
  })
}

async function waitForPhase(host: PluginHost, phase: string): Promise<void> {
  await vi.waitFor(() => {
    expect(host.getSnapshot().records[0]?.phase).toBe(phase)
  })
}

function ready(frame: ReturnType<FakeFrameTransport['open']>) {
  frame.emit(
    { exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId: 'session-1' } },
    'https://plugins.example.com',
  )
  frame.emit(
    {
      exo: 1,
      type: 'plugin/register',
      payload: { fileEditors: [{ glob: '**/*.ts', entry: 'editor.html' }] },
    },
    'https://plugins.example.com',
  )
  frame.emit(
    { exo: 1, type: 'plugin/register-complete', payload: {} },
    'https://plugins.example.com',
  )
}

describe('workspace runtime plugin host integration', () => {
  it('closes frames and resets host state on a switch while keeping consent', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const manifest = validateManifest(manifestJson(), MANIFEST_URL, '0.1.0')
    if (!manifest.ok) throw new Error('fixture invalid')
    consentStore.grant({
      manifestOrigin: manifest.manifest.manifestOrigin,
      pluginId: manifest.manifest.id,
      manifestUrl: manifest.manifest.manifestUrl,
      version: manifest.manifest.version,
      fingerprint: await computeFingerprint(manifest.manifest, digest),
      grantedAt: '2026-11-14T00:00:00.000Z',
    })

    const transport = new FakeFrameTransport()
    const host = new PluginHost({
      transport,
      fetchImpl: vi.fn(async () => jsonResponse(manifestJson(), MANIFEST_URL)),
      consentStore,
      digest,
      shellOrigin: SHELL_ORIGIN,
      shellVersion: '0.1.0',
      now: () => 1,
      createSessionId: () => 'session-1',
    })

    const providers = [provider(), provider()]
    const runtime = new WorkspaceRuntime({
      providerFactory: () => {
        const next = providers.shift()
        if (!next) throw new Error('No provider queued')
        return next
      },
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginHost: host,
    })
    await runtime.start()
    await runtime.openFolder()
    await waitForPhase(host, 'registering')
    const firstFrame = transport.frames[0]
    ready(firstFrame)
    await waitForPhase(host, 'active')
    expect(host.match('/a.ts')).toHaveLength(1)

    await runtime.openFolder()
    await waitForPhase(host, 'registering')
    expect(firstFrame.closed).toBe(true)
    expect(host.getSnapshot().consentRequest).toBeNull()
    expect(consentStore.get('https://plugins.example.com', 'com.example.monaco')).not.toBeNull()

    const secondFrame = transport.frames.find((frame) => frame !== firstFrame)
    if (!secondFrame) throw new Error('second frame missing')
    ready(secondFrame)
    await waitForPhase(host, 'active')
    expect(host.match('/a.ts')).toHaveLength(1)

    await runtime.dispose()
  })
})
