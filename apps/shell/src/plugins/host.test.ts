import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceSession } from '../workspace/contract'
import { ConsentStore, computeFingerprint, type ConsentStorage, type Digest } from './consent'
import { FakeFrameTransport } from './frame-test-support'
import { PluginHost } from './host'
import { validateManifest, type PluginManifest } from './manifest'
import type { PluginConfigEntry } from './config'
import type { PluginConfigSnapshot, PluginConfigStore } from './store'
import { MemoryPluginSettingsStorage, PluginSettingsStore } from './settings'

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

class FakeConfig {
  private snapshot: PluginConfigSnapshot = {
    status: 'idle',
    path: '/exo.json',
    version: null,
    text: null,
    entries: [],
    issues: [],
    busy: false,
    revision: 0,
  }
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): PluginConfigSnapshot => this.snapshot

  setEntries(entries: PluginConfigEntry[]): void {
    this.set({ status: 'valid', entries, issues: [], busy: false })
  }

  setStatus(status: 'idle' | 'loading' | 'absent' | 'valid' | 'invalid'): void {
    this.set({ status, entries: status === 'valid' ? this.snapshot.entries : [] })
  }

  private set(partial: Partial<PluginConfigSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial, revision: this.snapshot.revision + 1 }
    for (const listener of [...this.listeners]) listener()
  }
}

function manifestJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  }
}

function jsonResponse(body: unknown, url: string): Response {
  const response = new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function validatedManifest(
  overrides: Record<string, unknown> = {},
  url = MANIFEST_URL,
): PluginManifest {
  const result = validateManifest(manifestJson(overrides), url, '0.1.0')
  if (!result.ok) throw new Error(`Fixture manifest is invalid: ${result.error.code}`)
  return result.manifest
}

function entries(...manifests: string[]): PluginConfigEntry[] {
  return manifests.map((manifest, index) => ({ index, manifest, enabled: true }))
}

function fakeSession(name = 'demo'): WorkspaceSession {
  return {
    descriptor: {
      id: 'test',
      name,
      providerKind: 'memory',
      capabilities: { writable: true, watchable: false, persistent: false, caseSensitive: true },
    },
    read: vi.fn(),
    forPlugin: vi.fn(),
  } as unknown as WorkspaceSession
}

function createHost(
  fetchImpl: typeof fetch = vi.fn(async () => jsonResponse(manifestJson(), MANIFEST_URL)),
  options: { consentStore?: ConsentStore; settings?: PluginSettingsStore } = {},
) {
  const transport = new FakeFrameTransport()
  const storage = new MemoryStorage()
  const consentStore = options.consentStore ?? new ConsentStore({ storage })
  const host = new PluginHost({
    transport,
    fetchImpl,
    consentStore,
    digest,
    shellOrigin: SHELL_ORIGIN,
    shellVersion: '0.1.0',
    now: () => 1000,
    createSessionId: () => 'session-1',
  })
  const config = new FakeConfig()
  host.attach({
    session: fakeSession(),
    config: config as unknown as PluginConfigStore,
    settings: options.settings,
  })
  return { host, transport, consentStore, storage, config }
}

async function waitForRecord(host: PluginHost, manifestUrl: string, phase: string): Promise<void> {
  await vi.waitFor(() => {
    const record = host.getSnapshot().records.find((entry) => entry.manifestUrl === manifestUrl)
    expect(record?.phase, `${manifestUrl} phase`).toBe(phase)
  })
}

function ready(frame: ReturnType<FakeFrameTransport['open']>, origin: string) {
  frame.emit(
    { exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId: 'session-1' } },
    origin,
  )
}

function registerAndComplete(frame: ReturnType<FakeFrameTransport['open']>, origin: string) {
  frame.emit(
    {
      exo: 1,
      type: 'plugin/register',
      payload: { fileEditors: [{ glob: '**/*.ts', entry: 'editor.html' }] },
    },
    origin,
  )
  frame.emit({ exo: 1, type: 'plugin/register-complete', payload: {} }, origin)
}

async function activate(
  host: PluginHost,
  transport: FakeFrameTransport,
  origin = 'https://plugins.example.com',
  match = 'plugins.example.com',
) {
  await vi.waitFor(() => {
    expect(transport.frames.some((frame) => frame.options.url.includes(match))).toBe(true)
  })
  const frame = transport.frames.find((candidate) => candidate.options.url.includes(match))
  if (!frame) throw new Error('Frame not found')
  ready(frame, origin)
  registerAndComplete(frame, origin)
  await vi.waitFor(() => {
    expect(host.getSnapshot().records.some((record) => record.phase === 'active')).toBe(true)
  })
}

describe('plugin host', () => {
  it('does not fetch a disabled entry', async () => {
    const fetchImpl = vi.fn()
    const { host, config } = createHost(fetchImpl)
    config.setEntries([{ index: 0, manifest: MANIFEST_URL, enabled: false }])
    await waitForRecord(host, MANIFEST_URL, 'disabled')
    expect(fetchImpl).not.toHaveBeenCalled()
    host.dispose()
  })

  it('does not fetch for an invalid or absent declaration', async () => {
    const fetchImpl = vi.fn()
    const { host, config } = createHost(fetchImpl)
    config.setStatus('invalid')
    await vi.waitFor(() => expect(host.getSnapshot().records).toEqual([]))
    config.setStatus('absent')
    await vi.waitFor(() => expect(host.getSnapshot().records).toEqual([]))
    expect(fetchImpl).not.toHaveBeenCalled()
    host.dispose()
  })

  it('exposes a validated configuration on the loaded manifest record', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        manifestJson({
          contributes: {
            configuration: {
              properties: {
                'editor.fontSize': {
                  type: 'number',
                  default: 13,
                  description: 'Font size in pixels.',
                },
              },
            },
          },
        }),
        MANIFEST_URL,
      ),
    )
    const { host, config } = createHost(fetchImpl)
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    const record = host.getSnapshot().records[0]
    expect(record.manifest?.configuration).toEqual({
      properties: {
        'editor.fontSize': {
          type: 'number',
          default: 13,
          description: 'Font size in pixels.',
          scope: 'workspace',
        },
      },
    })
    host.dispose()
  })

  it('declares configuration and sends resolved values into registration init', async () => {
    const settings = new PluginSettingsStore({ storage: new MemoryPluginSettingsStorage() })
    await settings.attach('test')
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        manifestJson({
          contributes: {
            configuration: {
              properties: {
                'editor.greeting': { type: 'string', default: 'hello' },
              },
            },
          },
        }),
        MANIFEST_URL,
      ),
    )
    const { host, transport, config } = createHost(fetchImpl, { settings })
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    const identity = 'https://plugins.example.com::com.example.monaco'
    expect(settings.values(identity)).toEqual({ 'editor.greeting': 'hello' })

    settings.set(identity, 'editor.greeting', 'hi')
    host.approveConsent(identity)
    await vi.waitFor(() => expect(transport.frames).toHaveLength(1))
    ready(transport.frames[0], 'https://plugins.example.com')
    const init = transport.frames[0].posted
      .map((posted) => posted.message as { type?: string; payload?: unknown })
      .find((message) => message.type === 'shell/init')
    expect(init?.payload).toMatchObject({ settings: { 'editor.greeting': 'hi' } })
    host.dispose()
  })

  it('does not declare settings for an invalid or disabled entry', async () => {
    const settings = new PluginSettingsStore({ storage: new MemoryPluginSettingsStorage() })
    await settings.attach('test')
    const failing = vi.fn(async () =>
      jsonResponse(
        manifestJson({
          contributes: {
            configuration: { properties: { setting: { type: 'string', default: 1 } } },
          },
        }),
        MANIFEST_URL,
      ),
    )
    const { host, config } = createHost(failing, { settings })
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'failed')
    expect(settings.values('https://plugins.example.com::com.example.monaco')).toEqual({})
    host.dispose()

    const disabledSettings = new PluginSettingsStore({
      storage: new MemoryPluginSettingsStorage(),
    })
    await disabledSettings.attach('test')
    const disabledFetch = vi.fn()
    const disabled = createHost(disabledFetch, { settings: disabledSettings })
    disabled.config.setEntries([{ index: 0, manifest: MANIFEST_URL, enabled: false }])
    await waitForRecord(disabled.host, MANIFEST_URL, 'disabled')
    expect(disabledSettings.values('https://plugins.example.com::com.example.monaco')).toEqual({})
    disabled.host.dispose()
  })

  it('loads a manifest, requests consent and activates a registered editor', async () => {
    const { host, transport, consentStore, storage, config } = createHost()
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    const pending = host.getSnapshot().consentRequest
    expect(pending).toMatchObject({
      identity: 'https://plugins.example.com::com.example.monaco',
      manifestUrl: MANIFEST_URL,
    })

    host.approveConsent(pending?.identity ?? '')
    await waitForRecord(host, MANIFEST_URL, 'registering')
    expect(storage.values.get('exo.consent.v1')).toContain('v1:')
    expect(consentStore.get('https://plugins.example.com', 'com.example.monaco')).not.toBeNull()

    await activate(host, transport)
    const record = host.getSnapshot().records[0]
    expect(record).toMatchObject({
      phase: 'active',
      consent: 'granted',
      registrations: [{ glob: '**/*.ts', label: 'Code', priority: 0 }],
    })
    expect(host.match('/src/a.ts')).toHaveLength(1)
    expect(host.getSnapshot().log.map((entry) => entry.phase)).toEqual(
      expect.arrayContaining(['manifest', 'consent', 'register']),
    )
    host.dispose()
  })

  it('skips the prompt when a matching fingerprint is persisted', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const manifest = validatedManifest()
    const fingerprint = await computeFingerprint(manifest, digest)
    consentStore.grant({
      manifestOrigin: manifest.manifestOrigin,
      pluginId: manifest.id,
      manifestUrl: manifest.manifestUrl,
      version: manifest.version,
      fingerprint,
      grantedAt: '2026-11-14T00:00:00.000Z',
    })

    const { host, transport, config } = createHost(undefined, { consentStore })
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'registering')
    expect(host.getSnapshot().consentRequest).toBeNull()
    await activate(host, transport)
    expect(host.getSnapshot().records[0].phase).toBe('active')
    host.dispose()
  })

  it('denies without mounting a frame and can be reviewed manually', async () => {
    const { host, transport, config } = createHost()
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    host.denyConsent('https://plugins.example.com::com.example.monaco')
    expect(host.getSnapshot().records[0].phase).toBe('denied')
    expect(host.getSnapshot().consentRequest).toBeNull()
    expect(transport.frames).toHaveLength(0)

    host.requestConsent('https://plugins.example.com::com.example.monaco')
    expect(host.getSnapshot().consentRequest).not.toBeNull()
    host.approveConsent('https://plugins.example.com::com.example.monaco')
    await waitForRecord(host, MANIFEST_URL, 'registering')
    expect(transport.frames).toHaveLength(1)
    host.dispose()
  })

  it('reconciles a live add and remove', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const manifest = validatedManifest()
    consentStore.grant({
      manifestOrigin: manifest.manifestOrigin,
      pluginId: manifest.id,
      manifestUrl: manifest.manifestUrl,
      version: manifest.version,
      fingerprint: await computeFingerprint(manifest, digest),
      grantedAt: '2026-11-14T00:00:00.000Z',
    })
    const { host, transport, config } = createHost(undefined, { consentStore })
    config.setEntries([])
    await vi.waitFor(() => expect(host.getSnapshot().records).toEqual([]))

    config.setEntries(entries(MANIFEST_URL))
    await activate(host, transport)
    expect(host.match('/a.ts')).toHaveLength(1)

    config.setEntries([])
    await vi.waitFor(() => expect(host.getSnapshot().records).toEqual([]))
    expect(host.match('/a.ts')).toEqual([])
    expect(transport.frames[0].closed).toBe(true)
    host.dispose()
  })

  it('reports a duplicate identity and mounts one frame', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const manifest = validatedManifest()
    consentStore.grant({
      manifestOrigin: manifest.manifestOrigin,
      pluginId: manifest.id,
      manifestUrl: manifest.manifestUrl,
      version: manifest.version,
      fingerprint: await computeFingerprint(manifest, digest),
      grantedAt: '2026-11-14T00:00:00.000Z',
    })
    const secondUrl = 'https://plugins.example.com/monaco/other-manifest.json'
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url)
      return jsonResponse(
        manifestJson({ name: target.includes('other') ? 'Other' : 'Monaco' }),
        target,
      )
    })
    const { host, transport, config } = createHost(fetchImpl as unknown as typeof fetch, {
      consentStore,
    })
    config.setEntries(entries(MANIFEST_URL, secondUrl))

    await vi.waitFor(() => {
      const records = host.getSnapshot().records
      expect(records.some((record) => record.phase === 'registering')).toBe(true)
      expect(
        records.some(
          (record) => record.phase === 'failed' && record.error?.code === 'duplicate-identity',
        ),
      ).toBe(true)
    })
    expect(transport.frames).toHaveLength(1)
    host.dispose()
  })

  it('selects by declaration order even when registrations complete in reverse', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const firstUrl = 'https://a.example.com/plugin/exo-manifest.json'
    const secondUrl = 'https://b.example.com/plugin/exo-manifest.json'
    const first = validatedManifest({ id: 'com.example.a', name: 'A' }, firstUrl)
    const second = validatedManifest({ id: 'com.example.b', name: 'B' }, secondUrl)
    for (const manifest of [first, second]) {
      consentStore.grant({
        manifestOrigin: manifest.manifestOrigin,
        pluginId: manifest.id,
        manifestUrl: manifest.manifestUrl,
        version: manifest.version,
        fingerprint: await computeFingerprint(manifest, digest),
        grantedAt: '2026-11-14T00:00:00.000Z',
      })
    }
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url)
      const body = target.includes('a.example.com')
        ? manifestJson({ id: 'com.example.a', name: 'A' })
        : manifestJson({ id: 'com.example.b', name: 'B' })
      return jsonResponse(body, target)
    })
    const { host, transport, config } = createHost(fetchImpl as unknown as typeof fetch, {
      consentStore,
    })
    config.setEntries(entries(firstUrl, secondUrl))
    await vi.waitFor(() => expect(transport.frames).toHaveLength(2))

    const firstFrame = transport.frames.find((frame) => frame.options.url.includes('a.example.com'))
    const secondFrame = transport.frames.find((frame) =>
      frame.options.url.includes('b.example.com'),
    )
    if (!firstFrame || !secondFrame) throw new Error('Frames missing')
    ready(secondFrame, 'https://b.example.com')
    registerAndComplete(secondFrame, 'https://b.example.com')
    ready(firstFrame, 'https://a.example.com')
    registerAndComplete(firstFrame, 'https://a.example.com')
    await vi.waitFor(() => {
      expect(host.getSnapshot().records.every((record) => record.phase === 'active')).toBe(true)
    })
    expect(host.match('/a.ts').map((candidate) => candidate.identity)).toEqual([
      'https://a.example.com::com.example.a',
      'https://b.example.com::com.example.b',
    ])
    host.dispose()
  })

  it('ignores a fetch that resolves after detach', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const { host, transport, config } = createHost(fetchImpl as unknown as typeof fetch)
    config.setEntries(entries(MANIFEST_URL))
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    host.detach()
    resolveFetch?.(jsonResponse(manifestJson(), MANIFEST_URL))
    await Promise.resolve()
    expect(host.getSnapshot().records).toEqual([])
    expect(transport.frames).toEqual([])
    host.dispose()
  })

  it('queues consent in declaration order and advances after a decision', async () => {
    const secondUrl = 'https://other.example.com/plugin/exo-manifest.json'
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url)
      const body = target.includes('other')
        ? manifestJson({
            id: 'com.example.other',
            name: 'Other',
            runtime: { entry: 'plugin.html' },
          })
        : manifestJson()
      return jsonResponse(body, target)
    })
    const { host, transport, config } = createHost(fetchImpl as unknown as typeof fetch)
    config.setEntries(entries(MANIFEST_URL, secondUrl))
    await vi.waitFor(() => {
      expect(host.getSnapshot().consentRequest?.manifestUrl).toBe(MANIFEST_URL)
    })
    host.approveConsent('https://plugins.example.com::com.example.monaco')
    await vi.waitFor(() => {
      expect(host.getSnapshot().consentRequest?.manifestUrl).toBe(secondUrl)
    })
    host.denyConsent('https://other.example.com::com.example.other')
    expect(host.getSnapshot().consentRequest).toBeNull()
    expect(transport.frames).toHaveLength(1)
    host.dispose()
  })

  it('re-prompts when a capability fingerprint widens', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const manifest = validatedManifest()
    consentStore.grant({
      manifestOrigin: manifest.manifestOrigin,
      pluginId: manifest.id,
      manifestUrl: manifest.manifestUrl,
      version: manifest.version,
      fingerprint: await computeFingerprint(manifest, digest),
      grantedAt: '2026-11-14T00:00:00.000Z',
    })
    let widened = false
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const target = String(url)
      return jsonResponse(
        manifestJson(
          widened
            ? { permissions: ['workspace:read', 'workspace:write'] }
            : { permissions: ['workspace:read'] },
        ),
        target,
      )
    })
    const { host, transport, config } = createHost(fetchImpl as unknown as typeof fetch, {
      consentStore,
    })
    config.setEntries(entries(MANIFEST_URL))
    await activate(host, transport)
    config.setEntries([])
    await vi.waitFor(() => expect(host.getSnapshot().records).toEqual([]))
    widened = true
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    expect(host.getSnapshot().consentRequest).not.toBeNull()
    host.dispose()
  })

  it('clears workspace state on switch but keeps consent and deny', async () => {
    const storage = new MemoryStorage()
    const consentStore = new ConsentStore({ storage })
    const manifest = validatedManifest()
    consentStore.grant({
      manifestOrigin: manifest.manifestOrigin,
      pluginId: manifest.id,
      manifestUrl: manifest.manifestUrl,
      version: manifest.version,
      fingerprint: await computeFingerprint(manifest, digest),
      grantedAt: '2026-11-14T00:00:00.000Z',
    })
    const { host, transport, config } = createHost(undefined, { consentStore })
    config.setEntries(entries(MANIFEST_URL))
    await activate(host, transport)
    const record = host.getSnapshot().records[0]
    expect(record.phase).toBe('active')

    host.detach()
    expect(host.getSnapshot()).toMatchObject({ phase: 'idle', records: [], log: [] })
    expect(consentStore.get('https://plugins.example.com', 'com.example.monaco')).not.toBeNull()

    const nextConfig = new FakeConfig()
    host.attach({
      session: fakeSession('other'),
      config: nextConfig as unknown as PluginConfigStore,
    })
    nextConfig.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'registering')
    expect(host.getSnapshot().consentRequest).toBeNull()
    host.dispose()
  })

  it('reports a fetch failure without creating a frame', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { host, transport, config } = createHost(fetchImpl as unknown as typeof fetch)
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'failed')
    expect(host.getSnapshot().records[0].error).toMatchObject({
      code: 'cors',
      phase: 'manifest',
    })
    expect(host.getSnapshot().consentRequest).toBeNull()
    expect(transport.frames).toEqual([])
    host.dispose()
  })

  it('never reads a file or builds a plugin facade during registration', async () => {
    const session = fakeSession()
    const transport = new FakeFrameTransport()
    const host = new PluginHost({
      transport,
      fetchImpl: vi.fn(async () => jsonResponse(manifestJson(), MANIFEST_URL)),
      consentStore: new ConsentStore({ storage: new MemoryStorage() }),
      digest,
      shellOrigin: SHELL_ORIGIN,
      shellVersion: '0.1.0',
      now: () => 1000,
      createSessionId: () => 'session-1',
    })
    const config = new FakeConfig()
    host.attach({ session, config: config as unknown as PluginConfigStore })
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    host.approveConsent('https://plugins.example.com::com.example.monaco')
    await waitForRecord(host, MANIFEST_URL, 'registering')
    const frame = transport.frames[0]
    ready(frame, 'https://plugins.example.com')
    registerAndComplete(frame, 'https://plugins.example.com')
    await waitForRecord(host, MANIFEST_URL, 'active')

    expect(session.read).not.toHaveBeenCalled()
    expect(session.forPlugin).not.toHaveBeenCalled()
    host.dispose()
  })

  it('closes handler sessions before dropping a disabled plugin', async () => {
    const { host, transport, config } = createHost()
    const closeFor = vi.fn()
    host.setHandlerLifecycle({ closeFor })
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    const identity = host.getSnapshot().consentRequest?.identity
    expect(identity).toBe('https://plugins.example.com::com.example.monaco')
    if (identity) host.approveConsent(identity)
    await activate(host, transport)
    expect(host.match('/src/a.ts')).toHaveLength(1)

    config.setEntries([{ index: 0, manifest: MANIFEST_URL, enabled: false }])
    await vi.waitFor(() =>
      expect(closeFor).toHaveBeenCalledWith(
        'https://plugins.example.com::com.example.monaco',
        'plugin-removed',
      ),
    )
    expect(host.match('/src/a.ts')).toEqual([])
    host.dispose()
  })

  it('records handler phases without file content', async () => {
    const { host, transport, config } = createHost()
    host.setHandlerLifecycle({ closeFor: vi.fn() })
    config.setEntries(entries(MANIFEST_URL))
    await waitForRecord(host, MANIFEST_URL, 'awaiting-consent')
    const identity = host.getSnapshot().consentRequest?.identity
    if (identity) host.approveConsent(identity)
    await activate(host, transport)
    host.logHandler(
      'https://plugins.example.com::com.example.monaco',
      'handler-save',
      'conflict',
      '/src/a.ts',
    )
    const entry = host.getSnapshot().log.at(-1)
    expect(entry).toMatchObject({
      pluginId: 'com.example.monaco',
      phase: 'handler-save',
      code: 'conflict',
      message: '/src/a.ts',
    })
    host.dispose()
  })
})
