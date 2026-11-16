import { compileGlob } from './glob'
import {
  hasWorkspaceRead,
  resolvePluginEntry,
  type ManifestFileEditor,
  type PluginManifest,
} from './manifest'
import type { FrameHandle, FrameSandbox, FrameTransport, PluginMessage } from './frame'
import type { SettingValues } from './settings'
import {
  ACK_CLOSE_DELAY_MS,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  REGISTRATION_TIMEOUT_MS,
  ViolationBudget,
  buildFrameUrl,
  defaultSessionId,
  frameBoundary,
  isPlainObject,
  parseEnvelope,
  payloadTooLarge,
  postEnvelope,
  sendShellError,
  type Envelope,
} from './protocol'

export {
  ACK_CLOSE_DELAY_MS,
  MAX_MESSAGE_BYTES,
  MAX_PROTOCOL_VIOLATIONS,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  REGISTRATION_TIMEOUT_MS,
} from './protocol'

export type RegistrationPhase = 'ready' | 'register'

export type RegistrationErrorCode =
  'timeout' | 'loading-failed' | 'protocol-violation' | 'unsupported-version' | 'internal'

export interface RegisteredEditor {
  glob: string
  /** Declared relative page. */
  entry: string
  /** Resolved absolute page URL. */
  entryUrl: string
  label: string
  priority: number
  /** From the manifest contribution; not part of `plugin/register`. */
  rendering?: ManifestFileEditor['rendering']
  /** Arrival order within this plugin, starting at zero. */
  registrationOrder: number
}

export type RegistrationRejectionReason =
  'not-declared' | 'permission-denied' | 'invalid-glob' | 'invalid-contribution'

export interface RejectedContribution {
  index: number
  reason: RegistrationRejectionReason
  message?: string
}

export interface RegistrationAck {
  accepted: string[]
  rejected: RejectedContribution[]
}

export type RegistrationOutcome =
  | { kind: 'active'; editors: RegisteredEditor[]; ack: RegistrationAck }
  | { kind: 'failed'; code: RegistrationErrorCode; phase: RegistrationPhase; message?: string }

export type ShellErrorCode = import('./protocol').ShellErrorCode

export interface RegistrationSessionOptions {
  manifest: PluginManifest
  transport: FrameTransport
  shellVersion: string
  shellOrigin: string
  workspaceName: string
  theme: 'dark' | 'light' | 'high-contrast'
  locale: string
  /** Resolved workspace-scoped settings for this plugin; defaults when absent. */
  settings?: SettingValues
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  onOutcome: (outcome: RegistrationOutcome) => void
}

type Phase = 'mounting' | 'awaiting-ready' | 'awaiting-register' | 'complete' | 'closed'

function manifestEditorFor(manifest: PluginManifest, glob: string): ManifestFileEditor | undefined {
  return manifest.fileEditors.find((editor) => editor.glob === glob)
}

/**
 * One controller frame's registration lifetime. The outcome is delivered once;
 * the frame is removed after the acknowledgement delay. All state changes are
 * local to this instance, so closing it cannot mutate a later frame.
 */
export class RegistrationSession {
  private readonly options: RegistrationSessionOptions
  private readonly sessionId: string
  private readonly opaque: boolean
  private readonly sandbox: FrameSandbox
  private readonly targetOrigin: string
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private frame: FrameHandle | null = null
  private phase: Phase = 'mounting'
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private registrationTimer: ReturnType<typeof setTimeout> | null = null
  private closeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly violations = new ViolationBudget(() => {
    if (this.outcomeSent) {
      this.close()
    } else {
      this.fail('protocol-violation', this.phaseName())
    }
  })
  private outcomeSent = false
  private contributionIndex = 0
  private registrationOrder = 0
  private readonly pending = new Map<string, RegisteredEditor>()
  private readonly rejected: RejectedContribution[] = []

  constructor(options: RegistrationSessionOptions) {
    this.options = options
    this.sessionId = (options.createSessionId ?? defaultSessionId)()
    const boundary = frameBoundary(options.manifest.manifestOrigin, options.shellOrigin)
    this.opaque = boundary.opaque
    this.sandbox = boundary.sandbox
    this.targetOrigin = boundary.targetOrigin
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
  }

  start(): void {
    if (this.phase !== 'mounting') return

    let frame: FrameHandle
    try {
      frame = this.options.transport.open({
        url: buildFrameUrl(
          this.options.manifest.controllerUrl,
          this.options.shellOrigin,
          'register',
          this.sessionId,
        ),
        sandbox: this.sandbox,
        onMessage: (message) => this.handleMessage(message),
        onLoadError: () => this.fail('loading-failed', this.phaseName()),
      })
    } catch {
      this.fail('internal', 'ready', 'The plugin frame could not be created.')
      return
    }
    if (!frame.window) {
      frame.close()
      this.fail('loading-failed', 'ready')
      return
    }
    this.frame = frame
    this.phase = 'awaiting-ready'
    this.readyTimer = this.setTimeoutImpl(() => {
      this.fail('timeout', 'ready')
    }, READY_TIMEOUT_MS)
  }

  close(): void {
    if (this.phase === 'closed') return
    this.phase = 'closed'
    this.clearTimers()
    this.pending.clear()
    this.frame?.close()
  }

  private phaseName(): RegistrationPhase {
    return this.phase === 'awaiting-ready' || this.phase === 'mounting' ? 'ready' : 'register'
  }

  private clearTimers(): void {
    if (this.readyTimer !== null) {
      this.clearTimeoutImpl(this.readyTimer)
      this.readyTimer = null
    }
    if (this.registrationTimer !== null) {
      this.clearTimeoutImpl(this.registrationTimer)
      this.registrationTimer = null
    }
    if (this.closeTimer !== null) {
      this.clearTimeoutImpl(this.closeTimer)
      this.closeTimer = null
    }
  }

  private fail(code: RegistrationErrorCode, phase: RegistrationPhase, message?: string): void {
    if (this.phase === 'closed' || this.outcomeSent) return
    this.outcomeSent = true
    this.phase = 'closed'
    this.clearTimers()
    this.pending.clear()
    this.frame?.close()
    this.options.onOutcome({ kind: 'failed', code, phase, message })
  }

  private send(type: string, payload?: unknown, replyTo?: string): void {
    if (this.phase === 'closed') return
    postEnvelope(this.frame, this.targetOrigin, type, payload, replyTo)
  }

  private sendError(code: ShellErrorCode, replyTo?: string, message?: string): void {
    sendShellError(this.frame, this.targetOrigin, code, replyTo, message)
  }

  private violation(envelope?: Envelope, reply = true): void {
    if (reply) this.sendError('protocol-violation', envelope?.id)
    this.violations.record()
  }

  private handleMessage(message: PluginMessage): void {
    if (this.phase === 'closed') return
    if (!this.frame || message.source !== this.frame.window) return

    const envelope = parseEnvelope(message.data)
    if (!envelope) return

    if (this.opaque) {
      if (message.origin !== 'null') {
        this.violation(envelope, false)
        return
      }
    } else if (message.origin !== this.options.manifest.manifestOrigin) {
      this.violation(envelope, false)
      return
    }

    if (payloadTooLarge(envelope.payload)) {
      this.sendError('too-large', envelope.id)
      this.violation(undefined, false)
      return
    }

    if (this.phase === 'complete') {
      this.violation(envelope)
      return
    }

    switch (envelope.type) {
      case 'plugin/ready':
        this.handleReady(envelope)
        return
      case 'plugin/register':
        this.handleRegister(envelope)
        return
      case 'plugin/register-complete':
        this.handleComplete(envelope)
        return
      case 'plugin/request-file':
      case 'plugin/dirty':
      case 'plugin/save-content':
      case 'plugin/subscribe':
      case 'plugin/unsubscribe':
      case 'plugin/dispose-ack':
        this.violation(envelope)
        return
      default:
        if (envelope.id) this.sendError('unsupported-message', envelope.id)
        return
    }
  }

  private handleReady(envelope: Envelope): void {
    if (this.phase !== 'awaiting-ready') {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.protocolVersion !== 'string' ||
      typeof payload.sessionId !== 'string'
    ) {
      this.violation(envelope)
      return
    }
    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      this.sendError('unsupported-version', envelope.id)
      this.fail('unsupported-version', 'ready')
      return
    }
    if (payload.sessionId !== this.sessionId) {
      this.violation(envelope)
      return
    }

    if (this.readyTimer !== null) {
      this.clearTimeoutImpl(this.readyTimer)
      this.readyTimer = null
    }
    this.phase = 'awaiting-register'
    this.send('shell/init', {
      protocolVersion: PROTOCOL_VERSION,
      mode: 'register',
      sessionId: this.sessionId,
      plugin: {
        id: this.options.manifest.id,
        version: this.options.manifest.version,
      },
      shell: {
        version: this.options.shellVersion,
        origin: this.options.shellOrigin,
      },
      workspace: { name: this.options.workspaceName },
      theme: this.options.theme,
      permissions: this.options.manifest.permissions,
      locale: this.options.locale,
      settings: this.options.settings ?? {},
    })
    this.registrationTimer = this.setTimeoutImpl(() => {
      this.fail('timeout', 'register')
    }, REGISTRATION_TIMEOUT_MS)
  }

  private handleRegister(envelope: Envelope): void {
    if (this.phase !== 'awaiting-register') {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (!isPlainObject(payload)) {
      this.violation(envelope)
      return
    }
    if (payload.fileEditors === undefined) return
    if (!Array.isArray(payload.fileEditors)) {
      this.violation(envelope)
      return
    }

    for (const raw of payload.fileEditors) {
      const index = this.contributionIndex
      this.contributionIndex += 1
      const result = this.validateContribution(raw)
      if ('reason' in result) {
        this.rejected.push({ index, ...result })
        continue
      }
      const key = `${result.glob}\u0000${result.entryUrl}`
      if (this.pending.has(key)) continue
      this.pending.set(key, { ...result, registrationOrder: this.registrationOrder })
      this.registrationOrder += 1
    }
  }

  private validateContribution(
    raw: unknown,
  ):
    | Omit<RegisteredEditor, 'registrationOrder'>
    | { reason: RegistrationRejectionReason; message?: string } {
    if (!isPlainObject(raw)) {
      return { reason: 'invalid-contribution' }
    }
    for (const key of Object.keys(raw)) {
      if (key !== 'glob' && key !== 'entry' && key !== 'label') {
        return { reason: 'invalid-contribution' }
      }
    }
    if (typeof raw.glob !== 'string') {
      return { reason: 'invalid-glob' }
    }
    const compiled = compileGlob(raw.glob)
    if (!compiled.ok) {
      return { reason: 'invalid-glob' }
    }
    const declared = manifestEditorFor(this.options.manifest, raw.glob)
    if (!declared) {
      return { reason: 'not-declared' }
    }
    if (!hasWorkspaceRead(this.options.manifest.permissions)) {
      return { reason: 'permission-denied' }
    }
    const entry = resolvePluginEntry(
      raw.entry,
      this.options.manifest.manifestUrl,
      this.options.manifest.manifestOrigin,
      this.options.manifest.pluginRoot,
    )
    if (!entry.ok) {
      return {
        reason: entry.reason === 'permission-denied' ? 'permission-denied' : 'invalid-contribution',
      }
    }
    let label = declared.label
    if (raw.label !== undefined) {
      if (typeof raw.label !== 'string' || raw.label.length < 1 || raw.label.length > 40) {
        return { reason: 'invalid-contribution' }
      }
      label = raw.label
    }
    return {
      glob: declared.glob,
      entry: raw.entry as string,
      entryUrl: entry.url,
      label,
      priority: declared.priority,
      rendering: declared.rendering,
    }
  }

  private handleComplete(envelope: Envelope): void {
    if (this.phase !== 'awaiting-register') {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (payload !== undefined && !isPlainObject(payload)) {
      this.violation(envelope)
      return
    }
    if (this.registrationTimer !== null) {
      this.clearTimeoutImpl(this.registrationTimer)
      this.registrationTimer = null
    }
    const editors = [...this.pending.values()]
    const ack: RegistrationAck = {
      accepted: editors.map((editor) => editor.glob),
      rejected: this.rejected,
    }
    this.phase = 'complete'
    this.send('shell/register-ack', ack)
    this.outcomeSent = true
    this.closeTimer = this.setTimeoutImpl(() => {
      this.close()
    }, ACK_CLOSE_DELAY_MS)
    this.options.onOutcome({ kind: 'active', editors, ack })
  }
}
