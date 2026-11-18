import {
  WorkspaceError,
  asWorkspaceError,
  type WorkspaceChange,
  type WorkspacePath,
  type WorkspaceSession,
} from '../workspace/contract'
import { basename, dirname, isReservedPath, normalizePath } from '../workspace/paths'
import type { FrameHandle, FrameSurface, FrameTransport, PluginMessage } from './frame'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import { ListingBroker } from './listing'
import {
  hasEventsSubscribe,
  hasWorkspaceList,
  hasWorkspaceRead,
  hasWorkspaceWrite,
} from './manifest'
import type { EventBus, EventSubscriber } from './events'
import type { EditorCandidate } from './registry'
import type { SettingValues } from './settings'
import {
  DISPOSE_TIMEOUT_MS,
  MAX_FILE_PICKER_PATHS,
  MAX_IN_FLIGHT_REQUESTS,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  SAVE_TIMEOUT_MS,
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
  type ShellErrorCode,
} from './protocol'

export const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_CACHED_FILES = 32

export interface HandlerFileMetadata {
  path: WorkspacePath
  name: string
  dir: string
  size: number
  mtime: number
  version: string
  languageHint?: string
}

export interface HandlerFailure {
  code: ShellErrorCode
  phase: 'ready' | 'editor'
  message?: string
}

export interface HandlerLogEvent {
  phase: string
  code?: string
  message?: string
}

export type HandlerSaveContent = { text: string } | { bytes: ArrayBuffer }

export type HandlerSaveRequest =
  | {
      ok: true
      requestId: string
      content: HandlerSaveContent
      baseVersion: string
    }
  | { ok: false; code: ShellErrorCode }

export type HandlerSaveCompletion =
  { ok: true; version: string } | { ok: false; code: ShellErrorCode; message?: string }

export type HandlerDisposeReason = 'closed' | 'workspace-switch' | 'plugin-removed' | 'error'

export interface HandlerSessionOptions {
  candidate: EditorCandidate
  file: HandlerFileMetadata
  session: WorkspaceSession
  transport: FrameTransport
  shellVersion: string
  shellOrigin: string
  workspaceName: string
  theme: 'dark' | 'light' | 'high-contrast'
  locale: string
  events: EventBus
  /** `workspace:write` and a writable session; checked again at save time. */
  canWrite: boolean
  maxFileSize: number
  maxRequestBytes: number
  /** Resolved workspace-scoped settings for this plugin; defaults when absent. */
  settings?: SettingValues
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  onActive?: () => void
  /** The plugin asked the shell to save this document (id-less intent). */
  onSaveRequested?: () => void
  /** Open the shell-owned file picker; absent means the support bit is false. */
  onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
  onDirty: (dirty: boolean) => void
  onFailure: (failure: HandlerFailure) => void
  onVersion?: (version: string) => void
  onLog?: (event: HandlerLogEvent) => void
}

type Phase = 'mounting' | 'awaiting-ready' | 'active' | 'disposing' | 'closed'

interface CachedFile {
  version: string
  bytes: Uint8Array
}

interface LiveSave {
  id: string
  baseVersion: string
  stage: 'content' | 'write'
  resolve: (request: HandlerSaveRequest) => void
  timer: ReturnType<typeof setTimeout> | null
}

const LANGUAGE_HINTS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  json: 'json',
  md: 'markdown',
  css: 'css',
  html: 'html',
  py: 'python',
  rs: 'rust',
  go: 'go',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
}

function languageHint(path: WorkspacePath): string | undefined {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  if (index < 0 || index === name.length - 1) return undefined
  return LANGUAGE_HINTS[name.slice(index + 1).toLowerCase()]
}

/**
 * Resolve a plugin-supplied read path against the handler file's directory.
 * Dot segments are resolved here because `normalizePath` rejects rather than
 * repairs; a path that climbs above the workspace root is refused.
 */
export function resolveHandlerReadPath(basePath: WorkspacePath, requested: unknown): WorkspacePath {
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new WorkspaceError('permission-denied', 'A file path is required.')
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function saveContentOf(payload: unknown): HandlerSaveContent | null {
  if (!isPlainObject(payload)) return null
  const keys = Object.keys(payload)
  if (keys.length !== 1) return null
  if (typeof payload.text === 'string') return { text: payload.text }
  if (payload.bytes instanceof ArrayBuffer) return { bytes: payload.bytes }
  if (ArrayBuffer.isView(payload.bytes)) {
    return {
      bytes: toArrayBuffer(
        new Uint8Array(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength),
      ),
    }
  }
  return null
}

function shellCodeFor(error: unknown): ShellErrorCode {
  const mapped = asWorkspaceError(error)
  switch (mapped.code) {
    case 'not-found':
      return 'not-found'
    case 'permission-denied':
      return 'permission-denied'
    case 'not-a-file':
    case 'not-a-directory':
      return 'not-a-file'
    case 'too-large':
      return 'too-large'
    case 'conflict':
      return 'conflict'
    default:
      return 'internal'
  }
}

/**
 * One open document's handler frame. Every state change is local to the
 * instance, so a closed frame cannot mutate a later one for the same path.
 */
export class HandlerSession {
  private readonly options: HandlerSessionOptions
  private readonly sessionId: string
  private readonly boundary: ReturnType<typeof frameBoundary>
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private readonly readings = new Map<WorkspacePath, CachedFile>()
  private readonly violations: ViolationBudget
  private readonly subscription: EventSubscriber
  private frame: FrameHandle | null = null
  private phase: Phase = 'mounting'
  private file: HandlerFileMetadata
  private lastVersion: string
  private dirtySeq = 0
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  private disposeResolve: (() => void) | null = null
  private disposePromise: Promise<void> | null = null
  private liveSave: LiveSave | null = null
  private queuedSave: ((request: HandlerSaveRequest) => void) | null = null
  private failureSent = false
  private pickerId: string | null = null
  private pickerAbort: AbortController | null = null
  private readonly readIds = new Set<string>()
  private readonly listing: ListingBroker

  constructor(options: HandlerSessionOptions) {
    this.options = options
    this.file = { ...options.file }
    this.lastVersion = options.file.version
    this.sessionId = (options.createSessionId ?? defaultSessionId)()
    this.boundary = frameBoundary(options.candidate.origin, options.shellOrigin)
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
    this.violations = new ViolationBudget(() => this.fail('protocol-violation', 'editor'))
    this.listing = new ListingBroker({
      list: (path, options) =>
        this.options.session.forPlugin(this.options.candidate.pluginId).list(path, options),
      caseSensitive: options.session.capabilities().caseSensitive,
      setTimeoutImpl: this.setTimeoutImpl,
      clearTimeoutImpl: this.clearTimeoutImpl,
    })
    this.subscription = options.events.createSubscriber({
      label: options.candidate.pluginId,
      identity: options.candidate.identity,
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
        this.log('handler-events', code, topic)
      },
    })
  }

  get path(): WorkspacePath {
    return this.file.path
  }

  get identity(): string {
    return this.options.candidate.identity
  }

  get active(): boolean {
    return this.phase === 'active'
  }

  /** Present only for a manifest contribution with `rendering: "frame"`. */
  get surface(): FrameSurface | undefined {
    return this.frame?.surface
  }

  hasFocus(): boolean {
    return this.frame?.hasFocus?.() ?? false
  }

  /** Close a pending picker silently; the dialog is owned by the runtime. */
  cancelFilePicker(): void {
    const abort = this.pickerAbort
    this.pickerAbort = null
    this.pickerId = null
    abort?.abort()
  }

  dirtySequence(): number {
    return this.dirtySeq
  }

  start(): void {
    if (this.phase !== 'mounting') return
    let frame: FrameHandle
    try {
      frame = this.options.transport.open({
        url: buildFrameUrl(
          this.options.candidate.entryUrl,
          this.options.shellOrigin,
          'editor',
          this.sessionId,
        ),
        sandbox: this.boundary.sandbox,
        ...(this.options.candidate.rendering === 'frame'
          ? { visible: true, title: `${this.options.candidate.label} editor` }
          : {}),
        onMessage: (message) => this.handleMessage(message),
        onLoadError: () => this.fail('loading-failed', this.phaseName()),
      })
    } catch {
      this.fail('internal', 'ready', 'The plugin editor frame could not be created.')
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

  async dispose(reason: HandlerDisposeReason): Promise<void> {
    if (this.phase === 'closed') return
    if (this.phase === 'disposing') return this.disposePromise ?? Promise.resolve()
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.failLiveSave('internal')
    this.listing.reset()
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

  /** Immediate close for failures; does not wait for an acknowledgement. */
  close(): void {
    if (this.phase === 'closed') return
    this.phase = 'closed'
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.failLiveSave('internal')
    this.listing.reset()
    this.readings.clear()
    this.readIds.clear()
    this.frame?.close()
    this.frame = null
    this.disposeResolve?.()
    this.disposeResolve = null
  }

  requestSave(): Promise<HandlerSaveRequest> {
    if (this.phase !== 'active') return Promise.resolve({ ok: false, code: 'internal' })
    if (!this.options.canWrite || !hasWorkspaceWrite(this.options.candidate.permissions)) {
      return Promise.resolve({ ok: false, code: 'permission-denied' })
    }
    if (this.liveSave) {
      if (this.liveSave.stage === 'write' || this.queuedSave) {
        return Promise.resolve({ ok: false, code: 'rate-limited' })
      }
      return new Promise((resolve) => {
        this.queuedSave = resolve
      })
    }
    return new Promise((resolve) => {
      this.beginSave(resolve)
    })
  }

  completeSave(result: HandlerSaveCompletion): void {
    const save = this.liveSave
    if (!save || save.stage !== 'write') return
    postEnvelope(
      this.frame,
      this.boundary.targetOrigin,
      'shell/save-result',
      result.ok
        ? { ok: true, version: result.version }
        : { ok: false, code: result.code, ...(result.message ? { message: result.message } : {}) },
      save.id,
    )
    if (result.ok) this.lastVersion = result.version
    this.liveSave = null
    const queued = this.queuedSave
    this.queuedSave = null
    if (queued) this.beginSave(queued)
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
    postEnvelope(this.frame, this.boundary.targetOrigin, 'shell/file-changed', payload)
  }

  rename(nextPath: WorkspacePath): void {
    this.file = {
      ...this.file,
      path: nextPath,
      name: basename(nextPath),
      dir: dirname(nextPath),
      languageHint: languageHint(nextPath),
    }
    this.readings.clear()
  }

  private phaseName(): 'ready' | 'editor' {
    return this.phase === 'mounting' || this.phase === 'awaiting-ready' ? 'ready' : 'editor'
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
    if (this.liveSave?.timer) {
      this.clearTimeoutImpl(this.liveSave.timer)
      this.liveSave.timer = null
    }
  }

  private fail(code: ShellErrorCode, phase: 'ready' | 'editor', message?: string): void {
    if (this.phase === 'closed' || this.failureSent) return
    this.failureSent = true
    this.phase = 'closed'
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.failLiveSave('internal')
    this.listing.reset()
    this.frame?.close()
    this.frame = null
    this.options.onFailure({ code, phase, message })
  }

  private failLiveSave(code: ShellErrorCode): void {
    const save = this.liveSave
    this.liveSave = null
    const queued = this.queuedSave
    this.queuedSave = null
    if (save) {
      if (save.timer !== null) this.clearTimeoutImpl(save.timer)
      save.resolve({ ok: false, code })
    }
    queued?.({ ok: false, code })
  }

  private finishDispose(): void {
    if (this.phase === 'closed') return
    this.phase = 'closed'
    this.subscription.close()
    this.clearTimers()
    this.cancelFilePicker()
    this.failLiveSave('internal')
    this.listing.reset()
    this.readings.clear()
    this.readIds.clear()
    this.frame?.close()
    this.frame = null
    this.disposeResolve?.()
    this.disposeResolve = null
  }

  private sendError(code: ShellErrorCode, replyTo?: string): void {
    sendShellError(this.frame, this.boundary.targetOrigin, code, replyTo)
  }

  private log(phase: string, code?: string, message?: string): void {
    this.options.onLog?.({ phase, code, message })
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

    if (this.boundary.opaque) {
      if (message.origin !== 'null') {
        this.violation(envelope, false)
        return
      }
    } else if (message.origin !== this.options.candidate.origin) {
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
      case 'plugin/request-list':
        void this.handleRequestList(envelope)
        return
      case 'plugin/dirty':
        this.handleDirty(envelope)
        return
      case 'plugin/request-save':
        this.handleSaveRequested(envelope)
        return
      case 'plugin/save-content':
        this.handleSaveContent(envelope)
        return
      case 'plugin/dispose-ack':
        return
      case 'plugin/subscribe':
        this.handleSubscribe(envelope)
        return
      case 'plugin/unsubscribe':
        this.handleUnsubscribe(envelope)
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
    const candidate = this.options.candidate
    postEnvelope(this.frame, this.boundary.targetOrigin, 'shell/init', {
      protocolVersion: PROTOCOL_VERSION,
      mode: 'editor',
      sessionId: this.sessionId,
      plugin: { id: candidate.pluginId, version: candidate.pluginVersion },
      shell: { version: this.options.shellVersion, origin: this.options.shellOrigin },
      workspace: { name: this.options.workspaceName },
      theme: this.options.theme,
      permissions: candidate.permissions,
      locale: this.options.locale,
      settings: this.options.settings ?? {},
      file: { ...this.file },
      capabilities: {
        read: hasWorkspaceRead(candidate.permissions),
        write: this.options.canWrite && hasWorkspaceWrite(candidate.permissions),
        requestFiles: hasWorkspaceRead(candidate.permissions),
        filePicker: this.options.onRequestFiles !== undefined,
        directoryListing: true,
      },
      limits: {
        maxFileSize: this.options.maxFileSize,
        maxRequestBytes: this.options.maxRequestBytes,
      },
    })
    this.options.onActive?.()
    this.log('handler', 'open')
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
    if (!hasEventsSubscribe(this.options.candidate.permissions)) {
      this.sendError('permission-denied', envelope.id)
      this.log('handler-events', 'permission-denied', payload.topic)
      return
    }
    const result = this.subscription.subscribe(payload.topic)
    if (result.ok) {
      postEnvelope(
        this.frame,
        this.boundary.targetOrigin,
        'shell/subscribed',
        { topic: payload.topic, seq: result.seq },
        envelope.id,
      )
      this.log('handler-events', 'subscribed', payload.topic)
      return
    }
    if (result.code === 'unsupported-topic') {
      postEnvelope(
        this.frame,
        this.boundary.targetOrigin,
        'shell/subscribed',
        { topic: payload.topic, code: 'unsupported-topic' },
        envelope.id,
      )
      return
    }
    this.sendError('rate-limited', envelope.id)
    this.log('handler-events', result.code, payload.topic)
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

  private handleDirty(envelope: Envelope): void {
    const payload = envelope.payload
    if (!isPlainObject(payload) || typeof payload.dirty !== 'boolean') {
      this.violation(envelope)
      return
    }
    this.dirtySeq += 1
    this.options.onDirty(payload.dirty)
  }

  private handleSaveRequested(envelope: Envelope): void {
    if (envelope.id !== undefined) {
      this.violation(envelope)
      return
    }
    const payload = envelope.payload
    if (payload !== undefined && (!isPlainObject(payload) || Object.keys(payload).length !== 0)) {
      this.violation(envelope)
      return
    }
    this.options.onSaveRequested?.()
  }

  private handleSaveContent(envelope: Envelope): void {
    const save = this.liveSave
    if (!save || save.stage !== 'content' || !envelope.replyTo || envelope.replyTo !== save.id) {
      this.violation(envelope)
      return
    }
    const content = saveContentOf(envelope.payload)
    if (!content) {
      this.violation(envelope)
      this.sendError('internal', envelope.id)
      return
    }
    if (save.timer !== null) {
      this.clearTimeoutImpl(save.timer)
      save.timer = null
    }
    save.stage = 'write'
    save.resolve({
      ok: true,
      requestId: save.id,
      content,
      baseVersion: save.baseVersion,
    })
  }

  private beginSave(resolve: (request: HandlerSaveRequest) => void): void {
    const id = `save-${++this.saveSequence}`
    const save: LiveSave = {
      id,
      baseVersion: this.lastVersion,
      stage: 'content',
      resolve,
      timer: null,
    }
    this.liveSave = save
    save.timer = this.setTimeoutImpl(() => {
      if (this.liveSave !== save || save.stage !== 'content') return
      postEnvelope(
        this.frame,
        this.boundary.targetOrigin,
        'shell/save-result',
        { ok: false, code: 'timeout' },
        id,
      )
      this.liveSave = null
      save.resolve({ ok: false, code: 'timeout' })
      this.log('handler-save', 'timeout')
      const queued = this.queuedSave
      this.queuedSave = null
      if (queued) this.beginSave(queued)
    }, SAVE_TIMEOUT_MS)
    postRequest(this.frame, this.boundary.targetOrigin, 'shell/request-save', id, {})
  }

  private saveSequence = 0

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
    if (!hasWorkspaceRead(this.options.candidate.permissions)) {
      this.sendError('permission-denied', id)
      this.log('handler-picker', 'permission-denied')
      return
    }
    if (this.pickerId !== null) {
      this.sendError('rate-limited', id)
      this.log('handler-picker', 'rate-limited')
      return
    }
    const onRequestFiles = this.options.onRequestFiles
    if (!onRequestFiles) {
      this.sendError('internal', id)
      this.log('handler-picker', 'internal')
      return
    }

    const abort = new AbortController()
    this.pickerId = id
    this.pickerAbort = abort
    let outcome: FilePickerOutcome
    try {
      outcome = await onRequestFiles({
        path: this.file.path,
        pluginId: this.options.candidate.pluginId,
        pluginName: this.options.candidate.pluginName,
        multiple: payload.multiple === true,
        ...(payload.directory === undefined ? {} : { directory: payload.directory }),
        session: this.options.session,
        signal: abort.signal,
      })
    } catch {
      if (this.phase === 'active' && this.pickerId === id) {
        this.sendError('internal', id)
        this.log('handler-picker', 'internal')
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
      this.log('handler-picker', outcome.code)
      return
    }

    const paths = outcome.paths
    if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string')) {
      this.sendError('internal', id)
      this.log('handler-picker', 'internal')
      return
    }
    if (paths.length > MAX_FILE_PICKER_PATHS || (payload.multiple !== true && paths.length > 1)) {
      this.sendError('internal', id)
      this.log('handler-picker', 'internal')
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
        this.log('handler-picker', 'permission-denied')
        return
      }
      if (isReservedPath(path, caseSensitive)) {
        this.sendError('permission-denied', id)
        this.log('handler-picker', 'permission-denied')
        return
      }
      selected.push(path)
    }
    postEnvelope(
      this.frame,
      this.boundary.targetOrigin,
      'shell/files-selected',
      { paths: selected },
      id,
    )
    this.log('handler-picker', 'ok')
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
    if (!hasWorkspaceList(this.options.candidate.permissions)) {
      this.sendError('permission-denied', id)
      this.log('handler-list', 'permission-denied')
      return
    }

    let path: WorkspacePath
    try {
      path = resolveHandlerReadPath(this.file.path, payload.path)
    } catch {
      this.sendError('permission-denied', id)
      this.log('handler-list', 'permission-denied')
      return
    }
    if (isReservedPath(path, this.options.session.capabilities().caseSensitive)) {
      this.sendError('permission-denied', id)
      this.log('handler-list', 'permission-denied')
      return
    }

    const result = await this.listing.list(path, payload.cursor as string | undefined)
    if (this.phase !== 'active') return
    if (!result.ok) {
      this.sendError(result.code, id)
      this.log('handler-list', result.code)
      return
    }
    postEnvelope(this.frame, this.boundary.targetOrigin, 'shell/list-result', result.page, id)
    this.log('handler-list', 'ok', path)
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
    if (!hasWorkspaceRead(this.options.candidate.permissions)) {
      this.sendError('permission-denied', id)
      this.log('handler-read', 'permission-denied')
      return
    }

    let path: WorkspacePath
    try {
      path = resolveHandlerReadPath(this.file.path, payload.path)
    } catch {
      this.sendError('permission-denied', id)
      this.log('handler-read', 'permission-denied')
      return
    }
    if (isReservedPath(path, this.options.session.capabilities().caseSensitive)) {
      this.sendError('permission-denied', id)
      this.log('handler-read', 'permission-denied')
      return
    }
    if (this.readIds.has(id) || this.readIds.size >= MAX_IN_FLIGHT_REQUESTS) {
      this.sendError('rate-limited', id)
      return
    }
    this.readIds.add(id)

    try {
      const facade = this.options.session.forPlugin(this.options.candidate.pluginId)
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
      postEnvelope(this.frame, this.boundary.targetOrigin, 'shell/file-content', body, id)
      if (path === this.file.path && cached.version !== this.lastVersion) {
        this.lastVersion = cached.version
        this.options.onVersion?.(cached.version)
      }
    } catch (error) {
      if (this.phase !== 'active') return
      const code = shellCodeFor(error)
      this.sendError(code, id)
      this.log('handler-read', code)
    } finally {
      this.readIds.delete(id)
    }
  }
}
