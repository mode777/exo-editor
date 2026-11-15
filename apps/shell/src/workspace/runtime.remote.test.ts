import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from './runtime'
import { MemoryWorkspaceProvider } from './providers/memory'
import { MemoryHandleStore } from './providers/folder/handle-store'
import { MemoryActiveWorkspaceStore } from './providers/active-store'
import { MemoryConnectionStore } from './providers/stratofold/connection-store'
import {
  FAKE_TOKEN,
  FakeStratofoldServer,
  FAKE_BASE_URL,
  FAKE_VDIR,
} from './providers/stratofold/fake-server'
import { stratofoldWorkspaceId } from './providers/stratofold/provider'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { EXO_CONFIG_PATH } from '../plugins/config'

function memoryProvider(files: Record<string, string> = {}) {
  return new MemoryWorkspaceProvider({ now: () => 1, initialFiles: files })
}

interface Harness {
  runtime: WorkspaceRuntime
  server: FakeStratofoldServer
  activeStore: MemoryActiveWorkspaceStore
  connectionStore: MemoryConnectionStore
  handleStore: MemoryHandleStore
}

function harness(
  options: {
    server?: FakeStratofoldServer
    supportsFolder?: boolean
    providers?: ReturnType<typeof memoryProvider>[]
    activeStore?: MemoryActiveWorkspaceStore
    connectionStore?: MemoryConnectionStore
    handleStore?: MemoryHandleStore
  } = {},
): Harness {
  const server = options.server ?? new FakeStratofoldServer({ initialFiles: { 'a.txt': 'one' } })
  const activeStore = options.activeStore ?? new MemoryActiveWorkspaceStore()
  const connectionStore = options.connectionStore ?? new MemoryConnectionStore()
  const handleStore = options.handleStore ?? new MemoryHandleStore()
  const providers = options.providers
    ? [...options.providers]
    : [memoryProvider({ '/a.txt': 'one' })]

  const runtime = new WorkspaceRuntime({
    providerFactory: () => {
      const next = providers.shift()
      if (!next) return memoryProvider({ '/a.txt': 'one' })
      return next
    },
    supportsFolder: () => options.supportsFolder ?? true,
    handleStore,
    activeStore,
    connectionStore,
    connectSeams: { fetch: server.fetch, createXhr: server.createXhr },
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  return { runtime, server, activeStore, connectionStore, handleStore }
}

const REMOTE_ID = stratofoldWorkspaceId({
  server: FAKE_BASE_URL,
  vdir: FAKE_VDIR,
  name: 'demo',
  role: 'editor',
  token: FAKE_TOKEN,
})

describe('workspace runtime remote workspaces', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  it('connects, browses, edits and saves a remote workspace', async () => {
    const { runtime, server } = harness()
    await runtime.start()

    expect(
      await runtime.connectRemote(
        { server: server.baseUrl, token: FAKE_TOKEN },
        { remember: true },
      ),
    ).toBe(true)

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      writable: true,
      descriptor: { providerKind: 'stratofold', name: 'demo' },
      remote: {
        server: server.baseUrl,
        vdir: FAKE_VDIR,
        name: 'demo',
        role: 'editor',
        remembered: true,
        rejected: false,
      },
    })

    runtime.openDocument('/a.txt')
    expect(await runtime.documents.open('/a.txt')).toMatchObject({ status: 'ready', text: 'one' })
    runtime.documents.updateText('/a.txt', 'edited')
    expect(await runtime.documents.save('/a.txt')).toBe(true)
    expect(server.readText('a.txt')).toBe('edited')
    await runtime.dispose()
  })

  it('restores a remembered connection after a reload', async () => {
    const first = harness()
    await first.runtime.start()
    await first.runtime.connectRemote(
      { server: first.server.baseUrl, token: FAKE_TOKEN },
      { remember: true },
    )
    await first.runtime.dispose()

    const second = harness({
      server: first.server,
      activeStore: first.activeStore,
      connectionStore: first.connectionStore,
    })
    await second.runtime.start()

    expect(second.runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      descriptor: { id: REMOTE_ID },
      remote: { vdir: FAKE_VDIR, remembered: true, rejected: false },
    })
    await second.runtime.dispose()
  })

  it('does not restore a session-only connection after a reload', async () => {
    const first = harness()
    await first.runtime.start()
    await first.runtime.connectRemote(
      { server: first.server.baseUrl, token: FAKE_TOKEN },
      { remember: false },
    )
    expect(first.runtime.getSnapshot().remote).toMatchObject({ remembered: false })
    await first.runtime.dispose()

    const second = harness({
      server: first.server,
      activeStore: first.activeStore,
      connectionStore: first.connectionStore,
    })
    await second.runtime.start()

    expect(second.runtime.getSnapshot().phase).toBe('no-workspace')
    expect(await first.connectionStore.get()).toBeNull()
    await second.runtime.dispose()
  })

  it('presents the reconnect state when a remembered credential was revoked', async () => {
    const first = harness()
    await first.runtime.start()
    await first.runtime.connectRemote(
      { server: first.server.baseUrl, token: FAKE_TOKEN },
      { remember: true },
    )
    await first.runtime.dispose()

    first.server.failNext(401)
    const second = harness({
      server: first.server,
      activeStore: first.activeStore,
      connectionStore: first.connectionStore,
    })
    await second.runtime.start()

    expect(second.runtime.getSnapshot()).toMatchObject({
      phase: 'no-workspace',
      remote: { vdir: FAKE_VDIR, remembered: true, rejected: true },
      remoteError: { code: 'unauthorized' },
    })
    await second.runtime.dispose()
  })

  it('refuses a stored connection that resolves to another directory', async () => {
    const activeStore = new MemoryActiveWorkspaceStore()
    const connectionStore = new MemoryConnectionStore()
    await connectionStore.put({
      id: 'stratofold:https://other.test:other-vdir',
      connection: {
        server: FAKE_BASE_URL,
        vdir: 'other-vdir',
        name: 'other',
        role: 'editor',
        token: FAKE_TOKEN,
      },
    })
    await activeStore.put({ kind: 'stratofold', id: 'stratofold:https://other.test:other-vdir' })

    const { runtime } = harness({ activeStore, connectionStore })
    await runtime.start()

    expect(runtime.getSnapshot().phase).toBe('no-workspace')
    expect(runtime.getSnapshot().remoteError?.code).toMatch(/not-found|mismatch|unauthorized/)
    expect(runtime.getSession()).toBeNull()
    await runtime.dispose()
  })

  it('opens a remote workspace when the browser cannot open folders', async () => {
    const { runtime, server } = harness({ supportsFolder: false })
    await runtime.start()
    expect(runtime.getSnapshot().phase).toBe('unsupported')

    expect(await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({ phase: 'ready', writable: true })
    await runtime.dispose()
  })

  it('keeps the open workspace when a new connection fails validation', async () => {
    const { runtime, server } = harness()
    await runtime.start()
    await runtime.openFolder()
    const generation = runtime.getSnapshot().generation
    runtime.openDocument('/a.txt')
    await runtime.documents.open('/a.txt')

    server.failNext(401)
    const connected = await runtime.connectRemote({
      server: server.baseUrl,
      token: 'sf_v1_wrong',
    })

    expect(connected).toBe(false)
    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      generation,
      descriptor: { providerKind: 'memory' },
      remoteError: { code: 'unauthorized' },
    })
    expect(useWorkbenchStore.getState().tabs).toHaveLength(1)
    await runtime.dispose()
  })

  it('resets workspace-scoped state when switching from a folder to a remote workspace', async () => {
    const { runtime, server } = harness({
      providers: [
        memoryProvider({
          '/a.txt': 'one',
          [EXO_CONFIG_PATH]:
            '{"schemaVersion":1,"plugins":[{"manifest":"https://first.example/m.json"}]}',
        }),
      ],
    })
    await runtime.start()
    await runtime.openFolder()
    runtime.openDocument('/a.txt')
    await runtime.documents.open('/a.txt')
    const generation = runtime.getSnapshot().generation

    await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })

    expect(runtime.getSnapshot().generation).toBeGreaterThan(generation)
    expect(runtime.getSnapshot().selection).toBeNull()
    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(runtime.documents.paths()).toEqual([])
    expect(runtime.pluginHost.getSnapshot().records).toEqual([])
    expect(runtime.pluginConfig.getSnapshot().entries ?? []).toEqual([])
    await runtime.dispose()
  })

  it('marks the connection rejected mid-session without dropping open tabs', async () => {
    const { runtime, server } = harness()
    await runtime.start()
    await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })
    runtime.openDocument('/a.txt')
    await runtime.documents.open('/a.txt')

    server.failNext(401)
    await expect(runtime.getSession()?.stat('/a.txt')).rejects.toMatchObject({
      code: 'permission-denied',
    })

    expect(runtime.getSnapshot().remote).toMatchObject({ rejected: true })
    expect(runtime.getSnapshot().phase).toBe('ready')
    expect(useWorkbenchStore.getState().tabs).toHaveLength(1)
    await runtime.dispose()
  })

  it('disconnects, forgetting the workspace and its credential', async () => {
    const { runtime, server, activeStore, connectionStore } = harness()
    await runtime.start()
    await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN }, { remember: true })

    await runtime.disconnect()

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'no-workspace',
      writable: false,
      restoreAvailable: false,
    })
    expect(runtime.getSnapshot().remote).toBeUndefined()
    expect(runtime.getSession()).toBeNull()
    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(await activeStore.get()).toBeNull()
    expect(await connectionStore.get()).toBeNull()
    await runtime.dispose()
  })
})

describe('remote workspace plugin boundary', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  it('denies reserved paths to plugins while the shell may read them', async () => {
    const server = new FakeStratofoldServer({
      initialFiles: {
        'a.txt': 'one',
        'exo.json': '{"schemaVersion":1,"plugins":[]}',
        '.exo/state.json': '{"secret":true}',
      },
    })
    const { runtime } = harness({ server })
    await runtime.start()
    await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })

    const session = runtime.getSession()
    expect(session).not.toBeNull()
    const facade = session!.forPlugin('plugin-1')

    await expect(facade.read('/exo.json')).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(facade.write('/exo.json', new TextEncoder().encode('{}'))).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(facade.read('/.exo/state.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    const listing = await facade.list('/')
    expect(listing.map((entry) => entry.path)).not.toContain('/exo.json')
    expect(listing.map((entry) => entry.path)).not.toContain('/.exo')

    // The shell itself still owns the configuration path.
    expect(new TextDecoder().decode(await session!.read('/exo.json'))).toContain('schemaVersion')

    // The credential is absent from everything a plugin or the UI can observe.
    for (const observed of [
      runtime.getSnapshot(),
      runtime.pluginHost.getSnapshot(),
      runtime.pluginConfig.getSnapshot(),
    ]) {
      expect(JSON.stringify(observed)).not.toContain(FAKE_TOKEN)
    }
    await runtime.dispose()
  })
})
