import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import { WorkspaceRuntime } from './runtime'
import { MemoryWorkspaceProvider } from './providers/memory'
import { MemoryHandleStore } from './providers/folder/handle-store'
import {
  WorkspaceError,
  type FileStat,
  type WorkspaceProvider,
  type WorkspacePath,
} from './contract'
import { clearWorkspaceTabs, configurePresetStore } from '../workbench/tabs'
import { EXO_CONFIG_PATH } from '../plugins/config'
import { HandlerPool } from '../plugins/handlers'
import type { HandlerSaveRequest } from '../plugins/handler'
import type { EditorCandidate } from '../plugins/registry'
import { MemoryPluginSettingsStorage } from '../plugins/settings'
import type { PluginSettingsStorage, RawSettingsByPlugin } from '../plugins/settings'
import { FakeFrameTransport } from '../plugins/frame-test-support'
import type { ManifestConfiguration } from '../plugins/manifest'
import type { DocumentEditorHost, PluginCallbacks } from './documents'

function memoryProvider(files: Record<string, string> = {}) {
  return new MemoryWorkspaceProvider({ now: () => 1, initialFiles: files })
}

function handlerCandidate(): EditorCandidate {
  return {
    identity: 'https://plugins.example.com::com.example.code',
    pluginOrder: 0,
    pluginName: 'Code Plugin',
    pluginId: 'com.example.code',
    pluginVersion: '1.0.0',
    origin: 'https://plugins.example.com',
    permissions: ['workspace:read', 'workspace:write', 'events:subscribe'],
    glob: '**/*.txt',
    entry: 'editors/code.html',
    entryUrl: 'https://plugins.example.com/monaco/editors/code.html',
    label: 'Code',
    priority: 10,
    registrationOrder: 0,
  }
}

function settingsConfiguration(): ManifestConfiguration {
  return {
    properties: {
      'editor.greeting': { type: 'string', default: 'hello', scope: 'workspace' },
    },
  }
}

class DeferredSettingsStorage implements PluginSettingsStorage {
  readonly reads = new Map<string, (value: RawSettingsByPlugin | null) => void>()

  async get(workspaceId: string): Promise<RawSettingsByPlugin | null> {
    return new Promise((resolve) => {
      this.reads.set(workspaceId, resolve)
    })
  }

  async put(): Promise<void> {
    // The late-read test does not persist.
  }
}

function runtimeWith(providers: WorkspaceProvider[], handleStore = new MemoryHandleStore()) {
  return new WorkspaceRuntime({
    providerFactory: () => {
      const next = providers.shift()
      if (!next) throw new Error('No provider queued')
      return next
    },
    supportsFolder: () => true,
    handleStore,
    eventTarget: new EventTarget(),
    now: () => 1,
  })
}

function runtimeWithSettings(
  providers: WorkspaceProvider[],
  pluginSettingsStorage: PluginSettingsStorage,
) {
  return new WorkspaceRuntime({
    providerFactory: () => {
      const next = providers.shift()
      if (!next) throw new Error('No provider queued')
      return next
    },
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => 1,
    pluginSettingsStorage,
  })
}

describe('workspace runtime', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  it('starts with no workspace when no handle is stored', async () => {
    const runtime = runtimeWith([memoryProvider()])
    await runtime.start()

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'no-workspace',
      restoreAvailable: false,
    })
    await runtime.dispose()
  })

  it('opens a folder, opens a document and saves through the session', async () => {
    const provider = memoryProvider({ '/a.txt': 'one' })
    const runtime = runtimeWith([provider])
    await runtime.start()
    await runtime.openFolder()

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      writable: true,
    })
    expect(runtime.getSnapshot().descriptor?.name).toBe('memory-workspace')

    runtime.openDocument('/a.txt')
    const document = await runtime.documents.open('/a.txt')
    expect(document).toMatchObject({ status: 'ready', text: 'one' })

    runtime.documents.updateText('/a.txt', 'edited')
    expect(await runtime.documents.save('/a.txt')).toBe(true)
    expect(
      new TextDecoder().decode(await provider.open().then((handle) => handle.read('/a.txt'))),
    ).toBe('edited')
    await runtime.dispose()
  })

  it('switches workspaces and clears tabs, documents and selection', async () => {
    const first = memoryProvider({ '/a.txt': 'one' })
    const second = memoryProvider({ '/b.txt': 'two' })
    const runtime = runtimeWith([first, second])
    await runtime.start()

    await runtime.openFolder()
    runtime.setSelection('/a.txt')
    runtime.openDocument('/a.txt')
    await runtime.documents.open('/a.txt')
    const firstGeneration = runtime.getSnapshot().generation

    await runtime.openFolder()

    expect(runtime.getSnapshot().generation).toBeGreaterThan(firstGeneration)
    expect(runtime.getSnapshot().selection).toBeNull()
    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(runtime.documents.paths()).toEqual([])
    expect(runtime.getSnapshot().descriptor?.name).toBe('memory-workspace')
    await runtime.dispose()
  })

  it('closes a pending file picker before a workspace switch', async () => {
    const first = memoryProvider({ '/a.txt': 'one' })
    const second = memoryProvider({ '/b.txt': 'two' })
    const runtime = runtimeWith([first, second])
    await runtime.start()
    await runtime.openFolder()
    const session = runtime.getSession()
    if (!session) throw new Error('No workspace session')

    const pending = runtime.filePicker.request({
      path: '/a.txt',
      pluginId: 'com.example.code',
      pluginName: 'Code Plugin',
      multiple: false,
      session,
      signal: new AbortController().signal,
    })
    expect(runtime.filePicker.getSnapshot()).not.toBeNull()

    await runtime.openFolder()
    await expect(pending).resolves.toEqual({ ok: false, silent: true })
    expect(runtime.filePicker.getSnapshot()).toBeNull()
    await runtime.dispose()
  })

  it('delivers settings changes to subscribed handlers and initializes later handlers', async () => {
    const provider = memoryProvider({ '/a.txt': 'a', '/b.txt': 'b' })
    const transport = new FakeFrameTransport()
    const pool = new HandlerPool({
      transport,
      shellOrigin: 'https://editor.example.com',
      shellVersion: '0.1.0',
      theme: () => 'dark',
      locale: 'en',
      createSessionId: () => 'session-1',
    })
    const runtime = new WorkspaceRuntime({
      providerFactory: () => provider,
      supportsFolder: () => true,
      handleStore: new MemoryHandleStore(),
      eventTarget: new EventTarget(),
      now: () => 1,
      pluginSettingsStorage: new MemoryPluginSettingsStorage(),
      handlerPool: pool,
    })
    await runtime.start()
    await runtime.openFolder()

    const candidate = handlerCandidate()
    runtime.pluginSettings.declare(candidate.identity, settingsConfiguration())
    const session = runtime.getSession()
    if (!session) throw new Error('No workspace session')
    const callbacks = {
      onActive: vi.fn(),
      onDirty: vi.fn(),
      onFailure: vi.fn(),
      onVersion: vi.fn(),
    }
    const firstStat = await session.stat('/a.txt')
    expect(pool.open({ path: '/a.txt', file: firstStat, candidate }, callbacks)).toEqual({
      ok: true,
    })
    const first = transport.frames[0]
    const ready = (frame: (typeof transport.frames)[number]) =>
      frame.emit(
        { exo: 1, type: 'plugin/ready', payload: { protocolVersion: '1', sessionId: 'session-1' } },
        'https://plugins.example.com',
      )
    const events = (frame: (typeof transport.frames)[number]) =>
      frame.posted
        .map((posted) => posted.message as { type?: string; payload?: unknown })
        .filter((message) => message.type === 'shell/event')
        .map((message) => message.payload)

    ready(first)
    first.emit(
      {
        exo: 1,
        type: 'plugin/subscribe',
        id: 'sub-config',
        payload: { topic: 'config/changed' },
      },
      'https://plugins.example.com',
    )
    expect(runtime.pluginSettings.set(candidate.identity, 'editor.greeting', 'hi')).toEqual({
      ok: true,
      changed: true,
    })
    await vi.waitFor(() => expect(events(first)).toHaveLength(1))
    expect(events(first)[0]).toMatchObject({
      topic: 'config/changed',
      payload: { pluginId: 'com.example.code', values: { 'editor.greeting': 'hi' } },
    })

    const secondStat = await session.stat('/b.txt')
    expect(pool.open({ path: '/b.txt', file: secondStat, candidate }, callbacks)).toEqual({
      ok: true,
    })
    const second = transport.frames[1]
    ready(second)
    const init = second.posted
      .map((posted) => posted.message as { type?: string; payload?: unknown })
      .find((message) => message.type === 'shell/init')
    expect(init?.payload).toMatchObject({ settings: { 'editor.greeting': 'hi' } })

    await runtime.dispose()
  })

  it('persists settings for the same workspace and resets them on a switch', async () => {
    const storage = new MemoryPluginSettingsStorage()
    const identity = handlerCandidate().identity
    const configuration = settingsConfiguration()
    const first = new MemoryWorkspaceProvider({ name: 'first', now: () => 1 })
    const second = new MemoryWorkspaceProvider({ name: 'second', now: () => 1 })
    const runtime = runtimeWithSettings([first, second], storage)
    await runtime.start()
    await runtime.openFolder()
    runtime.pluginSettings.declare(identity, configuration)
    runtime.pluginSettings.set(identity, 'editor.greeting', 'first value')
    await vi.waitFor(() =>
      expect(storage.records.get('memory:first')).toEqual({
        [identity]: { 'editor.greeting': 'first value' },
      }),
    )

    await runtime.openFolder()
    runtime.pluginSettings.declare(identity, configuration)
    expect(runtime.pluginSettings.values(identity)).toEqual({ 'editor.greeting': 'hello' })
    await runtime.dispose()

    const reloadedProvider = new MemoryWorkspaceProvider({ name: 'first', now: () => 1 })
    const reloaded = runtimeWithSettings([reloadedProvider], storage)
    await reloaded.start()
    await reloaded.openFolder()
    reloaded.pluginSettings.declare(identity, configuration)
    expect(reloaded.pluginSettings.values(identity)).toEqual({
      'editor.greeting': 'first value',
    })
    await reloaded.dispose()
  })

  it('ignores a settings read that resolves after a workspace switch', async () => {
    const storage = new DeferredSettingsStorage()
    const first = new MemoryWorkspaceProvider({ name: 'first', now: () => 1 })
    const second = new MemoryWorkspaceProvider({ name: 'second', now: () => 1 })
    const runtime = runtimeWithSettings([first, second], storage)
    await runtime.start()

    const firstOpen = runtime.openFolder()
    await vi.waitFor(() => expect(storage.reads.has('memory:first')).toBe(true))
    const secondOpen = runtime.openFolder()
    await vi.waitFor(() => expect(storage.reads.has('memory:second')).toBe(true))

    storage.reads.get('memory:first')?.({
      [handlerCandidate().identity]: { 'editor.greeting': 'first value' },
    })
    await firstOpen
    storage.reads.get('memory:second')?.({
      [handlerCandidate().identity]: { 'editor.greeting': 'second value' },
    })
    await secondOpen

    expect(runtime.getSnapshot().descriptor?.name).toBe('second')
    runtime.pluginSettings.declare(handlerCandidate().identity, settingsConfiguration())
    expect(runtime.pluginSettings.values(handlerCandidate().identity)).toEqual({
      'editor.greeting': 'second value',
    })
    await runtime.dispose()
  })

  it('keeps the old workspace when the picker is cancelled', async () => {
    const first = memoryProvider({ '/a.txt': 'one' })
    const cancelled: WorkspaceProvider = {
      kind: 'memory',
      label: 'Memory workspace',
      capabilities: () => first.capabilities(),
      open: async () => {
        throw new WorkspaceError('aborted', 'cancelled')
      },
      dispose: () => undefined,
    }
    const runtime = runtimeWith([first, cancelled])
    await runtime.start()
    await runtime.openFolder()
    const generation = runtime.getSnapshot().generation

    await runtime.openFolder()

    expect(runtime.getSnapshot()).toMatchObject({ phase: 'ready' })
    expect(runtime.getSnapshot().generation).toBe(generation)
    await runtime.dispose()
  })

  it('reports a picker failure without disposing the old workspace', async () => {
    const first = memoryProvider({ '/a.txt': 'one' })
    const failed: WorkspaceProvider = {
      kind: 'memory',
      label: 'Memory workspace',
      capabilities: () => first.capabilities(),
      open: async () => {
        throw new WorkspaceError('permission-denied', 'blocked')
      },
      dispose: () => undefined,
    }
    const runtime = runtimeWith([first, failed])
    await runtime.start()
    await runtime.openFolder()
    const generation = runtime.getSnapshot().generation

    await runtime.openFolder()

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'ready',
      generation,
      error: { code: 'permission-denied' },
    })
    await runtime.dispose()
  })

  it('restores a stored workspace during start', async () => {
    const provider = memoryProvider({ '/a.txt': 'one' })
    const handle = await provider.open()
    const handleStore = new MemoryHandleStore()
    await handleStore.put({
      id: handle.descriptor.id,
      name: handle.descriptor.name,
      handle: {} as FileSystemDirectoryHandle,
    })
    const restoring: WorkspaceProvider = {
      kind: provider.kind,
      label: provider.label,
      capabilities: () => provider.capabilities(),
      open: () => provider.open(),
      restore: async () => handle,
      dispose: () => provider.dispose(),
    }
    const runtime = runtimeWith([restoring], handleStore)

    await runtime.start()

    expect(runtime.getSnapshot()).toMatchObject({ phase: 'ready', writable: true })
    expect(runtime.getSnapshot().descriptor?.id).toBe(handle.descriptor.id)
    await runtime.dispose()
  })

  it('reports a missing restored handle as no workspace', async () => {
    const provider = memoryProvider()
    const restoring: WorkspaceProvider = {
      kind: provider.kind,
      label: provider.label,
      capabilities: () => provider.capabilities(),
      open: () => provider.open(),
      restore: async () => null,
      dispose: () => provider.dispose(),
    }
    const handleStore = new MemoryHandleStore()
    await handleStore.put({
      id: 'memory:missing',
      name: 'missing',
      handle: {} as FileSystemDirectoryHandle,
    })
    const runtime = runtimeWith([restoring], handleStore)

    await runtime.start()

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'no-workspace',
      restoreAvailable: true,
      error: { code: 'not-found' },
    })
    await runtime.dispose()
  })

  it('republishes capabilities after a permission grant', async () => {
    const base = new MemoryWorkspaceProvider({ writable: false })
    const provider: WorkspaceProvider = {
      kind: base.kind,
      label: base.label,
      capabilities: () => base.capabilities(),
      open: async () => {
        const handle = await base.open()
        handle.requestPermission = async () => ({
          ...base.capabilities(),
          writable: true,
        })
        return handle
      },
      dispose: () => base.dispose(),
    }
    const runtime = runtimeWith([provider])
    await runtime.start()
    await runtime.openFolder()
    expect(runtime.getSnapshot().writable).toBe(false)

    await runtime.requestPermission()

    expect(runtime.getSnapshot()).toMatchObject({
      writable: true,
      capabilities: { writable: true },
    })
    await runtime.dispose()
  })

  it('marks unsupported browsers explicitly', async () => {
    const runtime = new WorkspaceRuntime({
      providerFactory: () => memoryProvider(),
      supportsFolder: () => false,
      handleStore: new MemoryHandleStore(),
    })

    await runtime.start()

    expect(runtime.getSnapshot()).toMatchObject({
      phase: 'unsupported',
      writable: false,
    })
    await runtime.dispose()
  })

  it('loads the plugin declaration after a workspace becomes ready', async () => {
    const runtime = runtimeWith([
      memoryProvider({
        [EXO_CONFIG_PATH]:
          '{"schemaVersion":1,"plugins":[{"manifest":"https://example.com/m.json"}]}',
      }),
    ])
    await runtime.start()
    await runtime.openFolder()

    await vi.waitFor(() =>
      expect(runtime.pluginConfig.getSnapshot()).toMatchObject({
        status: 'valid',
        entries: [{ index: 0, manifest: 'https://example.com/m.json', enabled: true }],
      }),
    )
    await runtime.dispose()
  })

  it('resets plugin configuration on a workspace switch', async () => {
    const first = memoryProvider({
      [EXO_CONFIG_PATH]:
        '{"schemaVersion":1,"plugins":[{"manifest":"https://first.example/m.json"}]}',
    })
    const second = memoryProvider({
      [EXO_CONFIG_PATH]:
        '{"schemaVersion":1,"plugins":[{"manifest":"https://second.example/m.json"}]}',
    })
    const runtime = runtimeWith([first, second])
    await runtime.start()
    await runtime.openFolder()
    await vi.waitFor(() =>
      expect(runtime.pluginConfig.getSnapshot().entries[0]?.manifest).toBe(
        'https://first.example/m.json',
      ),
    )

    await runtime.openFolder()

    await vi.waitFor(() =>
      expect(runtime.pluginConfig.getSnapshot().entries).toEqual([
        { index: 0, manifest: 'https://second.example/m.json', enabled: true },
      ]),
    )
    await runtime.dispose()
  })

  it('routes reserved document paths to the handler without creating a tab', async () => {
    const runtime = runtimeWith([memoryProvider({ '/a.txt': 'one' })])
    await runtime.start()
    await runtime.openFolder()
    const handler = vi.fn()
    runtime.setReservedDocumentHandler(handler)

    runtime.openDocument(EXO_CONFIG_PATH)
    runtime.openDocument('/.exo/state.json')

    expect(handler).toHaveBeenCalledWith(EXO_CONFIG_PATH)
    expect(handler).toHaveBeenCalledWith('/.exo/state.json')
    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(runtime.documents.paths()).toEqual([])
    await runtime.dispose()
  })
})

class RecordingPool implements DocumentEditorHost {
  readonly published: Array<{ topic: string; payload: unknown }> = []
  readonly lifecycle: string[] = []

  candidates(): EditorCandidate[] {
    return []
  }
  open(
    input: { path: WorkspacePath; file: FileStat; candidate: EditorCandidate },
    callbacks: PluginCallbacks,
  ) {
    void input
    void callbacks
    return { ok: false, reason: 'failed' } as const
  }
  close(): void {}
  save(): Promise<HandlerSaveRequest> {
    return Promise.resolve({ ok: false, code: 'internal' })
  }
  completeSave(): void {}
  notifyChange(): void {}
  rename(): void {}
  dirtySequence(): number {
    return 0
  }
  attach(): void {
    this.lifecycle.push('attach')
  }
  async detach(): Promise<void> {
    this.lifecycle.push('detach')
  }
  publish(topic: string, payload: unknown): boolean {
    this.published.push({ topic, payload })
    return true
  }
  publishWorkspaceClosed(reason: 'switch' | 'close'): void {
    this.lifecycle.push('closed')
    this.published.push({ topic: 'workspace/closed', payload: { reason } })
  }
  disposeTransport(): void {}
}

function eventRuntime(providers: WorkspaceProvider[], pool: RecordingPool) {
  return new WorkspaceRuntime({
    providerFactory: () => {
      const next = providers.shift()
      if (!next) throw new Error('No provider queued')
      return next
    },
    supportsFolder: () => true,
    handleStore: new MemoryHandleStore(),
    eventTarget: new EventTarget(),
    now: () => Date.now(),
    handlerPool: pool as unknown as HandlerPool,
  })
}

describe('workspace events', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  it('publishes one coalesced file event for a shell save', async () => {
    vi.useFakeTimers()
    const pool = new RecordingPool()
    const provider = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { '/a.txt': 'one' },
      watchable: true,
    })
    const runtime = eventRuntime([provider], pool)
    await runtime.start()
    await runtime.openFolder()
    await runtime.documents.open('/a.txt')
    runtime.documents.updateText('/a.txt', 'edited')
    expect(await runtime.documents.save('/a.txt')).toBe(true)

    await vi.advanceTimersByTimeAsync(60)
    expect(pool.published.filter((event) => event.topic === 'workspace/file-changed')).toHaveLength(
      1,
    )
    expect(pool.published.at(-1)).toMatchObject({
      topic: 'workspace/file-changed',
      payload: { path: '/a.txt', kind: 'changed' },
    })
    vi.useRealTimers()
    await runtime.dispose()
  })

  it('publishes an external change and one rename on the new path', async () => {
    vi.useFakeTimers()
    const pool = new RecordingPool()
    const provider = new MemoryWorkspaceProvider({
      now: () => 1,
      initialFiles: { '/a.txt': 'one', '/b.txt': 'two' },
      watchable: true,
    })
    const runtime = eventRuntime([provider], pool)
    await runtime.start()
    await runtime.openFolder()
    await runtime.documents.open('/a.txt')

    const handle = await provider.open()
    await handle.write('/a.txt', new TextEncoder().encode('external'))
    await vi.advanceTimersByTimeAsync(60)
    expect(pool.published.at(-1)).toMatchObject({
      topic: 'workspace/file-changed',
      payload: { path: '/a.txt', kind: 'changed' },
    })

    pool.published.length = 0
    const stat = await handle.stat('/a.txt')
    runtime.renameOpenPath('/a.txt', '/renamed.txt', { ...stat, path: '/renamed.txt' })
    await vi.advanceTimersByTimeAsync(60)
    expect(pool.published).toEqual([
      {
        topic: 'workspace/file-changed',
        payload: { path: '/renamed.txt', kind: 'renamed', version: stat.version },
      },
    ])
    vi.useRealTimers()
    await runtime.dispose()
  })

  it('publishes the theme change', async () => {
    const pool = new RecordingPool()
    const runtime = eventRuntime([memoryProvider()], pool)
    await runtime.start()

    runtime.publishTheme('light')

    expect(pool.published).toEqual([{ topic: 'theme/changed', payload: { theme: 'light' } }])
    await runtime.dispose()
  })

  it('announces close and switch before detaching handlers', async () => {
    const pool = new RecordingPool()
    const first = memoryProvider({ '/a.txt': 'one' })
    const second = memoryProvider({ '/b.txt': 'two' })
    const runtime = eventRuntime([first, second], pool)
    await runtime.start()
    await runtime.openFolder()

    await runtime.openFolder()
    expect(pool.lifecycle.slice(-3)).toEqual(['closed', 'detach', 'attach'])
    expect(pool.published.at(-1)).toMatchObject({
      topic: 'workspace/closed',
      payload: { reason: 'switch' },
    })

    pool.lifecycle.length = 0
    await runtime.disconnect()
    expect(pool.lifecycle.slice(-2)).toEqual(['closed', 'detach'])
    expect(pool.published.at(-1)).toMatchObject({
      topic: 'workspace/closed',
      payload: { reason: 'close' },
    })
    await runtime.dispose()
  })
})
