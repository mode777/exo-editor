import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMMAND_COOLDOWN_MS,
  COMMAND_TIMEOUT_MS,
  CommandRegistry,
  MAX_COMMAND_MESSAGE,
  PluginCommandController,
  parseCommandResult,
  type CommandEntry,
  type CommandHost,
  type CommandSource,
  type CommandTargetSession,
} from './commands'
import type { Envelope } from './protocol'
import type { RegisteredCommand } from './registration'

const IDENTITY = 'https://plugins.example.com::com.example.test'

function command(overrides: Partial<RegisteredCommand> = {}): RegisteredCommand {
  return {
    id: 'format',
    title: 'Format Document',
    target: 'activeEditor',
    menus: ['commandPalette'],
    registrationOrder: 0,
    ...overrides,
  }
}

function entry(overrides: Partial<CommandEntry> = {}): CommandEntry {
  return {
    identity: IDENTITY,
    pluginId: 'com.example.test',
    pluginName: 'Example Plugin',
    pluginVersion: '1.0.0',
    origin: 'https://plugins.example.com',
    pluginOrder: 0,
    command: command(),
    ...overrides,
  }
}

class FakeHost implements CommandHost {
  entries: CommandEntry[] = [entry()]
  readonly logs: Array<{
    identity: string
    phase: string
    code?: string
    message?: string
  }> = []

  listCommands(): CommandEntry[] {
    return this.entries
  }

  findCommand(identity: string, commandId: string): CommandEntry | undefined {
    return this.entries.find(
      (candidate) => candidate.identity === identity && candidate.command.id === commandId,
    )
  }

  logCommand(identity: string, phase: string, code?: string, message?: string): void {
    this.logs.push({ identity, phase, code, message })
  }
}

class FakeSession implements CommandTargetSession {
  active = true
  readonly sent: Array<{ invocationId: string; commandId: string; args?: unknown }> = []
  readonly liveInvocations = new Set<string>()
  private readonly resultListeners = new Set<(envelope: Envelope) => void>()
  private readonly closeListeners = new Set<(reason: string) => void>()

  sendCommand(invocationId: string, commandId: string, args?: unknown): boolean {
    if (!this.active) return false
    this.sent.push({ invocationId, commandId, args })
    return true
  }

  beginUserInvocation(invocationId: string): void {
    this.liveInvocations.add(invocationId)
  }

  endUserInvocation(invocationId: string): void {
    this.liveInvocations.delete(invocationId)
  }

  onCommandResult(listener: (envelope: Envelope) => void): () => void {
    this.resultListeners.add(listener)
    return () => this.resultListeners.delete(listener)
  }

  onClosed(listener: (reason: string) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  emitResult(replyTo: string, payload: unknown): void {
    for (const listener of [...this.resultListeners]) {
      listener({ exo: 1, type: 'plugin/command-result', replyTo, payload })
    }
  }

  dispose(): void {
    this.active = false
    for (const listener of [...this.closeListeners]) listener('closed')
  }
}

function setup(
  overrides: {
    host?: FakeHost
    activeEditor?: (identity: string) => CommandTargetSession | null
    revealPanel?: (identity: string, panelId: string) => Promise<CommandTargetSession | null>
    openContentView?: (
      identity: string,
      viewId: string,
      instanceKey: string,
    ) => Promise<CommandTargetSession | null>
  } = {},
) {
  const host = overrides.host ?? new FakeHost()
  const notices = { count: 0 }
  const controller = new PluginCommandController({
    host,
    activeEditor: overrides.activeEditor,
    revealPanel: overrides.revealPanel,
    openContentView: overrides.openContentView,
    onNoticeChange: () => {
      notices.count += 1
    },
  })
  return { host, controller, notices }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('command registry', () => {
  it('orders by plugin declaration order, then registration order, and replaces an identity', () => {
    const registry = new CommandRegistry()
    registry.add(
      {
        identity: 'b',
        pluginId: 'b',
        pluginName: 'B',
        pluginVersion: '1',
        origin: 'https://b.example',
        pluginOrder: 1,
      },
      [command({ id: 'second', registrationOrder: 0 })],
    )
    registry.add(
      {
        identity: 'a',
        pluginId: 'a',
        pluginName: 'A',
        pluginVersion: '1',
        origin: 'https://a.example',
        pluginOrder: 0,
      },
      [
        command({ id: 'later', registrationOrder: 1 }),
        command({ id: 'earlier', registrationOrder: 0 }),
      ],
    )
    expect(registry.list().map((item) => item.command.id)).toEqual(['earlier', 'later', 'second'])
    registry.add(
      {
        identity: 'a',
        pluginId: 'a',
        pluginName: 'A',
        pluginVersion: '1',
        origin: 'https://a.example',
        pluginOrder: 0,
      },
      [command({ id: 'only', registrationOrder: 0 })],
    )
    expect(registry.list().map((item) => item.command.id)).toEqual(['only', 'second'])
    expect(registry.find('a', 'earlier')).toBeUndefined()
    registry.remove('a')
    expect(registry.list().map((item) => item.command.id)).toEqual(['second'])
    registry.clear()
    expect(registry.list()).toEqual([])
  })
})

describe('command controller', () => {
  it('delivers an active-editor command with no arguments and clears on success', async () => {
    vi.useFakeTimers()
    const session = new FakeSession()
    const { host, controller } = setup({ activeEditor: () => session })
    const outcome = await controller.invoke(IDENTITY, 'format', 'palette')
    expect(outcome).toEqual({ ok: true })
    expect(session.sent).toEqual([{ invocationId: 'cmd-1', commandId: 'format', args: undefined }])
    session.emitResult('cmd-1', { ok: true })
    expect(controller.getSnapshot().notices).toEqual([])
    expect(host.logs.map((log) => log.code)).toContain('invoked')
    expect(host.logs.map((log) => log.code)).toContain('result-ok')
  })

  it('does not deliver when the active editor belongs to another plugin', async () => {
    const session = new FakeSession()
    const { host, controller } = setup({ activeEditor: () => null })
    expect(await controller.invoke(IDENTITY, 'format', 'editorTitle')).toEqual({
      ok: false,
      code: 'unavailable',
    })
    expect(session.sent).toEqual([])
    expect(host.logs.at(-1)).toMatchObject({ code: 'unavailable' })
  })

  it('reveals a lazy panel and sends a content-view command to one instance key', async () => {
    const panelSession = new FakeSession()
    const contentSession = new FakeSession()
    const reveals: Array<[string, string]> = []
    const opens: Array<[string, string, string]> = []
    const host = new FakeHost()
    host.entries = [
      entry({
        command: command({
          id: 'generate',
          target: { kind: 'panel', id: 'reports' },
          menus: ['commandPalette', 'explorer/context'],
        }),
      }),
      entry({
        command: command({
          id: 'inspect',
          target: { kind: 'contentView', id: 'report' },
          menus: ['commandPalette'],
        }),
      }),
    ]
    const { controller } = setup({
      host,
      revealPanel: async (identity, panelId) => {
        reveals.push([identity, panelId])
        return panelSession
      },
      openContentView: async (identity, viewId, instanceKey) => {
        opens.push([identity, viewId, instanceKey])
        return contentSession
      },
    })
    expect(
      await controller.invoke(IDENTITY, 'generate', 'explorer', {
        path: '/notes',
        kind: 'directory',
      }),
    ).toEqual({ ok: true })
    expect(reveals).toEqual([[IDENTITY, 'reports']])
    expect(panelSession.sent[0]).toMatchObject({
      args: { path: '/notes', kind: 'directory' },
    })
    expect(await controller.invoke(IDENTITY, 'inspect', 'palette')).toEqual({ ok: true })
    expect(opens).toEqual([[IDENTITY, 'report', 'command/inspect']])
  })

  it('enforces single-flight, the five-second cooldown and the plugin-wide cap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const sessions = new Map<string, FakeSession>()
    const host = new FakeHost()
    host.entries = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) =>
      entry({ command: command({ id, registrationOrder: index }) }),
    )
    const { controller } = setup({
      host,
      activeEditor: () => {
        const active = new FakeSession()
        sessions.set(`session-${sessions.size}`, active)
        return active
      },
    })
    expect(await controller.invoke(IDENTITY, 'a', 'palette')).toEqual({ ok: true })
    const activeSession = [...sessions.values()][0] as FakeSession
    expect(await controller.invoke(IDENTITY, 'a', 'palette')).toEqual({
      ok: false,
      code: 'rate-limited',
    })
    for (const id of ['b', 'c', 'd', 'e']) {
      expect(await controller.invoke(IDENTITY, id, 'palette')).toEqual({ ok: true })
    }
    expect(await controller.invoke(IDENTITY, 'f', 'palette')).toEqual({
      ok: false,
      code: 'rate-limited',
    })
    expect(
      host.logs.filter((log) => log.code === 'rate-limited').map((log) => log.message),
    ).toEqual(expect.arrayContaining(['a single-flight', 'f concurrency']))
    activeSession.emitResult('cmd-1', { ok: true })
    vi.setSystemTime(COMMAND_COOLDOWN_MS)
    expect(await controller.invoke(IDENTITY, 'a', 'palette')).toEqual({ ok: true })
  })

  it('times out, keeps the frame active and shows a bounded notice', async () => {
    vi.useFakeTimers()
    const session = new FakeSession()
    const { host, controller, notices } = setup({ activeEditor: () => session })
    expect(await controller.invoke(IDENTITY, 'format', 'palette')).toEqual({ ok: true })
    vi.advanceTimersByTime(COMMAND_TIMEOUT_MS)
    expect(session.active).toBe(true)
    expect(host.logs.at(-1)).toMatchObject({ code: 'timeout' })
    const notice = controller.getSnapshot().notices[0]
    expect(notice?.message).toContain('Example Plugin')
    expect(notice?.message).toContain('did not finish')
    expect(notice?.message.length).toBeLessThanOrEqual(MAX_COMMAND_MESSAGE)
    expect(notices.count).toBe(1)
    controller.dismissNotice(notice?.id ?? 0)
    expect(controller.getSnapshot().notices).toEqual([])
  })

  it('reports failure as plain text and ignores a late result', async () => {
    vi.useFakeTimers()
    const session = new FakeSession()
    const { host, controller } = setup({ activeEditor: () => session })
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.emitResult('cmd-1', { ok: false, message: 'No selection' })
    expect(controller.getSnapshot().notices[0]?.message).toBe('Example Plugin: No selection')
    expect(host.logs.at(-1)).toMatchObject({ code: 'failed', message: 'No selection' })
    session.emitResult('cmd-1', { ok: false, message: 'again' })
    expect(host.logs.at(-1)).toMatchObject({ code: 'late' })
    expect(controller.getSnapshot().notices).toHaveLength(1)
  })

  it('bounds a failure message and treats an invalid result as a protocol failure', async () => {
    const longMessage = 'x'.repeat(500)
    const session = new FakeSession()
    const { controller } = setup({ activeEditor: () => session })
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.emitResult('cmd-1', { ok: false, message: longMessage })
    const notice = controller.getSnapshot().notices[0]
    expect(notice?.message.length).toBeLessThanOrEqual(MAX_COMMAND_MESSAGE)

    const second = new FakeSession()
    const other = setup({ activeEditor: () => second })
    await other.controller.invoke(IDENTITY, 'format', 'palette')
    second.emitResult('cmd-1', { ok: 'yes' })
    expect(other.host.logs.at(-1)).toMatchObject({ code: 'protocol-violation' })
    expect(other.controller.getSnapshot().notices).toHaveLength(1)
  })

  it('cancels a pending invocation when the frame is disposed', async () => {
    vi.useFakeTimers()
    const session = new FakeSession()
    const { host, controller } = setup({ activeEditor: () => session })
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.dispose()
    expect(host.logs.at(-1)).toMatchObject({ code: 'closed' })
    vi.advanceTimersByTime(COMMAND_TIMEOUT_MS)
    expect(host.logs.filter((log) => log.code === 'timeout')).toEqual([])
    expect(controller.getSnapshot().notices).toEqual([])
  })

  it('scopes user invocation grants to the target frame and the live invocation', async () => {
    vi.useFakeTimers()
    const session = new FakeSession()
    const host = new FakeHost()
    host.entries = [
      entry({ command: command({ id: 'first', registrationOrder: 0 }) }),
      entry({ command: command({ id: 'second', registrationOrder: 1 }) }),
    ]
    const { controller } = setup({ host, activeEditor: () => session })

    expect(await controller.invoke(IDENTITY, 'first', 'palette')).toEqual({ ok: true })
    expect(await controller.invoke(IDENTITY, 'second', 'palette')).toEqual({ ok: true })
    expect([...session.liveInvocations]).toEqual(['cmd-1', 'cmd-2'])

    session.emitResult('cmd-1', { ok: true })
    expect([...session.liveInvocations]).toEqual(['cmd-2'])

    vi.advanceTimersByTime(COMMAND_TIMEOUT_MS)
    expect(session.liveInvocations.size).toBe(0)

    expect(await controller.invoke(IDENTITY, 'first', 'palette')).toEqual({ ok: true })
    expect([...session.liveInvocations]).toEqual(['cmd-3'])
    session.dispose()
    expect(session.liveInvocations.size).toBe(0)
  })

  it('rejects an explorer invocation without a resource and ignores a stale command', async () => {
    const session = new FakeSession()
    const { controller, host } = setup({ activeEditor: () => session })
    expect(await controller.invoke(IDENTITY, 'format', 'explorer')).toEqual({
      ok: false,
      code: 'unavailable',
    })
    host.entries = []
    expect(await controller.invoke(IDENTITY, 'format', 'palette')).toEqual({
      ok: false,
      code: 'stale',
    })
    expect(session.sent).toEqual([])
  })

  it('resets pending, cooldowns, notices and late-result tracking', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const session = new FakeSession()
    const { host, controller } = setup({ activeEditor: () => session })
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.emitResult('cmd-1', { ok: false, message: 'failed' })
    expect(controller.getSnapshot().notices).toHaveLength(1)
    controller.reset()
    expect(controller.getSnapshot().notices).toEqual([])
    await controller.invoke(IDENTITY, 'format', 'palette')
    session.emitResult('cmd-1', { ok: true })
    expect(host.logs.filter((log) => log.code === 'late')).toEqual([])
  })
})

describe('command result parsing', () => {
  it('accepts only the documented shapes and bounds the message', () => {
    expect(parseCommandResult({ ok: true })).toEqual({ ok: true })
    expect(parseCommandResult({ ok: false })).toEqual({ ok: false })
    expect(parseCommandResult({ ok: false, message: 'x'.repeat(500) })).toEqual({
      ok: false,
      message: 'x'.repeat(MAX_COMMAND_MESSAGE),
    })
    expect(parseCommandResult({ ok: true, extra: true })).toBeNull()
    expect(parseCommandResult({ ok: false, message: 42 })).toBeNull()
    expect(parseCommandResult({ ok: 'true' })).toBeNull()
    expect(parseCommandResult(null)).toBeNull()
  })
})

it('exposes the invocation source union used by surfaces', () => {
  const sources: CommandSource[] = ['palette', 'explorer', 'editorTitle']
  expect(sources).toHaveLength(3)
})
