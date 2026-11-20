import {
  WorkspaceError,
  type WorkspaceChange,
  type WorkspacePath,
  type WorkspaceSession,
} from '../workspace/contract'
import { dirname, isReservedPath, normalizePath } from '../workspace/paths'
import type { FrameHandle, FrameSurface, FrameTransport, PluginMessage } from './frame'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import type { NewFileOutcome, NewFileRequest } from './new-file'
import { ListingBroker } from './listing'
import {
  hasEventsSubscribe,
  hasWorkspaceList,
  hasWorkspaceRead,
  hasWorkspaceWrite,
  type PluginPermission,
} from './manifest'
import type { EventBus, EventSubscriber } from './events'
import { MAX_EVENT_BYTES, isEventTopic, isLocalEventTopic } from './events'
import type { SettingValues } from './settings'
import {
  DISPOSE_TIMEOUT_MS,
  MAX_FILE_PICKER_PATHS,
  MAX_IN_FLIGHT_REQUESTS,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  ViolationBudget,
  buildFrameUrl,
  defaultSessionId,
  frameBoundary,
  isPlainObject,
  parseEnvelope,
  payloadTooLarge,
  postEnvelope,
  postRequest,
  sendShellError,
  type Envelope,
  type FrameMode,
  type ShellErrorCode,
} from './protocol'

export const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024
export const MAX_VIEW_PAYLOAD_BYTES = 64 * 1024
export const MAX_NEW_FILE_BYTES = 8 * 1024 * 1024
export const MAX_INTENTS_PER_SECOND = 10
export const MAX_NEW_FILE_REQUESTS_PER_SECOND = 10
export const INTENT_WINDOW_MS = 1000
const MAX_CACHED_FILES = 32

export type FrameSessionPhase = 'mounting' | 'awaiting-ready' | 'active' | 'disposing' | 'closed'
export type SessionDisposeReason = 'closed' | 'workspace-switch' | 'plugin-removed' | 'error'

export interface SessionFailure {
  code: ShellErrorCode
  phase: string
  message?: string
}

export interface SessionLogEvent {
  phase: string
  code?: string
  message?: string
}

export interface FrameSessionPlugin {
  identity: string
  pluginId: string
  pluginName: string
  pluginVersion: string
  origin: string
  permissions: PluginPermission[]
}

/** The plugin a navigation or panel intent came from. */
export interface IntentSource {
  identity: string
  pluginId: string
  pluginName: string
  origin: string
}

export interface OpenFileIntent {
  id: string
  path: WorkspacePath
}

export interface OpenViewIntent {
  id: string
  pluginId?: string
  viewId: string
  instanceKey?: string
  payload?: unknown
}

export interface PanelIntent {
  id: string
  panel: string
  action: 'show' | 'hide' | 'toggle'
}

export type IntentOutcome = { ok: true } | { ok: false; code: ShellErrorCode; message?: string }

export type PanelIntentOutcome =
  { ok: true; open: boolean } | { ok: false; code: ShellErrorCode; message?: string }

export interface FrameSessionOptions {
  plugin: FrameSessionPlugin
  session: WorkspaceSession
  transport: FrameTransport
  shellVersion: string
  shellOrigin: string
  workspaceName: string
  theme: 'dark' | 'light' | 'high-contrast'
  locale: string
  events: EventBus
  settings?: SettingValues
  maxFileSize: number
  maxRequestBytes: number
  /** Absolute path used to resolve relative reads; null for a view. */
  readBasePath: WorkspacePath | null
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  onActive?: () => void
  onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
  onRequestNewFile?: (request: NewFileRequest) => Promise<NewFileOutcome>
  onFailure: (failure: SessionFailure) => void
  onLog?: (event: SessionLogEvent) => void
  onOpenFile?: (request: OpenFileIntent) => Promise<IntentOutcome>
  onOpenView?: (request: OpenViewIntent) => Promise<IntentOutcome>
  onRequestPanel?: (request: PanelIntent) => Promise<PanelIntentOutcome>
  /** Whether the frame is currently displayed and therefore allowed to act. */
  isVisible?: () => boolean
  /** The permission-derived write capability advertised in `shell/init`. */
  writeCapability?: boolean
}

interface CachedFile {
  version: string
  bytes: Uint8Array
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export function shellCodeFor(error: unknown): ShellErrorCode {
  if (error instanceof WorkspaceError) {
    switch (error.code) {
      case 'not-found':
        return 'not-found'
      case 'permission-denied':
        return 'permission-denied'
      case 'not-a-file':
      case 'not-a-directory':
        return 'not-a-file'
      case 'already-exists':
        return 'already-exists'
      case 'too-large':
        return 'too-large'
      case 'conflict':
        return 'conflict'
      default:
        return 'internal'
    }
  }
  return 'internal'
}

/**
 * Resolve a plugin-supplied read path against an editor document, or require an
 * absolute path for a view. Dot segments are resolved here because `normalizePath`
 * rejects rather than repairs; a path that climbs above the workspace root is
 * refused.
 */
export function resolveSessionPath(
  basePath: WorkspacePath | null,
  requested: unknown,
): WorkspacePath {
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new WorkspaceError('permission-denied', 'A file path is required.')
  }
  if (basePath === null) {
    if (!requested.startsWith('/')) {
      throw new WorkspaceError('permission-denied', 'A view must use a /-rooted path.')
    }
    return normalizePath(requested)
  }
  if (requested.startsWith('/')) return normalizePath(requested)
  const segments = dirname(basePath) === '/' ? [] : dirname(basePath).slice(1).split('/')
  for (const segment of requested.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) {
        throw new WorkspaceError('permission-denied', 'The path leaves the workspace.')
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return normalizePath(`/${segments.join('/')}`)
}

/**
 * The handshake, mediated read path, file picker, events, intents and disposal
 * shared by editor and view frames. Subclasses supply their mode, init block and
 * mode-specific messages; they never duplicate the security-relevant path.
 */
export abstract class FrameSession {
  protected readonly options: FrameSessionOptions
  protected readonly plugin: FrameSessionPlugin
  protected readonly sessionId: string
  protected readonly boundary: ReturnType<typeof frameBoundary>
  protected readonly setTimeoutImpl: typeof setTimeout
  protected readonly clearTimeoutImpl: typeof clearTimeout
  protected readonly readings = new Map<WorkspacePath, CachedFile>()
  protected readonly readIds = new Set<string>()
  protected readonly subscription: EventSubscriber
  protected frame: FrameHandle | null = null
  protected phase: FrameSessionPhase = 'mounting'
  protected readonly listing: ListingBroker
  protected readonly violations: ViolationBudget

  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  private disposeResolve: (() => void) | null = null
  private disposePromise: Promise<void> | null = null
  private failureSent = false
  private pickerId: string | null = null
  private pickerAbort: AbortController | null = null
  private newFileId: string | null = null
  private newFileAbort: AbortController | null = null
  private newFileWindow: { start: number; count: number } | null = null
  private intentWindow: { start: number; count: number } | null = null
  private readonly commandResultListeners = new Set<(envelope: Envelope) => void>()
  private readonly closeListeners = new Set<(reason: 'closed' | 'error') => void>()

  constructor(options: FrameSessionOptions) {
    this.options = options
    this.plugin = options.plugin
    this.sessionId = (options.createSessionId ?? defaultSessionId)()
    this.boundary = frameBoundary(options.plugin.origin, options.shellOrigin)
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
    this.violations = new ViolationBudget(() => this.fail('protocol-violation', 'active'))
    this.listing = new ListingBroker({
      list: (path, listOptions) =>
        this.options.session.forPlugin(this.options.plugin.pluginId).list(path, listOptions),
      caseSensitive: options.session.capabilities().caseSensitive,
      setTimeoutImpl: this.setTimeoutImpl,
      clearTimeoutImpl: this.clearTimeoutImpl,
    })
    this.subscription = options.events.createSubscriber({
      label: options.plugin.pluginId,
      identity: options.plugin.identity,
      deliver: (event) => {
        postEnvelope(this.frame, this.boundary.targetOrigin, 'shell/event', event)
      },
      onError: (topic, code) => {
        sendShellError(
          this.frame,
          this.boundary.targetOrigin,
          code,
          undefined,
          `Event queue overflow for ${topic}.`,
        )
        this.log(`${this.logPrefix}-events`, code, topic)
      },
    })
  }

  abstract readonly mode: FrameMode

  get identity(): string {
    return this.plugin.identity
  }

  get active(): boolean {
    return this.phase === 'active'
  }

  get surface(): FrameSurface | undefined {
    return this.frame?.surface
  }

  hasFocus(): boolean {
    return this.frame?.hasFocus?.() ?? false
  }

  /** Send one `shell/command` to this active frame; false means nothing was sent. */
  sendCommand(invocationId: string, commandId: string, args?: unknown): boolean {
    if (this.phase !== 'active' || !this.frame) return false
    postRequest(this.frame, this.boundary.targetOrigin, 'shell/command', invocationId, {
      command: commandId,
      ...(args === undefined ? {} : { args }),
    })
    return true
  }

  /** Observe `plugin/command-result` messages for this frame. */
  onCommandResult(listener: (envelope: Envelope) => void): () => void {
    this.commandResultListeners.add(listener)
    return () => {
      this.commandResultListeners.delete(listener)
    }
  }

  /** Observe this frame's disposal or failure. */
  onClosed(listener: (reason: 'closed' | 'error') => void): () => void {
    this.closeListeners.add(listener)
    return () => {
      this.closeListeners.delete(listener)
    }
  }

  private notifyClosed(reason: 'closed' | 'error'): void {
    for (const listener of [...this.closeListeners]) {
      try {
        listener(reason)
      } catch {
        // A listener must not break teardown.
      }
    }
    this.closeListeners.clear()
    this.commandResultListeners.clear()
  }

  cancelFilePicker(): void {
    const abort = this.pickerAbort
    this.pickerAbort = null
    this.pickerId = null
    abort?.abort()
  }

  cancelNewFile(): void {
    const abort = this.newFileAbort
    this.newFileAbort = null
    this.newFileId = null
    abort?.abort()
  }

  protected mountFrame(input: { entryUrl: string; visible: boolean; title: string }): void {
    if (this.phase !== 'mounting') return
    let frame: FrameHandle
    try {
      frame = this.options.transport.open({
        url: buildFrameUrl(input.entryUrl, this.options.shellOrigin, this.mode, this.sessionId),
        sandbox: this.boundary.sandbox,
        ...(input.visible ? { visible: true, title: input.title } : {}),
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

  async dispose(reason: SessionDisposeReason): Promise<void> {
    if (this.phase === 'closed') return
    if (this.phase === 'disposing') return this.disposePromise ?? Promise.resolve()
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.cancelNewFile()
    this.listing.reset()
    this.onClosing()
    this.notifyClosed('closed')
    if (!this.frame) {
      this.phase = 'closed'
      return
    }
    this.phase = 'disposing'
    postEnvelope(this.frame, this.boundary.targetOrigin, 'shell/dispose', { reason })
    this.disposePromise = new Promise<void>((resolve) => {
      this.disposeResolve = resolve
      this.disposeTimer = this.setTimeoutImpl(() => {
        this.finishDispose()
      }, DISPOSE_TIMEOUT_MS)
    })
    return this.disposePromise
  }

  close(): void {
    if (this.phase === 'closed') return
    this.phase = 'closed'
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.cancelNewFile()
    this.listing.reset()
    this.readings.clear()
    this.readIds.clear()
    this.onClosing()
    this.frame?.close()
    this.frame = null
    this.disposeResolve?.()
    this.disposeResolve = null
    this.notifyClosed('closed')
  }

  protected abstract buildModeInit(): Record<string, unknown>

  protected abstract handleModeMessage(envelope: Envelope): boolean

  protected onClosing(): void {}

  protected get logPrefix(): string {
    return this.mode === 'editor' ? 'handler' : 'view'
  }

  protected failPhaseName(): string {
    return this.phase === 'mounting' || this.phase === 'awaiting-ready' ? 'ready' : this.mode
  }

  protected sendError(code: ShellErrorCode, replyTo?: string, message?: string): void {
    sendShellError(this.frame, this.boundary.targetOrigin, code, replyTo, message)
  }

  protected log(phase: string, code?: string, message?: string): void {
    this.options.onLog?.({ phase, code, message })
  }

  protected post(type: string, payload?: unknown, replyTo?: string): void {
    postEnvelope(this.frame, this.boundary.targetOrigin, type, payload, replyTo)
  }

  protected violation(envelope?: Envelope, reply = true): void {
    if (reply) this.sendError('protocol-violation', envelope?.id)
    this.violations.record()
  }

  protected invalidateReads(): void {
    this.readings.clear()
  }

  notifyChange(change: WorkspaceChange): void {
    if (change.kind === 'renamed') {
      this.readings.delete(change.previousPath)
      this.readings.delete(change.path)
    } else {
      this.readings.delete(change.path)
    }
    if (this.phase !== 'active') return
    const payload =
      change.kind === 'deleted'
        ? { path: change.path, kind: 'deleted' as const }
        : { path: change.path, kind: change.kind, version: change.stat.version }
    this.post('shell/file-changed', payload)
  }

  private phaseName(): string {
    return this.failPhaseName()
  }

  private clearTimers(): void {
    if (this.readyTimer !== null) {
      this.clearTimeoutImpl(this.readyTimer)
      this.readyTimer = null
    }
    if (this.disposeTimer !== null) {
      this.clearTimeoutImpl(this.disposeTimer)
      this.disposeTimer = null
    }
  }

  private fail(code: ShellErrorCode, phase: string, message?: string): void {
    if (this.phase === 'closed' || this.failureSent) return
    this.failureSent = true
    this.phase = 'closed'
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.cancelNewFile()
    this.listing.reset()
    this.onClosing()
    this.frame?.close()
    this.frame = null
    this.options.onFailure({ code, phase, message })
    this.notifyClosed('error')
  }

  private finishDispose(): void {
    if (this.phase === 'closed') return
    this.phase = 'closed'
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.cancelNewFile()
    this.listing.reset()
    this.readings.clear()
    this.readIds.clear()
    this.onClosing()
    this.frame?.close()
    this.frame = null
    this.disposeResolve?.()
    this.disposeResolve = null
    this.notifyClosed('closed')
  }

  private handleMessage(message: PluginMessage): void {
    if (this.phase === 'closed') return
    if (!this.frame || message.source !== this.frame.window) return

    const envelope = parseEnvelope(message.data)
    if (!envelope) return

    if (this.boundary.opaque) {
      if (message.origin !== 'null') {
        this.violation(envelope, false)
        return
      }
    } else if (message.origin !== this.plugin.origin) {
      this.violation(envelope, false)
      return
    }

    if (payloadTooLarge(envelope.payload)) {
      this.sendError('too-large', envelope.id)
      this.violation(undefined, false)
      return
    }

    if (this.phase === 'disposing') {
      if (envelope.type === 'plugin/dispose-ack') this.finishDispose()
      return
    }

    if (this.phase === 'awaiting-ready') {
      if (envelope.type === 'plugin/ready') {
        this.handleReady(envelope)
      } else {
        this.violation(envelope)
      }
      return
    }

    if (this.phase !== 'active') return

    if (this.handleModeMessage(envelope)) return

    switch (envelope.type) {
      case 'plugin/ready':
        this.violation(envelope)
        return
      case 'plugin/request-file':
        void this.handleRequestFile(envelope)
        return
      case 'plugin/request-files':
        void this.handleRequestFiles(envelope)
        return
      case 'plugin/request-new-file':
        void this.handleRequestNewFile(envelope)
        return
      case 'plugin/request-list':
        void this.handleRequestList(envelope)
        return
      case 'plugin/subscribe':
        this.handleSubscribe(envelope)
        return
      case 'plugin/unsubscribe':
        this.handleUnsubscribe(envelope)
        return
      case 'plugin/publish':
        this.handlePublish(envelope)
        return
      case 'plugin/open-file':
        void this.handleOpenFile(envelope)
        return
      case 'plugin/open-view':
        void this.handleOpenView(envelope)
        return
      case 'plugin/request-panel':
        void this.handleRequestPanel(envelope)
        return
      case 'plugin/dispose-ack':
        return
      case 'plugin/command-result':
        this.handleCommandResult(envelope)
        return
      case 'plugin/register':
      case 'plugin/register-complete':
        this.violation(envelope)
        return
      default:
        if (envelope.id) this.sendError('unsupported-message', envelope.id)
        return
    }
  }

  private handleCommandResult(envelope: Envelope): void {
    if (this.phase !== 'active') return
    for (const listener of [...this.commandResultListeners]) {
      try {
        listener(envelope)
      } catch {
        // A controller listener must not break protocol dispatch.
      }
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
    this.phase = 'active'
    this.post('shell/init', {
      protocolVersion: PROTOCOL_VERSION,
      mode: this.mode,
      sessionId: this.sessionId,
      plugin: { id: this.plugin.pluginId, version: this.plugin.pluginVersion },
      shell: { version: this.options.shellVersion, origin: this.options.shellOrigin },
      workspace: { name: this.options.workspaceName },
      theme: this.options.theme,
      permissions: this.plugin.permissions,
      locale: this.options.locale,
      settings: this.options.settings ?? {},
      capabilities: {
        read: hasWorkspaceRead(this.plugin.permissions),
        write: this.options.writeCapability ?? this.options.session.capabilities().writable,
        requestFiles: hasWorkspaceRead(this.plugin.permissions),
        filePicker: this.options.onRequestFiles !== undefined,
        createFile: this.options.onRequestNewFile !== undefined,
        directoryListing: true,
        localEvents: true,
        openFile: true,
        openView: true,
        requestPanel: true,
        commands: true,
      },
      limits: {
        maxFileSize: this.options.maxFileSize,
        maxRequestBytes: this.options.maxRequestBytes,
      },
      ...this.buildModeInit(),
    })
    this.options.onActive?.()
    this.log(this.mode, 'open')
  }

  private handleSubscribe(envelope: Envelope): void {
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.topic !== 'string' ||
      payload.topic.length === 0
    ) {
      this.violation(envelope)
      return
    }
    if (!hasEventsSubscribe(this.plugin.permissions)) {
      this.sendError('permission-denied', envelope.id)
      this.log(`${this.logPrefix}-events`, 'permission-denied', payload.topic)
      return
    }
    const result = this.subscription.subscribe(payload.topic)
    if (result.ok) {
      this.post('shell/subscribed', { topic: payload.topic, seq: result.seq }, envelope.id)
      this.log(`${this.logPrefix}-events`, 'subscribed', payload.topic)
      return
    }
    if (result.code === 'unsupported-topic') {
      this.post(
        'shell/subscribed',
        { topic: payload.topic, code: 'unsupported-topic' },
        envelope.id,
      )
      return
    }
    this.sendError('rate-limited', envelope.id)
    this.log(`${this.logPrefix}-events`, result.code, payload.topic)
  }

  private handleUnsubscribe(envelope: Envelope): void {
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.topic !== 'string' ||
      payload.topic.length === 0
    ) {
      this.violation(envelope)
      return
    }
    this.subscription.unsubscribe(payload.topic)
  }

  private handlePublish(envelope: Envelope): void {
    const id = envelope.id
    const payload = envelope.payload
    if (
      !id ||
      !isPlainObject(payload) ||
      typeof payload.topic !== 'string' ||
      Object.keys(payload).some((key) => key !== 'topic' && key !== 'payload')
    ) {
      this.violation(envelope)
      return
    }
    if (!hasEventsSubscribe(this.plugin.permissions)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-events`, 'permission-denied', payload.topic)
      return
    }
    if (isEventTopic(payload.topic)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-events`, 'permission-denied', payload.topic)
      return
    }
    if (!isLocalEventTopic(payload.topic)) {
      this.sendError(
        'unsupported-topic',
        id,
        'Local event topics use local/<name> with a lowercase 1-64 character name.',
      )
      this.log(`${this.logPrefix}-events`, 'unsupported-topic', payload.topic)
      return
    }
    const result = this.options.events.publishLocal(
      this.subscription,
      payload.topic,
      payload.payload,
      { from: this.sessionId },
    )
    if (result.ok) {
      this.post('shell/published', { topic: payload.topic, seq: result.seq }, id)
      this.log(`${this.logPrefix}-events`, 'published', payload.topic)
      return
    }
    if (result.code === 'too-large') {
      this.sendError(
        'too-large',
        id,
        `Local event payloads are limited to ${MAX_EVENT_BYTES} bytes.`,
      )
    } else {
      this.sendError(result.code, id)
    }
    this.log(`${this.logPrefix}-events`, result.code, payload.topic)
  }

  private async handleRequestFiles(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload === undefined ? {} : envelope.payload
    if (!isPlainObject(payload)) {
      this.violation(envelope)
      return
    }
    if (Object.keys(payload).some((key) => key !== 'multiple' && key !== 'directory')) {
      this.violation(envelope)
      return
    }
    if (payload.multiple !== undefined && typeof payload.multiple !== 'boolean') {
      this.violation(envelope)
      return
    }
    if (payload.directory !== undefined && typeof payload.directory !== 'string') {
      this.violation(envelope)
      return
    }
    if (!hasWorkspaceRead(this.plugin.permissions)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-picker`, 'permission-denied')
      return
    }
    if (this.pickerId !== null) {
      this.sendError('rate-limited', id)
      this.log(`${this.logPrefix}-picker`, 'rate-limited')
      return
    }
    const onRequestFiles = this.options.onRequestFiles
    if (!onRequestFiles) {
      this.sendError('internal', id)
      this.log(`${this.logPrefix}-picker`, 'internal')
      return
    }

    const abort = new AbortController()
    this.pickerId = id
    this.pickerAbort = abort
    let outcome: FilePickerOutcome
    try {
      outcome = await onRequestFiles({
        path: this.options.readBasePath ?? '/',
        pluginId: this.plugin.pluginId,
        pluginName: this.plugin.pluginName,
        multiple: payload.multiple === true,
        ...(payload.directory === undefined ? {} : { directory: payload.directory }),
        session: this.options.session,
        signal: abort.signal,
      })
    } catch {
      if (this.phase === 'active' && this.pickerId === id) {
        this.sendError('internal', id)
        this.log(`${this.logPrefix}-picker`, 'internal')
      }
      return
    } finally {
      if (this.pickerId === id) {
        this.pickerId = null
        this.pickerAbort = null
      }
    }

    if (this.phase !== 'active' || abort.signal.aborted) return
    if ('silent' in outcome) return
    if (!outcome.ok) {
      this.sendError(outcome.code, id)
      this.log(`${this.logPrefix}-picker`, outcome.code)
      return
    }

    const paths = outcome.paths
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
      this.sendError('internal', id)
      this.log(`${this.logPrefix}-picker`, 'internal')
      return
    }
    if (paths.length > MAX_FILE_PICKER_PATHS || (payload.multiple !== true && paths.length > 1)) {
      this.sendError('internal', id)
      this.log(`${this.logPrefix}-picker`, 'internal')
      return
    }
    const caseSensitive = this.options.session.capabilities().caseSensitive
    const selected: WorkspacePath[] = []
    for (const raw of paths) {
      let path: WorkspacePath
      try {
        path = normalizePath(raw)
      } catch {
        this.sendError('permission-denied', id)
        this.log(`${this.logPrefix}-picker`, 'permission-denied')
        return
      }
      if (isReservedPath(path, caseSensitive)) {
        this.sendError('permission-denied', id)
        this.log(`${this.logPrefix}-picker`, 'permission-denied')
        return
      }
      selected.push(path)
    }
    this.post('shell/files-selected', { paths: selected }, id)
    this.log(`${this.logPrefix}-picker`, 'ok')
  }

  private async handleRequestNewFile(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      Object.keys(payload).some(
        (key) =>
          key !== 'text' && key !== 'bytes' && key !== 'suggestedName' && key !== 'directory',
      )
    ) {
      this.violation(envelope)
      return
    }
    const hasText = typeof payload.text === 'string'
    const hasBytes = payload.bytes instanceof ArrayBuffer || ArrayBuffer.isView(payload.bytes)
    if (hasText === hasBytes) {
      this.violation(envelope)
      return
    }
    if (payload.suggestedName !== undefined && typeof payload.suggestedName !== 'string') {
      this.violation(envelope)
      return
    }
    if (payload.directory !== undefined && typeof payload.directory !== 'string') {
      this.violation(envelope)
      return
    }
    if (!this.allowNewFile()) {
      this.sendError('rate-limited', id)
      this.log(`${this.logPrefix}-new-file`, 'rate-limited')
      return
    }
    if (
      !hasWorkspaceWrite(this.plugin.permissions) ||
      !(this.options.writeCapability ?? this.options.session.capabilities().writable)
    ) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-new-file`, 'permission-denied')
      return
    }
    if (!this.visible() || !this.hasFocus()) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-new-file`, 'permission-denied')
      return
    }
    if (this.newFileId !== null) {
      this.sendError('rate-limited', id)
      this.log(`${this.logPrefix}-new-file`, 'rate-limited')
      return
    }
    const handler = this.options.onRequestNewFile
    if (!handler) {
      this.sendError('internal', id)
      this.log(`${this.logPrefix}-new-file`, 'internal')
      return
    }

    let bytes: Uint8Array
    let text: string | undefined
    if (hasText) {
      text = payload.text as string
      bytes = new TextEncoder().encode(text)
    } else {
      const raw = payload.bytes
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw.slice(0))
      } else {
        const view = raw as ArrayBufferView
        const copy = new Uint8Array(view.byteLength)
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
        bytes = copy
      }
    }
    if (bytes.byteLength > MAX_NEW_FILE_BYTES) {
      this.sendError(
        'too-large',
        id,
        `Generated files are limited to ${MAX_NEW_FILE_BYTES} bytes; this request is ${bytes.byteLength} bytes.`,
      )
      this.log(`${this.logPrefix}-new-file`, 'too-large')
      return
    }

    const abort = new AbortController()
    this.newFileId = id
    this.newFileAbort = abort
    let outcome: NewFileOutcome
    try {
      outcome = await handler({
        kind: 'request',
        identity: this.plugin.identity,
        pluginId: this.plugin.pluginId,
        pluginName: this.plugin.pluginName,
        content: { bytes, ...(text === undefined ? {} : { text }) },
        fallbackDirectory: dirname(this.options.readBasePath ?? '/'),
        ...(payload.suggestedName === undefined ? {} : { suggestedName: payload.suggestedName }),
        ...(payload.directory === undefined ? {} : { directory: payload.directory }),
        session: this.options.session,
        signal: abort.signal,
      })
    } catch {
      if (this.phase === 'active' && this.newFileId === id) {
        this.sendError('internal', id)
        this.log(`${this.logPrefix}-new-file`, 'internal')
      }
      return
    } finally {
      if (this.newFileId === id) {
        this.newFileId = null
        this.newFileAbort = null
      }
    }

    if (this.phase !== 'active' || abort.signal.aborted) return
    if ('silent' in outcome) return
    if ('cancelled' in outcome) {
      this.post('shell/new-file-result', { cancelled: true }, id)
      this.log(`${this.logPrefix}-new-file`, 'cancelled')
      return
    }
    if (!outcome.ok) {
      this.sendError(outcome.code, id, outcome.message)
      this.log(`${this.logPrefix}-new-file`, outcome.code)
      return
    }
    this.post('shell/new-file-result', { path: outcome.path, version: outcome.version }, id)
    this.log(`${this.logPrefix}-new-file`, 'created', outcome.path)
  }

  private async handleRequestList(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.path !== 'string' ||
      (payload.cursor !== undefined && typeof payload.cursor !== 'string') ||
      Object.keys(payload).some((key) => key !== 'path' && key !== 'cursor')
    ) {
      this.violation(envelope)
      return
    }
    if (!hasWorkspaceList(this.plugin.permissions)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-list`, 'permission-denied')
      return
    }

    let path: WorkspacePath
    try {
      path = resolveSessionPath(this.options.readBasePath, payload.path)
    } catch {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-list`, 'permission-denied')
      return
    }
    if (isReservedPath(path, this.options.session.capabilities().caseSensitive)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-list`, 'permission-denied')
      return
    }

    const result = await this.listing.list(path, payload.cursor as string | undefined)
    if (this.phase !== 'active') return
    if (!result.ok) {
      this.sendError(result.code, id)
      this.log(`${this.logPrefix}-list`, result.code)
      return
    }
    this.post('shell/list-result', result.page, id)
    this.log(`${this.logPrefix}-list`, 'ok', path)
  }

  private async handleRequestFile(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.path !== 'string' ||
      (payload.encoding !== 'utf8' && payload.encoding !== 'binary')
    ) {
      this.violation(envelope)
      return
    }
    if (!hasWorkspaceRead(this.plugin.permissions)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-read`, 'permission-denied')
      return
    }

    let path: WorkspacePath
    try {
      path = resolveSessionPath(this.options.readBasePath, payload.path)
    } catch {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-read`, 'permission-denied')
      return
    }
    if (isReservedPath(path, this.options.session.capabilities().caseSensitive)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-read`, 'permission-denied')
      return
    }
    if (this.readIds.has(id) || this.readIds.size >= MAX_IN_FLIGHT_REQUESTS) {
      this.sendError('rate-limited', id)
      return
    }
    this.readIds.add(id)

    try {
      const facade = this.options.session.forPlugin(this.plugin.pluginId)
      const stat = await facade.stat(path)
      if (this.phase !== 'active') return
      if (stat.kind !== 'file') {
        this.sendError('not-a-file', id)
        return
      }
      if (stat.size > this.options.maxRequestBytes) {
        this.sendError('too-large', id)
        return
      }
      let cached = this.readings.get(path)
      if (!cached || cached.version !== stat.version) {
        const bytes = await facade.read(path, { maxBytes: this.options.maxRequestBytes })
        if (this.phase !== 'active') return
        cached = { version: stat.version, bytes: new Uint8Array(bytes) }
        if (this.readings.size >= MAX_CACHED_FILES) {
          const oldest = this.readings.keys().next().value
          if (oldest !== undefined) this.readings.delete(oldest)
        }
        this.readings.set(path, cached)
      }
      const body =
        payload.encoding === 'utf8'
          ? { path, version: cached.version, text: new TextDecoder().decode(cached.bytes) }
          : { path, version: cached.version, bytes: toArrayBuffer(cached.bytes) }
      this.post('shell/file-content', body, id)
      this.onReadVersion(path, cached.version)
    } catch (error) {
      if (this.phase !== 'active') return
      const code = shellCodeFor(error)
      this.sendError(code, id)
      this.log(`${this.logPrefix}-read`, code)
    } finally {
      this.readIds.delete(id)
    }
  }

  /** An editor updates its bound version; a view has nothing to update. */
  protected onReadVersion(_path: WorkspacePath, _version: string): void {
    void _path
    void _version
  }

  private allowIntent(): boolean {
    const now = Date.now()
    if (!this.intentWindow || now - this.intentWindow.start >= INTENT_WINDOW_MS) {
      this.intentWindow = { start: now, count: 0 }
    }
    if (this.intentWindow.count >= MAX_INTENTS_PER_SECOND) return false
    this.intentWindow.count += 1
    return true
  }

  private allowNewFile(): boolean {
    const now = Date.now()
    if (!this.newFileWindow || now - this.newFileWindow.start >= INTENT_WINDOW_MS) {
      this.newFileWindow = { start: now, count: 0 }
    }
    if (this.newFileWindow.count >= MAX_NEW_FILE_REQUESTS_PER_SECOND) return false
    this.newFileWindow.count += 1
    return true
  }

  private visible(): boolean {
    return this.options.isVisible?.() ?? true
  }

  private async handleOpenFile(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    if (!this.allowIntent()) {
      this.sendError('rate-limited', id)
      this.log(`${this.logPrefix}-intent`, 'rate-limited', 'open-file')
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.path !== 'string' ||
      Object.keys(payload).some((key) => key !== 'path')
    ) {
      this.violation(envelope)
      return
    }
    if (!hasWorkspaceRead(this.plugin.permissions)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-intent`, 'permission-denied', 'open-file')
      return
    }
    if (!this.visible()) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-intent`, 'permission-denied', 'open-file')
      return
    }
    let path: WorkspacePath
    try {
      path = resolveSessionPath(this.options.readBasePath, payload.path)
    } catch {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-intent`, 'permission-denied', 'open-file')
      return
    }
    if (isReservedPath(path, this.options.session.capabilities().caseSensitive)) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-intent`, 'permission-denied', 'open-file')
      return
    }
    const handler = this.options.onOpenFile
    if (!handler) {
      this.sendError('unsupported-message', id)
      return
    }
    const outcome = await handler({ id, path })
    if (this.phase !== 'active') return
    if (!outcome.ok) {
      this.sendError(outcome.code, id, outcome.message)
      this.log(`${this.logPrefix}-intent`, outcome.code, 'open-file')
      return
    }
    this.post('shell/open-result', { ok: true }, id)
    this.log(`${this.logPrefix}-intent`, 'ok', 'open-file')
  }

  private async handleOpenView(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    if (!this.allowIntent()) {
      this.sendError('rate-limited', id)
      this.log(`${this.logPrefix}-intent`, 'rate-limited', 'open-view')
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.viewId !== 'string' ||
      payload.viewId.length === 0 ||
      payload.viewId.length > 64 ||
      (payload.pluginId !== undefined &&
        (typeof payload.pluginId !== 'string' ||
          payload.pluginId.length === 0 ||
          payload.pluginId.length > 80)) ||
      (payload.instanceKey !== undefined &&
        (typeof payload.instanceKey !== 'string' || payload.instanceKey.length > 64)) ||
      Object.keys(payload).some(
        (key) =>
          key !== 'pluginId' && key !== 'viewId' && key !== 'instanceKey' && key !== 'payload',
      )
    ) {
      this.violation(envelope)
      return
    }
    if (!this.visible()) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-intent`, 'permission-denied', 'open-view')
      return
    }
    if (payload.payload !== undefined && payloadTooLarge(payload.payload, MAX_VIEW_PAYLOAD_BYTES)) {
      this.sendError(
        'too-large',
        id,
        `Content-view payloads are limited to ${MAX_VIEW_PAYLOAD_BYTES} bytes.`,
      )
      this.log(`${this.logPrefix}-intent`, 'too-large', 'open-view')
      return
    }
    const handler = this.options.onOpenView
    if (!handler) {
      this.sendError('unsupported-message', id)
      return
    }
    const intent: OpenViewIntent = {
      id,
      viewId: payload.viewId,
      ...(payload.pluginId === undefined ? {} : { pluginId: payload.pluginId }),
      ...(payload.instanceKey === undefined ? {} : { instanceKey: payload.instanceKey }),
      ...(payload.payload === undefined ? {} : { payload: payload.payload }),
    }
    const outcome = await handler(intent)
    if (this.phase !== 'active') return
    if (!outcome.ok) {
      this.sendError(outcome.code, id, outcome.message)
      this.log(`${this.logPrefix}-intent`, outcome.code, 'open-view')
      return
    }
    this.post('shell/open-result', { ok: true }, id)
    this.log(`${this.logPrefix}-intent`, 'ok', 'open-view')
  }

  private async handleRequestPanel(envelope: Envelope): Promise<void> {
    const id = envelope.id
    if (!id) {
      this.violation(envelope)
      return
    }
    if (!this.allowIntent()) {
      this.sendError('rate-limited', id)
      this.log(`${this.logPrefix}-intent`, 'rate-limited', 'request-panel')
      return
    }
    const payload = envelope.payload
    if (
      !isPlainObject(payload) ||
      typeof payload.panel !== 'string' ||
      payload.panel.length === 0 ||
      payload.panel.length > 64 ||
      (payload.action !== 'show' && payload.action !== 'hide' && payload.action !== 'toggle') ||
      Object.keys(payload).some((key) => key !== 'panel' && key !== 'action')
    ) {
      this.violation(envelope)
      return
    }
    if (!this.visible()) {
      this.sendError('permission-denied', id)
      this.log(`${this.logPrefix}-intent`, 'permission-denied', 'request-panel')
      return
    }
    const handler = this.options.onRequestPanel
    if (!handler) {
      this.sendError('unsupported-message', id)
      return
    }
    const outcome = await handler({
      id,
      panel: payload.panel,
      action: payload.action as 'show' | 'hide' | 'toggle',
    })
    if (this.phase !== 'active') return
    if (!outcome.ok) {
      this.sendError(outcome.code, id, outcome.message)
      this.log(`${this.logPrefix}-intent`, outcome.code, 'request-panel')
      return
    }
    this.post('shell/panel-result', { panel: payload.panel, open: outcome.open }, id)
    this.log(`${this.logPrefix}-intent`, 'ok', 'request-panel')
  }
}
