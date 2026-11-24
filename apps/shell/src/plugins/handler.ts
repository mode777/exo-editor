import type { WorkspacePath, WorkspaceSession } from '../workspace/contract'
import { basename, dirname } from '../workspace/paths'
import type { FrameTransport } from './frame'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import type { NewFileOutcome, NewFileRequest } from './new-file'
import type { EventBus } from './events'
import type { EditorCandidate } from './registry'
import type { SettingValues } from './settings'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  FrameSession,
  resolveSessionPath,
  type FrameSessionOptions,
  type IntentOutcome,
  type OpenFileIntent,
  type OpenViewIntent,
  type PanelIntent,
  type PanelIntentOutcome,
  type SessionFailure,
} from './frame-session'
import {
  SAVE_TIMEOUT_MS,
  isPlainObject,
  postEnvelope,
  postRequest,
  type Envelope,
  type ShellErrorCode,
} from './protocol'

export { DEFAULT_MAX_REQUEST_BYTES, resolveSessionPath }

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
  /** Open the shell-owned Save As dialog; absent means the support bit is false. */
  onRequestNewFile?: (request: NewFileRequest) => Promise<NewFileOutcome>
  onDirty: (dirty: boolean) => void
  onFailure: (failure: HandlerFailure) => void
  onVersion?: (version: string) => void
  onLog?: (event: HandlerLogEvent) => void
  onOpenFile?: (request: OpenFileIntent) => Promise<IntentOutcome>
  onOpenView?: (request: OpenViewIntent) => Promise<IntentOutcome>
  onRequestPanel?: (request: PanelIntent) => Promise<PanelIntentOutcome>
  /** Whether the document tab is displayed and may issue shell intents. */
  isVisible?: () => boolean
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

function saveContentOf(payload: unknown): HandlerSaveContent | null {
  if (!isPlainObject(payload)) return null
  const keys = Object.keys(payload)
  if (keys.length !== 1) return null
  if (typeof payload.text === 'string') return { text: payload.text }
  if (payload.bytes instanceof ArrayBuffer) return { bytes: payload.bytes }
  if (ArrayBuffer.isView(payload.bytes)) {
    const view = new Uint8Array(
      payload.bytes.buffer,
      payload.bytes.byteOffset,
      payload.bytes.byteLength,
    )
    const copy = new Uint8Array(view.byteLength)
    copy.set(view)
    return { bytes: copy.buffer }
  }
  return null
}

/**
 * Resolve a plugin-supplied read path against the handler file's directory.
 * Kept as a named export for callers and tests; the shared implementation is
 * used by both editor and view sessions.
 */
export function resolveHandlerReadPath(basePath: WorkspacePath, requested: unknown): WorkspacePath {
  return resolveSessionPath(basePath, requested)
}

/**
 * One open document's handler frame. The shared handshake, read, picker, event
 * and disposal path lives in `FrameSession`; this class adds the bound file,
 * dirty state and the save round trip.
 */
export class HandlerSession extends FrameSession {
  readonly mode = 'editor' as const

  private readonly candidate: EditorCandidate
  private readonly handlerOptions: HandlerSessionOptions
  private file: HandlerFileMetadata
  private lastVersion: string
  private dirtySeq = 0
  private liveSave: LiveSave | null = null
  private queuedSave: ((request: HandlerSaveRequest) => void) | null = null
  private saveSequence = 0

  constructor(options: HandlerSessionOptions) {
    const failure = (event: SessionFailure) => {
      options.onFailure({
        code: event.code,
        phase: event.phase === 'ready' ? 'ready' : 'editor',
        message: event.message,
      })
    }
    const shared: FrameSessionOptions = {
      plugin: {
        identity: options.candidate.identity,
        pluginId: options.candidate.pluginId,
        pluginName: options.candidate.pluginName,
        pluginVersion: options.candidate.pluginVersion,
        origin: options.candidate.origin,
        permissions: options.candidate.permissions,
      },
      session: options.session,
      transport: options.transport,
      shellVersion: options.shellVersion,
      shellOrigin: options.shellOrigin,
      workspaceName: options.workspaceName,
      theme: options.theme,
      locale: options.locale,
      events: options.events,
      settings: options.settings,
      maxFileSize: options.maxFileSize,
      maxRequestBytes: options.maxRequestBytes,
      readBasePath: options.file.path,
      createSessionId: options.createSessionId,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
      onActive: options.onActive,
      onRequestFiles: options.onRequestFiles,
      onRequestNewFile: options.onRequestNewFile,
      onFailure: failure,
      onLog: options.onLog,
      onOpenFile: options.onOpenFile,
      onOpenView: options.onOpenView,
      onRequestPanel: options.onRequestPanel,
      isVisible: options.isVisible,
      writeCapability:
        options.canWrite && options.candidate.permissions.includes('workspace:write'),
    }
    super(shared)
    this.candidate = options.candidate
    this.handlerOptions = options
    this.file = { ...options.file }
    this.lastVersion = options.file.version
  }

  get path(): WorkspacePath {
    return this.file.path
  }

  /** The opaque session id shared by init, active-editor context and local `from`. */
  get instanceId(): string {
    return this.sessionId
  }

  start(): void {
    this.mountFrame({
      entryUrl: this.candidate.entryUrl,
      visible: this.candidate.rendering === 'frame',
      title: `${this.candidate.label} editor`,
    })
  }

  dirtySequence(): number {
    return this.dirtySeq
  }

  requestSave(): Promise<HandlerSaveRequest> {
    if (!this.active) return Promise.resolve({ ok: false, code: 'internal' })
    if (!this.handlerOptions.canWrite || !this.candidate.permissions.includes('workspace:write')) {
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

  rename(nextPath: WorkspacePath): void {
    this.file = {
      ...this.file,
      path: nextPath,
      name: basename(nextPath),
      dir: dirname(nextPath),
      languageHint: languageHint(nextPath),
    }
    this.invalidateReads()
  }

  protected buildModeInit(): Record<string, unknown> {
    return { file: { ...this.file }, editor: { instanceId: this.sessionId } }
  }

  protected handleModeMessage(envelope: Envelope): boolean {
    switch (envelope.type) {
      case 'plugin/dirty':
        this.handleDirty(envelope)
        return true
      case 'plugin/request-save':
        this.handleSaveRequested(envelope)
        return true
      case 'plugin/save-content':
        this.handleSaveContent(envelope)
        return true
      default:
        return false
    }
  }

  protected onClosing(): void {
    this.failLiveSave('internal')
  }

  protected onReadVersion(path: WorkspacePath, version: string): void {
    if (path === this.file.path && version !== this.lastVersion) {
      this.lastVersion = version
      this.handlerOptions.onVersion?.(version)
    }
  }

  private handleDirty(envelope: Envelope): void {
    const payload = envelope.payload
    if (!isPlainObject(payload) || typeof payload.dirty !== 'boolean') {
      this.violation(envelope)
      return
    }
    this.dirtySeq += 1
    this.handlerOptions.onDirty(payload.dirty)
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
    this.handlerOptions.onSaveRequested?.()
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
}
