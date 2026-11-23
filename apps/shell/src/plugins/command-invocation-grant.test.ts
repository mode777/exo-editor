import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from '../workspace/providers/memory'
import { Session } from '../workspace/session'
import type { WorkspaceSession } from '../workspace/contract'
import { EventBus } from './events'
import { FakeFrameTransport, type FakeFrame } from './frame-test-support'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import type { PluginPermission } from './manifest'
import type { NewFileOutcome, NewFileRequest } from './new-file'
import {
  COMMAND_TIMEOUT_MS,
  PluginCommandController,
  type CommandEntry,
  type CommandHost,
  type CommandTargetSession,
} from './commands'
import { ViewSession, type ViewInitData, type ViewSessionOptions } from './view-session'

const SHELL_ORIGIN = 'https://editor.example.com'
const PLUGIN_ORIGIN = 'https://plugins.example.com'
const IDENTITY = `${PLUGIN_ORIGIN}::com.example.tenon`

type ViewOverrides = Partial<ViewInitData>

interface Started {
  transport: FakeFrameTransport
  frame: FakeFrame
  session: ViewSession
  workspace: WorkspaceSession
  failures: Array<{ code: string; phase: string }>
  logs: Array<{ phase: string; code?: string }>
  newFileRequests: NewFileRequest[]
  pickerRequests: FilePickerOpenRequest[]
  visible: boolean
}

let viewCounter = 0

async function start(
  options: {
    permissions?: PluginPermission[]
    writable?: boolean
    view?: ViewOverrides
    onRequestNewFile?: (request: NewFileRequest) => Promise<NewFileOutcome>
    onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
  } = {},
): Promise<Started> {
  const sessionId = `view-${++viewCounter}`
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    writable: options.writable ?? true,
    initialFiles: { '/notes.txt': 'hello' },
  })
  const handle = await provider.open()
  const workspace = new Session(handle)
  const transport = new FakeFrameTransport()
  const failures: Array<{ code: string; phase: string }> = []
  const logs: Array<{ phase: string; code?: string }> = []
  const newFileRequests: NewFileRequest[] = []
  const pickerRequests: FilePickerOpenRequest[] = []
  const state = { visible: true }
  const baseView: ViewInitData = {
    kind: options.view?.kind ?? 'panel',
    id: options.view?.id ?? 'tenon.project',
    title: options.view?.title ?? 'Tenon',
    instanceId: options.view?.instanceId ?? `panel-${viewCounter}`,
    ...(options.view?.location === undefined ? {} : { location: options.view.location }),
    ...(options.view?.payload === undefined ? {} : { payload: options.view.payload }),
    ...(options.view?.openedBy === undefined ? {} : { openedBy: options.view.openedBy }),
  }
  const view: ViewInitData = {
    ...baseView,
    instanceId: baseView.instanceId ?? `panel-${viewCounter}`,
  }
  const newFile =
    options.onRequestNewFile ??
    (async (): Promise<NewFileOutcome> => ({
      ok: true,
      path: '/schemas/new.json',
      version: 'v1',
    }))
  const picker =
    options.onRequestFiles ??
    (async (): Promise<FilePickerOutcome> => ({ ok: true, paths: ['/notes.txt'] }))

  const viewOptions: ViewSessionOptions = {
    plugin: {
      identity: IDENTITY,
      pluginId: 'com.example.tenon',
      pluginName: 'Tenon',
      pluginVersion: '1.0.0',
      origin: PLUGIN_ORIGIN,
      permissions: options.permissions ?? ['workspace:read', 'workspace:write'],
    },
    entryUrl: `${PLUGIN_ORIGIN}/tenon/views/project.html`,
    view,
    session: workspace,
    transport,
    shellVersion: '0.7.0',
    shellOrigin: SHELL_ORIGIN,
    workspaceName: 'demo',
    theme: 'dark',
    locale: 'en',
    events: new EventBus(),
    maxFileSize: 10 * 1024 * 1024,
    maxRequestBytes: 16 * 1024 * 1024,
    createSessionId: () => sessionId,
    onRequestFiles: async (request) => {
      pickerRequests.push(request)
      return picker(request)
    },
    onRequestNewFile: async (request) => {
      newFileRequests.push(request)
      return newFile(request)
    },
    isVisible: () => state.visible,
    onFailure: (failure) => failures.push(failure),
    onLog: (event) => logs.push(event),
  }

  const session = new ViewSession(viewOptions)
  session.start()
  const frame = transport.frames[0] as FakeFrame
  ready(frame, sessionId)
  return {
    transport,
    frame,
    session,
    workspace,
    failures,
    logs,
    newFileRequests,
    pickerRequests,
    get visible() {
      return state.visible
    },
    set visible(value: boolean) {
      state.visible = value
    },
  }
}

function ready(frame: FakeFrame, sessionId: string) {
  frame.emit(
    {
      exo: 1,
      type: 'plugin/ready',
      payload: { protocolVersion: '1', sessionId },
    },
    PLUGIN_ORIGIN,
  )
}

class FakeHost implements CommandHost {
  readonly logs: Array<{
    identity: string
    phase: string
    code?: string
    message?: string
  }> = []

  constructor(readonly entries: CommandEntry[]) {}

  listCommands(): CommandEntry[] {
    return this.entries
  }

  findCommand(identity: string, commandId: string): CommandEntry | undefined {
    return this.entries.find(
      (entry) => entry.identity === identity && entry.command.id === commandId,
    )
  }

  logCommand(identity: string, phase: string, code?: string, message?: string): void {
    this.logs.push({ identity, phase, code, message })
  }
}

function commandEntry(
  id: string,
  target: CommandEntry['command']['target'],
  title = id,
): CommandEntry {
  return {
    identity: IDENTITY,
    pluginId: 'com.example.tenon',
    pluginName: 'Tenon',
    pluginVersion: '1.0.0',
    origin: PLUGIN_ORIGIN,
    pluginOrder: 0,
    command: {
      id,
      title,
      target,
      menus: ['commandPalette'],
      registrationOrder: 0,
    },
  }
}

function controllerFor(host: CommandHost, target: CommandTargetSession): PluginCommandController {
  return new PluginCommandController({
    host,
    revealPanel: async () => target,
    openContentView: async () => target,
  })
}

function posted(frame: FakeFrame, type: string) {
  return frame.posted
    .map((entry) => entry.message as Record<string, unknown>)
    .find((message) => message.type === type)
}

function commandFor(frame: FakeFrame): { id?: string; payload?: { command?: string } } | undefined {
  return posted(frame, 'shell/command') as
    { id?: string; payload?: { command?: string } } | undefined
}

function postedReply(frame: FakeFrame, type: string, replyTo: string) {
  return frame.posted
    .map((entry) => entry.message as Record<string, unknown>)
    .find((message) => message.type === type && message.replyTo === replyTo) as
    { type: string; payload?: unknown; replyTo?: string } | undefined
}

function errorFor(frame: FakeFrame, replyTo: string): { code?: string } | undefined {
  return postedReply(frame, 'shell/error', replyTo)?.payload as { code?: string } | undefined
}

async function waitForReply(frame: FakeFrame, type: string, replyTo: string) {
  return vi.waitFor(() => {
    const reply = postedReply(frame, type, replyTo)
    expect(reply).toBeDefined()
    return reply
  })
}

function requestNewFile(frame: FakeFrame, id: string, payload: Record<string, unknown> = {}) {
  frame.emit({ exo: 1, type: 'plugin/request-new-file', id, payload }, PLUGIN_ORIGIN)
}

function requestFiles(frame: FakeFrame, id: string, payload: Record<string, unknown> = {}) {
  frame.emit({ exo: 1, type: 'plugin/request-files', id, payload }, PLUGIN_ORIGIN)
}

function result(frame: FakeFrame, replyTo: string, payload: unknown) {
  frame.emit({ exo: 1, type: 'plugin/command-result', replyTo, payload }, PLUGIN_ORIGIN)
}

function protocolViolations(frame: FakeFrame): number {
  return frame.posted
    .map((entry) => entry.message as { type?: string; payload?: { code?: string } })
    .filter(
      (message) => message.type === 'shell/error' && message.payload?.code === 'protocol-violation',
    ).length
}

afterEach(() => {
  vi.useRealTimers()
  viewCounter = 0
})

describe('command invocation user activation', () => {
  it('lets a palette command on an unfocused panel create a file without changing focus', async () => {
    const context = await start()
    context.frame.focused = false
    const host = new FakeHost([
      commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' }, 'New Schema'),
    ])
    const controller = controllerFor(host, context.session)

    expect(await controller.invoke(IDENTITY, 'new-schema', 'palette')).toEqual({ ok: true })
    const command = commandFor(context.frame)
    expect(command?.payload?.command).toBe('new-schema')
    expect(context.session.hasFocus()).toBe(false)
    expect(context.session.hasLiveCommandInvocation()).toBe(true)

    requestNewFile(context.frame, 'new-1', { text: '{}', suggestedName: 'new.json' })
    await vi.waitFor(() => expect(context.newFileRequests).toHaveLength(1))
    expect(await waitForReply(context.frame, 'shell/new-file-result', 'new-1')).toMatchObject({
      replyTo: 'new-1',
      payload: { path: '/schemas/new.json', version: 'v1' },
    })

    result(context.frame, command?.id ?? '', { ok: true })
    expect(context.frame.focused).toBe(false)
    expect(context.session.hasLiveCommandInvocation()).toBe(false)
    expect(protocolViolations(context.frame)).toBe(0)
    expect(host.logs.map((entry) => entry.code)).toContain('result-ok')
  })

  it('gives a content-view target the same grant', async () => {
    const context = await start({
      view: {
        kind: 'content',
        id: 'tenon.schema',
        title: 'Schema',
        instanceId: 'content-1',
      },
    })
    context.frame.focused = false
    const host = new FakeHost([
      commandEntry('new-schema', { kind: 'contentView', id: 'tenon.schema' }, 'New Schema'),
    ])
    const controller = controllerFor(host, context.session)

    expect(await controller.invoke(IDENTITY, 'new-schema', 'palette')).toEqual({ ok: true })
    const command = commandFor(context.frame)
    requestNewFile(context.frame, 'new-content', { text: '{}' })
    await vi.waitFor(() => expect(context.newFileRequests).toHaveLength(1))
    expect(await waitForReply(context.frame, 'shell/new-file-result', 'new-content')).toBeDefined()
    result(context.frame, command?.id ?? '', { ok: true })
    expect(context.frame.focused).toBe(false)
  })

  it('denies a request after the command result', async () => {
    const context = await start()
    context.frame.focused = false
    const host = new FakeHost([commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' })])
    const controller = controllerFor(host, context.session)

    await controller.invoke(IDENTITY, 'new-schema', 'palette')
    const command = commandFor(context.frame)
    requestNewFile(context.frame, 'new-live', { text: '{}' })
    await vi.waitFor(() => expect(context.newFileRequests).toHaveLength(1))
    await waitForReply(context.frame, 'shell/new-file-result', 'new-live')

    result(context.frame, command?.id ?? '', { ok: true })
    requestNewFile(context.frame, 'new-late', { text: '{}' })
    expect(errorFor(context.frame, 'new-late')).toMatchObject({ code: 'permission-denied' })
    expect(context.newFileRequests).toHaveLength(1)
  })

  it('denies a request after the command times out', async () => {
    vi.useFakeTimers()
    const context = await start()
    context.frame.focused = false
    const host = new FakeHost([commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' })])
    const controller = controllerFor(host, context.session)

    await controller.invoke(IDENTITY, 'new-schema', 'palette')
    expect(commandFor(context.frame)).toBeDefined()
    vi.advanceTimersByTime(COMMAND_TIMEOUT_MS)
    expect(host.logs.at(-1)).toMatchObject({ code: 'timeout' })

    requestNewFile(context.frame, 'new-timeout', { text: '{}' })
    expect(errorFor(context.frame, 'new-timeout')).toMatchObject({
      code: 'permission-denied',
    })
    expect(context.newFileRequests).toHaveLength(0)
  })

  it('does not let one frame authorize another frame', async () => {
    const target = await start()
    const other = await start({
      view: {
        kind: 'panel',
        id: 'tenon.other',
        title: 'Other',
        instanceId: 'panel-other',
        location: 'secondary',
      },
    })
    target.frame.focused = false
    other.frame.focused = false
    const host = new FakeHost([commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' })])
    const controller = controllerFor(host, target.session)

    await controller.invoke(IDENTITY, 'new-schema', 'palette')
    expect(target.session.hasLiveCommandInvocation()).toBe(true)

    requestNewFile(other.frame, 'new-other', { text: '{}' })
    expect(errorFor(other.frame, 'new-other')).toMatchObject({ code: 'permission-denied' })
    expect(other.newFileRequests).toHaveLength(0)
    expect(other.session.hasLiveCommandInvocation()).toBe(false)

    result(target.frame, commandFor(target.frame)?.id ?? '', { ok: true })
  })

  it('keeps the write permission and read-only checks ahead of the grant', async () => {
    const missingWrite = await start({ permissions: ['workspace:read'] })
    missingWrite.frame.focused = false
    const host = new FakeHost([commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' })])
    const missingWriteController = controllerFor(host, missingWrite.session)
    await missingWriteController.invoke(IDENTITY, 'new-schema', 'palette')
    expect(missingWrite.session.hasLiveCommandInvocation()).toBe(true)
    requestNewFile(missingWrite.frame, 'new-no-write', { text: '{}' })
    expect(errorFor(missingWrite.frame, 'new-no-write')).toMatchObject({
      code: 'permission-denied',
    })
    expect(missingWrite.newFileRequests).toHaveLength(0)

    const readOnly = await start({ writable: false })
    readOnly.frame.focused = false
    const readOnlyHost = new FakeHost([
      commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' }),
    ])
    const readOnlyController = controllerFor(readOnlyHost, readOnly.session)
    await readOnlyController.invoke(IDENTITY, 'new-schema', 'palette')
    expect(readOnly.session.hasLiveCommandInvocation()).toBe(true)
    requestNewFile(readOnly.frame, 'new-read-only', { text: '{}' })
    expect(errorFor(readOnly.frame, 'new-read-only')).toMatchObject({
      code: 'permission-denied',
    })
    expect(readOnly.newFileRequests).toHaveLength(0)
  })

  it('gives the picker the same grant and the same post-result denial', async () => {
    const context = await start()
    context.frame.focused = false
    const host = new FakeHost([commandEntry('pick-schema', { kind: 'panel', id: 'tenon.project' })])
    const controller = controllerFor(host, context.session)

    await controller.invoke(IDENTITY, 'pick-schema', 'palette')
    const command = commandFor(context.frame)
    requestFiles(context.frame, 'pick-live', { multiple: false })
    await vi.waitFor(() => expect(context.pickerRequests).toHaveLength(1))
    expect(await waitForReply(context.frame, 'shell/files-selected', 'pick-live')).toMatchObject({
      replyTo: 'pick-live',
      payload: { paths: ['/notes.txt'] },
    })

    result(context.frame, command?.id ?? '', { ok: true })
    requestFiles(context.frame, 'pick-late', { multiple: false })
    expect(errorFor(context.frame, 'pick-late')).toMatchObject({ code: 'permission-denied' })
    expect(context.pickerRequests).toHaveLength(1)
  })

  it('revokes the grant and closes a pending dialog on disposal without a late write', async () => {
    let resolveRequest: ((outcome: NewFileOutcome) => void) | null = null
    const context = await start({
      onRequestNewFile: () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
    })
    context.frame.focused = false
    const host = new FakeHost([commandEntry('new-schema', { kind: 'panel', id: 'tenon.project' })])
    const controller = controllerFor(host, context.session)

    await controller.invoke(IDENTITY, 'new-schema', 'palette')
    requestNewFile(context.frame, 'new-pending', { text: '{}' })
    await vi.waitFor(() => expect(context.newFileRequests).toHaveLength(1))
    const request = context.newFileRequests[0]
    expect(request?.signal.aborted).toBe(false)

    context.session.close()
    expect(context.session.hasLiveCommandInvocation()).toBe(false)
    expect(request?.signal.aborted).toBe(true)
    expect(host.logs.map((entry) => entry.code)).toContain('closed')

    const resolve = resolveRequest as ((outcome: NewFileOutcome) => void) | null
    resolve?.({ ok: true, path: '/late.json', version: 'v1' })
    await Promise.resolve()
    await Promise.resolve()
    expect(postedReply(context.frame, 'shell/new-file-result', 'new-pending')).toBeUndefined()
  })

  it('still allows a focused panel to create a file without a command', async () => {
    const context = await start()
    context.frame.focused = true
    requestNewFile(context.frame, 'new-focused', { text: '{}' })
    await vi.waitFor(() => expect(context.newFileRequests).toHaveLength(1))
    expect(await waitForReply(context.frame, 'shell/new-file-result', 'new-focused')).toBeDefined()
    expect(context.session.hasLiveCommandInvocation()).toBe(false)
  })

  it('denies an unfocused frame outside a live invocation', async () => {
    const context = await start()
    context.frame.focused = false
    requestNewFile(context.frame, 'new-background', { text: '{}' })
    expect(errorFor(context.frame, 'new-background')).toMatchObject({
      code: 'permission-denied',
    })
    requestFiles(context.frame, 'pick-background', { multiple: false })
    expect(errorFor(context.frame, 'pick-background')).toMatchObject({
      code: 'permission-denied',
    })
    expect(context.newFileRequests).toHaveLength(0)
    expect(context.pickerRequests).toHaveLength(0)
  })
})
