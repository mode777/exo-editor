import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from './runtime'
import { MemoryWorkspaceProvider } from './providers/memory'
import { MemoryHandleStore } from './providers/folder/handle-store'
import { MemoryActiveWorkspaceStore } from './providers/active-store'
import {
  MemoryConnectionStore,
  type ConnectionStore,
} from './providers/stratofold/connection-store'
import {
  FAKE_TOKEN,
  FakeStratofoldServer,
  FAKE_BASE_URL,
  FAKE_VDIR,
} from './providers/stratofold/fake-server'
import { stratofoldWorkspaceId } from './providers/stratofold/provider'
import { type ConnectSeams } from './providers/stratofold/connection'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { EXO_CONFIG_PATH } from '../plugins/config'

function memoryProvider(files: Record<string, string> = {}) {
  return new MemoryWorkspaceProvider({ now: () => 1, initialFiles: files })
}

interface Harness {
  runtime: WorkspaceRuntime
  server: FakeStratofoldServer
  activeStore: MemoryActiveWorkspaceStore
  connectionStore: ConnectionStore
  handleStore: MemoryHandleStore
}

function harness(
  options: {
    server?: FakeStratofoldServer
    supportsFolder?: boolean
    providers?: ReturnType<typeof memoryProvider>[]
    activeStore?: MemoryActiveWorkspaceStore
    connectionStore?: ConnectionStore
    handleStore?: MemoryHandleStore
    connectSeams?: ConnectSeams
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
    connectSeams: options.connectSeams ?? { fetch: server.fetch, createXhr: server.createXhr },
    eventTarget: new EventTarget(),
    now: () => 1,
  })
  return { runtime, server, activeStore, connectionStore, handleStore }
}

function routedSeams(servers: FakeStratofoldServer[]): ConnectSeams {
  return {
    fetch: (input, init) => {
      const server = servers.find((candidate) => input.startsWith(candidate.baseUrl))
      if (!server) throw new TypeError(`No fake server for ${input}`)
      return server.fetch(input, init)
    },
    createXhr: () => servers[0].createXhr(),
  }
}

function idFor(server: FakeStratofoldServer, vdir = server.vdir): string {
  return stratofoldWorkspaceId({
    server: server.baseUrl,
    vdir,
    name: server.vdirName,
    role: 'editor',
  })
}

const REMOTE_ID = stratofoldWorkspaceId({
  server: FAKE_BASE_URL,
  vdir: FAKE_VDIR,
  name: 'demo',
  role: 'editor',
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

    expect(await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })).toBe(true)

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      writable: true,
      descriptor: { providerKind: 'stratofold', name: 'demo' },
      remote: {
        id: REMOTE_ID,
        server: server.baseUrl,
        vdir: FAKE_VDIR,
        name: 'demo',
        role: 'editor',
        stored: true,
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

  it('stores a public connection without a credential', async () => {
    const server = new FakeStratofoldServer({
      tokens: [],
      publicRead: true,
      initialFiles: { 'a.txt': 'one' },
    })
    const { runtime, connectionStore } = harness({ server })
    await runtime.start()

    expect(await runtime.connectRemote({ server: server.baseUrl, vdir: server.vdir })).toBe(true)

    const record = await connectionStore.get(idFor(server))
    expect(record).not.toBeNull()
    expect(record?.connection.token).toBeUndefined()
    expect(runtime.getSnapshot().remote).toMatchObject({ role: 'public', stored: true })
    await runtime.dispose()
  })

  it('restores the active recent connection after a reload', async () => {
    const first = harness()
    await first.runtime.start()
    await first.runtime.connectRemote({ server: first.server.baseUrl, token: FAKE_TOKEN })
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
      remote: { vdir: FAKE_VDIR, stored: true, rejected: false },
    })
    await second.runtime.dispose()
  })

  it('keeps a disconnected recent entry without restoring it after reload', async () => {
    const first = harness()
    await first.runtime.start()
    await first.runtime.connectRemote({ server: first.server.baseUrl, token: FAKE_TOKEN })

    await first.runtime.disconnect()

    expect(first.runtime.getSnapshot()).toMatchObject({
      phase: 'no-workspace',
      writable: false,
      restoreAvailable: false,
    })
    expect(first.runtime.getSnapshot().remote).toBeUndefined()
    expect(first.runtime.getSession()).toBeNull()
    expect(await first.activeStore.get()).toBeNull()
    expect(await first.connectionStore.get(REMOTE_ID)).not.toBeNull()
    await first.runtime.dispose()

    const second = harness({
      server: first.server,
      activeStore: first.activeStore,
      connectionStore: first.connectionStore,
    })
    await second.runtime.start()

    expect(second.runtime.getSnapshot().phase).toBe('no-workspace')
    expect(await second.runtime.listRemoteConnections()).toHaveLength(1)
    await second.runtime.dispose()
  })

  it('lists recent workspaces newest first and updates an existing entry', async () => {
    const firstServer = new FakeStratofoldServer({
      baseUrl: 'https://one.test',
      vdir: 'vdir-1',
      vdirName: 'one',
      initialFiles: { 'a.txt': 'one' },
    })
    const secondServer = new FakeStratofoldServer({
      baseUrl: 'https://two.test',
      vdir: 'vdir-2',
      vdirName: 'two',
      initialFiles: { 'a.txt': 'two' },
    })
    const { runtime } = harness({
      server: firstServer,
      connectSeams: routedSeams([firstServer, secondServer]),
    })
    await runtime.start()

    await runtime.connectRemote({ server: firstServer.baseUrl, token: FAKE_TOKEN })
    await runtime.connectRemote({ server: secondServer.baseUrl, token: FAKE_TOKEN })

    const list = await runtime.listRemoteConnections()
    expect(list.map((item) => item.name)).toEqual(['two', 'one'])
    expect(list.every((item) => item.stored)).toBe(true)
    expect(JSON.stringify(list)).not.toContain(FAKE_TOKEN)

    await runtime.connectRemote({ server: firstServer.baseUrl, token: FAKE_TOKEN })
    const updated = await runtime.listRemoteConnections()
    expect(updated.map((item) => item.name)).toEqual(['one', 'two'])
    expect(updated).toHaveLength(2)
    await runtime.dispose()
  })

  it('never puts the token in the shell-facing remote snapshot', async () => {
    const { runtime, server } = harness()
    await runtime.start()
    expect(await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })).toBe(true)

    const remote = runtime.getSnapshot().remote
    expect(remote).toBeDefined()
    expect(Object.keys(remote ?? {})).not.toContain('token')
    expect(JSON.stringify(remote)).not.toContain(FAKE_TOKEN)
    const recents = await runtime.listRemoteConnections()
    expect(recents.every((item) => !Object.keys(item).includes('token'))).toBe(true)
    expect(JSON.stringify(recents)).not.toContain(FAKE_TOKEN)
    await runtime.dispose()
  })

  it('opens a recent workspace without retyping its token', async () => {
    const { runtime, server } = harness()
    await runtime.start()
    await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })
    await runtime.disconnect()

    expect(await runtime.openRemoteRecent(REMOTE_ID)).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      remote: { id: REMOTE_ID, name: 'demo', stored: true },
    })
    await runtime.dispose()
  })

  it('reports a missing recent entry and keeps the current workspace', async () => {
    const { runtime } = harness()
    await runtime.start()
    await runtime.openFolder()
    const generation = runtime.getSnapshot().generation

    expect(await runtime.openRemoteRecent('stratofold:https://missing.test:vdir')).toBe(false)
    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      generation,
      remoteError: { code: 'not-found' },
    })
    expect(runtime.getSession()).not.toBeNull()
    await runtime.dispose()
  })

  it('removes a recent entry and disconnects when it is active', async () => {
    const firstServer = new FakeStratofoldServer({
      baseUrl: 'https://one.test',
      vdir: 'vdir-1',
      vdirName: 'one',
      initialFiles: { 'a.txt': 'one' },
    })
    const secondServer = new FakeStratofoldServer({
      baseUrl: 'https://two.test',
      vdir: 'vdir-2',
      vdirName: 'two',
      initialFiles: { 'a.txt': 'two' },
    })
    const { runtime, activeStore, connectionStore } = harness({
      server: firstServer,
      connectSeams: routedSeams([firstServer, secondServer]),
    })
    await runtime.start()
    await runtime.connectRemote({ server: firstServer.baseUrl, token: FAKE_TOKEN })
    await runtime.connectRemote({ server: secondServer.baseUrl, token: FAKE_TOKEN })

    const secondId = idFor(secondServer)
    await runtime.removeRemoteConnection(secondId)

    expect(runtime.getSnapshot()).toMatchObject({ phase: 'no-workspace' })
    expect(runtime.getSnapshot().remote).toBeUndefined()
    expect(await activeStore.get()).toBeNull()
    expect(await connectionStore.get(secondId)).toBeNull()
    expect((await runtime.listRemoteConnections()).map((item) => item.name)).toEqual(['one'])
    await runtime.dispose()
  })

  it('presents the reconnect state when a stored credential was revoked', async () => {
    const first = harness()
    await first.runtime.start()
    await first.runtime.connectRemote({ server: first.server.baseUrl, token: FAKE_TOKEN })
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
      remote: { vdir: FAKE_VDIR, stored: true, rejected: true },
      remoteError: { code: 'unauthorized' },
    })
    expect(await second.runtime.listRemoteConnections()).toHaveLength(1)
    await second.runtime.dispose()
  })

  it('refuses a stored connection that resolves to another directory', async () => {
    const activeStore = new MemoryActiveWorkspaceStore()
    const connectionStore = new MemoryConnectionStore()
    const otherId = 'stratofold:https://other.test:other-vdir'
    await connectionStore.put({
      id: otherId,
      connection: {
        server: FAKE_BASE_URL,
        vdir: 'other-vdir',
        name: 'other',
        role: 'editor',
        token: FAKE_TOKEN,
      },
      lastOpenedAt: 1,
    })
    await activeStore.put({ kind: 'stratofold', id: otherId })

    const { runtime } = harness({ activeStore, connectionStore })
    await runtime.start()

    expect(runtime.getSnapshot().phase).toBe('no-workspace')
    expect(runtime.getSnapshot().remoteError?.code).toMatch(/not-found|mismatch|unauthorized/)
    expect(runtime.getSession()).toBeNull()
    expect(await connectionStore.get(otherId)).not.toBeNull()
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

  it('keeps a session-only workspace when the connection cannot be stored', async () => {
    const failing: ConnectionStore = {
      list: async () => {
        throw new Error('storage unavailable')
      },
      get: async () => {
        throw new Error('storage unavailable')
      },
      put: async () => {
        throw new Error('storage unavailable')
      },
      remove: async () => {
        throw new Error('storage unavailable')
      },
      clear: async () => {
        throw new Error('storage unavailable')
      },
    }
    const { runtime, server } = harness({ connectionStore: failing })
    await runtime.start()

    expect(await runtime.connectRemote({ server: server.baseUrl, token: FAKE_TOKEN })).toBe(true)
    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      remote: { stored: false },
    })
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
    const recents = await runtime.listRemoteConnections()
    for (const observed of [
      runtime.getSnapshot(),
      runtime.pluginHost.getSnapshot(),
      runtime.pluginConfig.getSnapshot(),
      recents,
    ]) {
      expect(JSON.stringify(observed)).not.toContain(FAKE_TOKEN)
    }
    await runtime.dispose()
  })
})
