import { describe, expect, it, vi } from 'vitest'
import {
  connectPlugin,
  type FileChangedPayload,
  type RegistrationInit,
  type SaveResult,
} from '@exo/plugin-sdk'
import { FakePluginTransport } from '@exo/plugin-sdk/testing'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import { EventBus } from './events'
import { FakeFrameTransport, type FakeFrame } from './frame-test-support'
import { HandlerSession, type HandlerSaveRequest } from './handler'
import { validateManifest, type PluginManifest } from './manifest'
import { RegistrationSession, type RegistrationOutcome } from './registration'
import type { EditorCandidate } from './registry'

const SHELL_ORIGIN = 'https://editor.example.com'
const PLUGIN_ORIGIN = 'https://plugins.example.com'
const SESSION_ID = 'session-1'

function manifest(): PluginManifest {
  const result = validateManifest(
    {
      schemaVersion: 1,
      id: 'com.example.template',
      name: 'Exo Template',
      version: '0.1.0',
      description: 'SDK conformance template.',
      publisher: { name: 'Exo' },
      engines: { exo: '>=0.1.0' },
      runtime: { entry: 'plugin.html' },
      permissions: ['workspace:read', 'workspace:write', 'workspace:list'],
      contributes: {
        fileEditors: [
          {
            glob: '**/*.template.txt',
            entry: 'editor.html',
            label: 'Exo Template',
            priority: 50,
          },
        ],
      },
    },
    `${PLUGIN_ORIGIN}/plugin/exo-manifest.json`,
    '0.1.0',
  )
  if (!result.ok) throw new Error('test manifest did not validate')
  return result.manifest
}

function bridge(frame: FakeFrame, mode: 'register' | 'editor', sessionId = SESSION_ID) {
  const shellWindow = { name: 'shell' }
  const pluginWindow = frame.window
  const transport = new FakePluginTransport({
    hostOrigin: SHELL_ORIGIN,
    mode,
    sessionId,
    parent: shellWindow,
    onPost: (message) => {
      frame.emit(message, PLUGIN_ORIGIN, pluginWindow)
    },
  })

  const original = frame.window.postMessage.bind(frame.window)
  frame.window.postMessage = ((message: unknown, targetOrigin: string) => {
    original(message, targetOrigin)
    // Browser messages are queued; deliver asynchronously so the shell has
    // installed its dispose/listener state before the reply arrives.
    queueMicrotask(() => transport.emit(message, { origin: SHELL_ORIGIN, source: shellWindow }))
  }) as typeof frame.window.postMessage

  return transport
}

function startRegistration() {
  const transport = new FakeFrameTransport()
  const outcomes: RegistrationOutcome[] = []
  const session = new RegistrationSession({
    manifest: manifest(),
    transport,
    shellVersion: '0.1.0',
    shellOrigin: SHELL_ORIGIN,
    workspaceName: 'demo',
    theme: 'dark',
    locale: 'en',
    createSessionId: () => SESSION_ID,
    onOutcome: (outcome) => outcomes.push(outcome),
  })
  session.start()
  const frame = transport.frames[0] as FakeFrame
  return { session, frame, outcomes }
}

async function makeWorkspace(): Promise<{
  session: WorkspaceSession
  path: string
  stat: Awaited<ReturnType<WorkspaceSession['stat']>>
}> {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    initialFiles: {
      '/exo.json': '{}',
      '/notes.template.txt': 'hello',
    },
  })
  const handle = await provider.open()
  const session = new Session(handle)
  const path = '/notes.template.txt'
  const stat = await session.stat(path)
  return { session, path, stat }
}

function candidate(): EditorCandidate {
  return {
    identity: `${PLUGIN_ORIGIN}::com.example.template`,
    pluginOrder: 0,
    pluginName: 'Exo Template',
    pluginId: 'com.example.template',
    pluginVersion: '0.1.0',
    origin: PLUGIN_ORIGIN,
    permissions: ['workspace:read', 'workspace:write', 'workspace:list', 'events:subscribe'],
    glob: '**/*.template.txt',
    entry: 'editor.html',
    entryUrl: `${PLUGIN_ORIGIN}/plugin/editor.html`,
    label: 'Exo Template',
    priority: 50,
    registrationOrder: 0,
  }
}

describe('SDK conformance against the shell', () => {
  it('registers through the real RegistrationSession', async () => {
    const shell = startRegistration()
    const sdk = bridge(shell.frame, 'register')
    const connection = await connectPlugin({ transport: sdk, timeoutMs: 1000 })
    expect(connection.mode).toBe('register')
    if (connection.mode !== 'register') return

    connection.registration.register({
      glob: '**/*.template.txt',
      entry: 'editor.html',
      label: 'Exo Template',
    })
    const ack = await connection.registration.complete()
    expect(ack).toMatchObject({ accepted: ['**/*.template.txt'], rejected: [] })
    expect(shell.outcomes[0]).toMatchObject({ kind: 'active' })
    connection.close()
    shell.session.close()
  })

  it('reads, reports dirty, saves, sees an external change and disposes through the real HandlerSession', async () => {
    const workspace = await makeWorkspace()
    const transport = new FakeFrameTransport()
    const events = new EventBus()
    const dirty: boolean[] = []
    const failures: string[] = []
    const triggered: Array<Promise<HandlerSaveRequest>> = []
    const handler = new HandlerSession({
      candidate: candidate(),
      file: {
        path: workspace.path,
        name: 'notes.template.txt',
        dir: '/',
        size: workspace.stat.size,
        mtime: workspace.stat.mtime,
        version: workspace.stat.version,
      },
      session: workspace.session,
      transport,
      shellVersion: '0.1.0',
      shellOrigin: SHELL_ORIGIN,
      workspaceName: 'demo',
      theme: 'dark',
      locale: 'en',
      events,
      canWrite: true,
      maxFileSize: 10 * 1024 * 1024,
      maxRequestBytes: 16 * 1024 * 1024,
      settings: { 'template.greeting': 'hello' },
      createSessionId: () => SESSION_ID,
      onDirty: (value) => dirty.push(value),
      onSaveRequested: () => {
        triggered.push(handler.requestSave())
      },
      onRequestFiles: async () => ({ ok: true, paths: [workspace.path] }),
      onFailure: (failure) => failures.push(failure.code),
    })
    handler.start()
    const frame = transport.frames[0] as FakeFrame
    const sdk = bridge(frame, 'editor')
    const connection = await connectPlugin({ transport: sdk, timeoutMs: 1000 })
    expect(connection.mode).toBe('editor')
    if (connection.mode !== 'editor') return
    const editor = connection.editor

    expect(editor.file.path).toBe(workspace.path)
    expect(editor.file.version).toBe(workspace.stat.version)
    await expect(editor.readFile(workspace.path, 'utf8')).resolves.toMatchObject({
      path: workspace.path,
      text: 'hello',
    })
    expect(editor.capabilities.filePicker).toBe(true)
    await expect(editor.requestFiles()).resolves.toEqual([workspace.path])
    expect(editor.capabilities.directoryListing).toBe(true)
    await expect(editor.listDirectory('/')).resolves.toEqual({
      entries: [{ path: workspace.path, kind: 'file', size: workspace.stat.size }],
    })

    editor.setDirty(true)
    expect(dirty).toEqual([true])

    const saveResults: SaveResult[] = []
    editor.onSaveResult((result) => saveResults.push(result))
    editor.onSaveRequest(() => ({ text: 'hello\n[template save 1]' }))
    const save = await handler.requestSave()
    expect(save).toMatchObject({ ok: true, content: { text: 'hello\n[template save 1]' } })
    handler.completeSave({ ok: true, version: 'v2' })
    await vi.waitFor(() => expect(saveResults).toEqual([{ ok: true, version: 'v2' }]))

    editor.requestSave()
    await vi.waitFor(() => expect(triggered).toHaveLength(1))
    const triggeredSave = await triggered[0]
    expect(triggeredSave).toMatchObject({ ok: true, content: { text: 'hello\n[template save 1]' } })
    handler.completeSave({ ok: true, version: 'v3' })
    await vi.waitFor(() => expect(saveResults.at(-1)).toEqual({ ok: true, version: 'v3' }))

    const changes: FileChangedPayload[] = []
    editor.onFileChanged((change) => changes.push(change))
    handler.notifyChange({
      kind: 'changed',
      path: workspace.path,
      stat: { ...workspace.stat, version: 'v3' },
    })
    await vi.waitFor(() =>
      expect(changes).toEqual([{ path: workspace.path, kind: 'changed', version: 'v3' }]),
    )

    await handler.dispose('closed')
    expect(editor.closed).toBe(true)
    expect(failures).toEqual([])
    await workspace.session.dispose()
  })

  it('exchanges local events between two real handler frames and isolates another plugin', async () => {
    const provider = new MemoryWorkspaceProvider({
      now: () => 1000,
      initialFiles: {
        '/exo.json': '{}',
        '/one.template.txt': 'one',
        '/two.template.txt': 'two',
        '/three.template.txt': 'three',
      },
    })
    const handle = await provider.open()
    const session = new Session(handle)
    const transport = new FakeFrameTransport()
    const events = new EventBus()

    async function startHandler(path: string, sessionId: string, pluginId: string) {
      const stat = await session.stat(path)
      const handler = new HandlerSession({
        candidate: {
          ...candidate(),
          pluginId,
          identity: `${PLUGIN_ORIGIN}::${pluginId}`,
        },
        file: {
          path,
          name: path.slice(1),
          dir: '/',
          size: stat.size,
          mtime: stat.mtime,
          version: stat.version,
        },
        session,
        transport,
        shellVersion: '0.2.0',
        shellOrigin: SHELL_ORIGIN,
        workspaceName: 'demo',
        theme: 'dark',
        locale: 'en',
        events,
        canWrite: true,
        maxFileSize: 10 * 1024 * 1024,
        maxRequestBytes: 16 * 1024 * 1024,
        createSessionId: () => sessionId,
        onDirty: () => {},
        onFailure: () => {},
      })
      handler.start()
      const frame = transport.frames.at(-1) as FakeFrame
      const sdk = bridge(frame, 'editor', sessionId)
      const connection = await connectPlugin({ transport: sdk, timeoutMs: 1000 })
      if (connection.mode !== 'editor') throw new Error('expected editor mode')
      return { handler, editor: connection.editor }
    }

    const first = await startHandler('/one.template.txt', 'frame-a', 'com.example.template')
    const second = await startHandler('/two.template.txt', 'frame-b', 'com.example.template')
    const other = await startHandler('/three.template.txt', 'frame-c', 'com.example.other')

    await expect(first.editor.subscribeLocal('local/state')).resolves.toMatchObject({ seq: 0 })
    await expect(second.editor.subscribeLocal('local/state')).resolves.toMatchObject({ seq: 0 })
    await expect(other.editor.subscribeLocal('local/state')).resolves.toMatchObject({ seq: 0 })

    const firstEvents: unknown[] = []
    const secondEvents: unknown[] = []
    const otherEvents: unknown[] = []
    first.editor.onLocalEvent('local/state', (event) => firstEvents.push(event))
    second.editor.onLocalEvent('local/state', (event) => secondEvents.push(event))
    other.editor.onLocalEvent('local/state', (event) => otherEvents.push(event))

    await expect(first.editor.publishLocal('local/state', { ready: true })).resolves.toEqual({
      topic: 'local/state',
      seq: 1,
    })

    await vi.waitFor(() => expect(secondEvents).toHaveLength(1))
    expect(secondEvents[0]).toEqual({
      topic: 'local/state',
      seq: 1,
      from: 'frame-a',
      payload: { ready: true },
    })
    expect(firstEvents).toEqual(secondEvents)
    expect(otherEvents).toHaveLength(0)

    first.editor.unsubscribe('local/state')
    second.editor.unsubscribe('local/state')
    other.editor.unsubscribe('local/state')
    await first.handler.dispose('closed')
    await second.handler.dispose('closed')
    await other.handler.dispose('closed')
    await session.dispose()
  })

  it('ignores a spoofed init and accepts the real one', async () => {
    const fake = new FakePluginTransport({
      hostOrigin: SHELL_ORIGIN,
      mode: 'register',
      sessionId: SESSION_ID,
    })
    const promise = connectPlugin({ transport: fake, timeoutMs: 100 })
    fake.emit(
      { exo: 1, type: 'shell/init', payload: registerInit() },
      { origin: 'https://evil.example.com' },
    )
    fake.emit(
      { exo: 1, type: 'shell/init', payload: registerInit() },
      { source: { name: 'other' } },
    )
    fake.emit({ exo: 1, type: 'shell/init', payload: registerInit() })
    await expect(promise).resolves.toMatchObject({ mode: 'register' })
  })

  it('rejects a spoofed session without changing shell state', async () => {
    const shell = startRegistration()
    const fake = new FakePluginTransport({
      hostOrigin: SHELL_ORIGIN,
      mode: 'register',
      sessionId: SESSION_ID,
    })
    const promise = connectPlugin({ transport: fake, timeoutMs: 100 })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: registerInit({ sessionId: 'other' }),
    })
    await expect(promise).rejects.toMatchObject({ code: 'identity' })
    expect(shell.outcomes).toEqual([])
    expect(shell.frame.closed).toBe(false)
    shell.session.close()
  })

  it('rejects a wrong-mode init without changing shell state', async () => {
    const shell = startRegistration()
    const fake = new FakePluginTransport({
      hostOrigin: SHELL_ORIGIN,
      mode: 'register',
      sessionId: SESSION_ID,
    })
    const promise = connectPlugin({ transport: fake, timeoutMs: 100 })
    fake.emit({
      exo: 1,
      type: 'shell/init',
      payload: { ...registerInit(), mode: 'editor' },
    })
    await expect(promise).rejects.toMatchObject({ code: 'identity' })
    expect(shell.outcomes).toEqual([])
    expect(shell.frame.closed).toBe(false)
    shell.session.close()
  })

  it('surfaces unsupported-version from the real registration session', async () => {
    const shell = startRegistration()
    const sdk = bridge(shell.frame, 'register')
    await expect(
      connectPlugin({ transport: sdk, protocolVersion: '2', timeoutMs: 1000 }),
    ).rejects.toMatchObject({
      code: 'unsupported-version',
      expected: '1',
      received: '2',
    })
    expect(shell.outcomes[0]).toMatchObject({ kind: 'failed', code: 'unsupported-version' })
    shell.session.close()
  })
})

function registerInit(overrides: Partial<RegistrationInit> = {}): RegistrationInit {
  return {
    protocolVersion: '1',
    mode: 'register',
    sessionId: SESSION_ID,
    plugin: { id: 'com.example.template', version: '0.1.0' },
    shell: { version: '0.1.0', origin: SHELL_ORIGIN },
    workspace: { name: 'demo' },
    theme: 'dark',
    permissions: ['workspace:read', 'workspace:write'],
    locale: 'en',
    settings: {},
    capabilities: { localEvents: true, newFiles: true },
    ...overrides,
  }
}
