import { compileGlob } from './glob'
import { resolvePluginEntry, type ManifestFileEditor, type PluginManifest } from './manifest'
import type { FrameHandle, FrameSandbox, FrameTransport, PluginMessage } from './frame'

export const PROTOCOL_VERSION = '1'
export const READY_TIMEOUT_MS = 10_000
export const REGISTRATION_TIMEOUT_MS = 10_000
export const ACK_CLOSE_DELAY_MS = 250
export const MAX_PROTOCOL_VIOLATIONS = 3
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024

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

export type ShellErrorCode =
  | 'unsupported-message'
  | 'unsupported-version'
  | 'protocol-violation'
  | 'timeout'
  | 'loading-failed'
  | 'permission-denied'
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'conflict'
  | 'rate-limited'
  | 'internal'

interface Envelope {
  exo: 1
  type: string
  id?: string
  replyTo?: string
  payload?: unknown
}

export interface RegistrationSessionOptions {
  manifest: PluginManifest
  transport: FrameTransport
  shellVersion: string
  shellOrigin: string
  workspaceName: string
  theme: 'dark' | 'light' | 'high-contrast'
  locale: string
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  onOutcome: (outcome: RegistrationOutcome) => void
}

type Phase = 'mounting' | 'awaiting-ready' | 'awaiting-register' | 'complete' | 'closed'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function defaultSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `exo-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseEnvelope(data: unknown): Envelope | null {
  if (!isPlainObject(data) || data.exo !== 1) return null
  if (typeof data.type !== 'string' || data.type.length === 0) return null
  if (data.id !== undefined && (typeof data.id !== 'string' || data.id.length > 64)) return null
  if (
    data.replyTo !== undefined &&
    (typeof data.replyTo !== 'string' || data.replyTo.length > 64)
  ) {
    return null
  }
  return data as unknown as Envelope
}

function sizeOf(value: unknown, limit: number, seen: Set<object>): number {
  if (typeof value === 'string') return value.length * 2
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 8
  if (value === null || value === undefined) return 0
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) {
      total += sizeOf(item, limit - total, seen)
      if (total > limit) return total
    }
    return total
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return 0
    seen.add(value)
    let total = 0
    for (const [key, item] of Object.entries(value)) {
      total += key.length * 2 + sizeOf(item, limit - total, seen)
      if (total > limit) return total
    }
    return total
  }
  return 0
}

function payloadTooLarge(payload: unknown): boolean {
  return sizeOf(payload, MAX_MESSAGE_BYTES, new Set()) > MAX_MESSAGE_BYTES
}

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
  private violations = 0
  private outcomeSent = false
  private contributionIndex = 0
  private registrationOrder = 0
  private readonly pending = new Map<string, RegisteredEditor>()
  private readonly rejected: RejectedContribution[] = []

  constructor(options: RegistrationSessionOptions) {
    this.options = options
    this.sessionId = (options.createSessionId ?? defaultSessionId)()
    this.opaque = options.manifest.manifestOrigin === options.shellOrigin
    this.sandbox = this.opaque ? 'allow-scripts' : 'allow-scripts allow-same-origin'
    this.targetOrigin = this.opaque ? '*' : options.manifest.manifestOrigin
    this.setTimeoutImpl = options.setTimeoutImpl ?? setTimeout
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout
  }

  start(): void {
    if (this.phase !== 'mounting') return
    const url = new URL(this.options.manifest.controllerUrl)
    const params = new URLSearchParams()
    params.set('exo-host', this.options.shellOrigin)
    params.set('exo-mode', 'register')
    params.set('exo-session', this.sessionId)
    url.hash = params.toString()

    let frame: FrameHandle
    try {
      frame = this.options.transport.open({
        url: url.href,
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
    const envelope: Envelope = { exo: 1, type }
    if (replyTo !== undefined) envelope.replyTo = replyTo
    if (payload !== undefined) envelope.payload = payload
    this.frame?.window?.postMessage(envelope, this.targetOrigin)
  }

  private sendError(code: ShellErrorCode, replyTo?: string, message?: string): void {
    this.send('shell/error', { code, ...(message ? { message } : {}) }, replyTo)
  }

  private violation(envelope?: Envelope, reply = true): void {
    this.violations += 1
    if (reply) this.sendError('protocol-violation', envelope?.id)
    if (this.violations >= MAX_PROTOCOL_VIOLATIONS) {
      if (this.outcomeSent) {
        this.close()
      } else {
        this.fail('protocol-violation', this.phaseName())
      }
    }
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
    this.options.onOutcome({ kind: 'active', editors, ack })
    this.closeTimer = this.setTimeoutImpl(() => {
      this.close()
    }, ACK_CLOSE_DELAY_MS)
  }
}
