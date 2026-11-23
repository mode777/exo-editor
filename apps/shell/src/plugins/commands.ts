import type { RegisteredCommand } from './registration'
import type { Envelope } from './protocol'

/**
 * Command contributions, the active-command registry and the one invocation
 * controller. The registry is data-only; every delivery, timer, cooldown and
 * notice lives in `PluginCommandController`, which is the only path from a
 * shell surface to a plugin frame.
 */

export const COMMAND_TIMEOUT_MS = 10_000
export const COMMAND_COOLDOWN_MS = 5_000
export const MAX_CONCURRENT_COMMANDS = 5
export const MAX_COMMAND_MESSAGE = 200
export const MAX_COMMAND_NOTICES = 5
export const COMMAND_NOTICE_TIMEOUT_MS = 8_000

export type CommandSource = 'palette' | 'explorer' | 'editorTitle'
export type CommandResourceKind = 'file' | 'directory'

export interface CommandResource {
  path: string
  kind: CommandResourceKind
}

export interface CommandArgs {
  path: string
  kind: CommandResourceKind
}

export interface PluginCommandSource {
  identity: string
  pluginId: string
  pluginName: string
  pluginVersion: string
  origin: string
  pluginOrder: number
}

export interface CommandEntry {
  identity: string
  pluginId: string
  pluginName: string
  pluginVersion: string
  origin: string
  pluginOrder: number
  command: RegisteredCommand
}

export type InvocationFailureCode = 'stale' | 'rate-limited' | 'unavailable'

export type InvocationOutcome = { ok: true } | { ok: false; code: InvocationFailureCode }

export interface CommandNotice {
  id: number
  identity: string
  pluginName: string
  commandId: string
  commandTitle: string
  message: string
  at: number
}

export interface CommandControllerSnapshot {
  notices: CommandNotice[]
  revision: number
}

/** The structural slice of a handler or view frame the controller needs. */
export interface CommandTargetSession {
  readonly active: boolean
  sendCommand(invocationId: string, commandId: string, args?: CommandArgs): boolean
  onCommandResult(listener: (envelope: Envelope) => void): () => void
  onClosed(listener: (reason: string) => void): () => void
  /** Mark the target as user-activated for focus-gated intents. */
  beginUserInvocation?(invocationId: string): void
  /** Drop the grant when the invocation settles, times out or is disposed. */
  endUserInvocation?(invocationId: string): void
}

export interface CommandHost {
  listCommands(): CommandEntry[]
  findCommand(identity: string, commandId: string): CommandEntry | undefined
  logCommand(identity: string, phase: string, code?: string, message?: string): void
}

export interface PluginCommandControllerOptions {
  host: CommandHost
  /** The active document's handler when it belongs to `identity`. */
  activeEditor?: (identity: string) => CommandTargetSession | null
  /** Reveal (and lazily mount) a panel, resolving an active session. */
  revealPanel?: (identity: string, panelId: string) => Promise<CommandTargetSession | null>
  /** Open or focus a content-view tab, resolving an active session. */
  openContentView?: (
    identity: string,
    viewId: string,
    instanceKey: string,
  ) => Promise<CommandTargetSession | null>
  now?: () => number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  onNoticeChange?: () => void
}

interface PendingInvocation {
  invocationId: string
  identity: string
  commandId: string
  commandTitle: string
  pluginName: string
  session: CommandTargetSession
  timer: ReturnType<typeof setTimeout> | null
  unsubscribeResult: () => void
  unsubscribeClosed: () => void
}

interface TrackedSession {
  identity: string
  unsubscribe: () => void
}

interface SettledInvocation {
  invocationId: string
  identity: string
  commandId: string
  at: number
}

function commandKey(identity: string, commandId: string): string {
  return `${identity}\u0000${commandId}`
}

function bounded(value: string): string {
  return value.length > MAX_COMMAND_MESSAGE ? value.slice(0, MAX_COMMAND_MESSAGE) : value
}

/**
 * Active commands for one workspace, ordered by `exo.json` declaration order and
 * then registration arrival order. The host re-adds a plugin's commands when its
 * registration record is reconciled, so `add` replaces any earlier copy.
 */
export class CommandRegistry {
  private readonly entries = new Map<string, CommandEntry>()

  add(source: PluginCommandSource, commands: RegisteredCommand[]): void {
    this.remove(source.identity)
    for (const command of commands) {
      this.entries.set(commandKey(source.identity, command.id), {
        ...source,
        command: { ...command, menus: [...command.menus] },
      })
    }
  }

  remove(identity: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${identity}\u0000`)) this.entries.delete(key)
    }
  }

  clear(): void {
    this.entries.clear()
  }

  find(identity: string, commandId: string): CommandEntry | undefined {
    return this.entries.get(commandKey(identity, commandId))
  }

  list(): CommandEntry[] {
    return [...this.entries.values()].sort(
      (left, right) =>
        left.pluginOrder - right.pluginOrder ||
        left.command.registrationOrder - right.command.registrationOrder ||
        left.command.id.localeCompare(right.command.id),
    )
  }
}

const INITIAL_SNAPSHOT: CommandControllerSnapshot = { notices: [], revision: 0 }

/**
 * The one path from a shell surface to a plugin frame. It re-resolves the live
 * command, gates single-flight/cooldown/concurrency, resolves the target frame,
 * sends `shell/command`, and owns the result timeout and workspace-scoped
 * notices.
 */
export class PluginCommandController {
  private readonly host: CommandHost
  private readonly activeEditor: ((identity: string) => CommandTargetSession | null) | undefined
  private readonly revealPanel:
    ((identity: string, panelId: string) => Promise<CommandTargetSession | null>) | undefined
  private readonly openContentView:
    | ((
        identity: string,
        viewId: string,
        instanceKey: string,
      ) => Promise<CommandTargetSession | null>)
    | undefined
  private readonly now: () => number
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private readonly onNoticeChange: (() => void) | undefined

  private readonly listeners = new Set<() => void>()
  private readonly pending = new Map<string, PendingInvocation>()
  private readonly cooldowns = new Map<string, number>()
  private readonly sessions = new Map<CommandTargetSession, TrackedSession>()
  private readonly settled: SettledInvocation[] = []
  private notices: CommandNotice[] = []
  private readonly noticeTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private snapshot: CommandControllerSnapshot = INITIAL_SNAPSHOT
  private noticeSequence = 0
  private invocationSequence = 0

  constructor(options: PluginCommandControllerOptions) {
    this.host = options.host
    this.activeEditor = options.activeEditor
    this.revealPanel = options.revealPanel
    this.openContentView = options.openContentView
    this.now = options.now ?? (() => Date.now())
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
    this.onNoticeChange = options.onNoticeChange
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): CommandControllerSnapshot => this.snapshot

  /**
   * Invoke one registered command. Every rejection is a logged no-op: no
   * message reaches any frame unless the target is active and the gates pass.
   */
  async invoke(
    identity: string,
    commandId: string,
    source: CommandSource,
    resource?: CommandResource,
  ): Promise<InvocationOutcome> {
    const entry = this.host.findCommand(identity, commandId)
    if (!entry) {
      this.host.logCommand(identity, 'command', 'stale', commandId)
      return { ok: false, code: 'stale' }
    }
    const key = commandKey(identity, commandId)
    const at = this.now()
    if (this.pending.has(key)) {
      return this.limit(entry, 'single-flight')
    }
    const last = this.cooldowns.get(key)
    if (last !== undefined && at - last < COMMAND_COOLDOWN_MS) {
      return this.limit(entry, 'cooldown')
    }
    if (this.pending.size >= MAX_CONCURRENT_COMMANDS) {
      return this.limit(entry, 'concurrency')
    }

    this.cooldowns.set(key, at)
    this.pruneCooldowns(at)

    let target: CommandTargetSession | null
    if (entry.command.target === 'activeEditor') {
      target = this.activeEditor?.(identity) ?? null
    } else if (entry.command.target.kind === 'panel') {
      target = (await this.revealPanel?.(identity, entry.command.target.id)) ?? null
    } else {
      target =
        (await this.openContentView?.(identity, entry.command.target.id, `command/${commandId}`)) ??
        null
    }

    if (!target?.active) {
      this.host.logCommand(identity, 'command', 'unavailable', commandId)
      return { ok: false, code: 'unavailable' }
    }
    // A workspace switch or plugin stop during a lazy mount must not deliver.
    if (!this.host.findCommand(identity, commandId)) {
      this.host.logCommand(identity, 'command', 'stale', commandId)
      return { ok: false, code: 'stale' }
    }

    const args = this.argsFor(source, resource)
    if (args === null) {
      this.host.logCommand(identity, 'command', 'unavailable', commandId)
      return { ok: false, code: 'unavailable' }
    }

    const invocationId = `cmd-${++this.invocationSequence}`
    const pending: PendingInvocation = {
      invocationId,
      identity,
      commandId,
      commandTitle: entry.command.title,
      pluginName: entry.pluginName,
      session: target,
      timer: null,
      unsubscribeResult: () => undefined,
      unsubscribeClosed: () => undefined,
    }
    this.pending.set(key, pending)
    this.track(target, identity)
    pending.unsubscribeResult = target.onCommandResult((envelope) =>
      this.handleResult(pending, envelope),
    )
    pending.unsubscribeClosed = target.onClosed((reason) => this.cancelPending(pending, reason))
    // The frame stays the user's command target for the whole invocation,
    // including while it opens a shell-owned dialog from its handler.
    target.beginUserInvocation?.(invocationId)

    if (!target.sendCommand(invocationId, commandId, args ?? undefined)) {
      this.clearPending(pending)
      this.host.logCommand(identity, 'command', 'unavailable', commandId)
      return { ok: false, code: 'unavailable' }
    }
    this.host.logCommand(identity, 'command', 'invoked', commandId)
    pending.timer = this.setTimeoutImpl(() => {
      this.timeout(pending)
    }, COMMAND_TIMEOUT_MS)
    return { ok: true }
  }

  /** Drop every workspace-scoped command, timer, cooldown and notice. */
  reset(): void {
    for (const pending of [...this.pending.values()]) {
      this.clearPending(pending)
    }
    for (const tracked of this.sessions.values()) tracked.unsubscribe()
    this.sessions.clear()
    this.cooldowns.clear()
    this.settled.length = 0
    for (const timer of this.noticeTimers.values()) this.clearTimeoutImpl(timer)
    this.noticeTimers.clear()
    this.notices = []
    this.publish()
  }

  dismissNotice(id: number): void {
    const timer = this.noticeTimers.get(id)
    if (timer !== undefined) {
      this.clearTimeoutImpl(timer)
      this.noticeTimers.delete(id)
    }
    const next = this.notices.filter((notice) => notice.id !== id)
    if (next.length === this.notices.length) return
    this.notices = next
    this.publish()
  }

  private limit(entry: CommandEntry, reason: string): InvocationOutcome {
    this.host.logCommand(entry.identity, 'command', 'rate-limited', `${entry.command.id} ${reason}`)
    return { ok: false, code: 'rate-limited' }
  }

  private argsFor(
    source: CommandSource,
    resource: CommandResource | undefined,
  ): CommandArgs | null | undefined {
    if (source !== 'explorer') return undefined
    if (!resource) return null
    if (!resource.path.startsWith('/') || resource.path.includes('\u0000')) return null
    if (resource.kind !== 'file' && resource.kind !== 'directory') return null
    return { path: resource.path, kind: resource.kind }
  }

  private track(session: CommandTargetSession, identity: string): void {
    if (this.sessions.has(session)) return
    this.sessions.set(session, {
      identity,
      // Keep one result listener for the session lifetime so a late result can
      // be logged after its invocation has already settled.
      unsubscribe: session.onCommandResult((envelope) => this.handleLateResult(identity, envelope)),
    })
  }

  private handleResult(pending: PendingInvocation, envelope: Envelope): void {
    if (this.pending.get(commandKey(pending.identity, pending.commandId)) !== pending) return
    if (envelope.replyTo !== pending.invocationId) return
    const result = parseCommandResult(envelope.payload)
    if (!result) {
      this.settle(pending, 'protocol-violation')
      this.pushNotice(pending, `${pending.commandTitle} returned an invalid result.`)
      return
    }
    if (result.ok) {
      this.settle(pending, 'result-ok')
      return
    }
    const message = bounded(result.message ?? `${pending.commandTitle} failed.`)
    this.settle(pending, 'failed', message)
    this.pushNotice(pending, message)
  }

  private handleLateResult(identity: string, envelope: Envelope): void {
    const replyTo = envelope.replyTo
    if (!replyTo) return
    if ([...this.pending.values()].some((entry) => entry.invocationId === replyTo)) return
    const index = this.settled.findIndex(
      (entry) => entry.identity === identity && entry.invocationId === replyTo,
    )
    if (index < 0) return
    this.host.logCommand(identity, 'command', 'late', replyTo)
    this.settled.splice(index, 1)
  }

  private timeout(pending: PendingInvocation): void {
    if (this.pending.get(commandKey(pending.identity, pending.commandId)) !== pending) return
    this.settle(pending, 'timeout')
    this.pushNotice(
      pending,
      `${pending.commandTitle} did not finish within ${COMMAND_TIMEOUT_MS / 1000} seconds.`,
    )
  }

  private cancelPending(pending: PendingInvocation, reason: string): void {
    if (this.pending.get(commandKey(pending.identity, pending.commandId)) !== pending) return
    this.settle(pending, reason)
  }

  private settle(pending: PendingInvocation, code: string, message?: string): void {
    this.clearPending(pending)
    this.settled.push({
      invocationId: pending.invocationId,
      identity: pending.identity,
      commandId: pending.commandId,
      at: this.now(),
    })
    if (this.settled.length > 50) this.settled.shift()
    this.host.logCommand(pending.identity, 'command', code, message ?? pending.commandId)
  }

  private clearPending(pending: PendingInvocation): void {
    const key = commandKey(pending.identity, pending.commandId)
    if (this.pending.get(key) === pending) this.pending.delete(key)
    pending.session.endUserInvocation?.(pending.invocationId)
    if (pending.timer !== null) {
      this.clearTimeoutImpl(pending.timer)
      pending.timer = null
    }
    pending.unsubscribeResult()
    pending.unsubscribeClosed()
  }

  private pruneCooldowns(at: number): void {
    for (const [key, last] of this.cooldowns) {
      if (at - last >= COMMAND_COOLDOWN_MS) this.cooldowns.delete(key)
    }
  }

  private pushNotice(pending: PendingInvocation, message: string): void {
    const text = bounded(`${pending.pluginName}: ${message}`)
    const notice: CommandNotice = {
      id: ++this.noticeSequence,
      identity: pending.identity,
      pluginName: pending.pluginName,
      commandId: pending.commandId,
      commandTitle: pending.commandTitle,
      message: text,
      at: this.now(),
    }
    this.notices = [...this.notices, notice].slice(-MAX_COMMAND_NOTICES)
    // Drop timers for notices pushed out by the cap.
    for (const [id, timer] of this.noticeTimers) {
      if (this.notices.some((entry) => entry.id === id)) continue
      this.clearTimeoutImpl(timer)
      this.noticeTimers.delete(id)
    }
    this.noticeTimers.set(
      notice.id,
      this.setTimeoutImpl(() => this.dismissNotice(notice.id), COMMAND_NOTICE_TIMEOUT_MS),
    )
    this.publish()
    this.onNoticeChange?.()
  }

  private publish(): void {
    this.snapshot = { notices: [...this.notices], revision: this.snapshot.revision + 1 }
    for (const listener of [...this.listeners]) listener()
  }
}

export function parseCommandResult(
  payload: unknown,
): { ok: true } | { ok: false; message?: string } | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const value = payload as Record<string, unknown>
  if (value.ok === true) {
    return Object.keys(value).length === 1 ? { ok: true } : null
  }
  if (value.ok !== false) return null
  if (Object.keys(value).some((key) => key !== 'ok' && key !== 'message')) return null
  if (value.message !== undefined && typeof value.message !== 'string') return null
  return {
    ok: false,
    ...(typeof value.message === 'string' ? { message: bounded(value.message) } : {}),
  }
}
