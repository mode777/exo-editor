import type {
  FileStat,
  WorkspaceChange,
  WorkspacePath,
  WorkspaceSession,
} from '../workspace/contract'
import { basename, dirname } from '../workspace/paths'
import { SHELL_VERSION } from '../version'
import { DomFrameTransport, type FrameTransport } from './frame'
import type { FilePickerOpenRequest, FilePickerOutcome } from './file-picker'
import {
  DEFAULT_MAX_REQUEST_BYTES,
  HandlerSession,
  type HandlerDisposeReason,
  type HandlerFailure,
  type HandlerSaveCompletion,
  type HandlerSaveRequest,
} from './handler'
import { hasWorkspaceRead } from './manifest'
import { EventBus, type EventTopic, type ThemeName } from './events'
import type { PluginSettingsStore, SettingValues } from './settings'
import { MAX_HANDLER_FRAMES } from './protocol'
import type { EditorCandidate } from './registry'

export type { ThemeName }

export interface HandlerPoolHost {
  match(path: string): EditorCandidate[]
  logHandler(identity: string, phase: string, code?: string, message?: string): void
}

export interface HandlerDocumentCallbacks {
  onActive: () => void
  onDirty: (dirty: boolean) => void
  onFailure: (failure: HandlerFailure) => void
  onVersion: (version: string) => void
}

export interface HandlerPoolAttachOptions {
  session: WorkspaceSession
  host: HandlerPoolHost
  workspaceName: string
  settings?: PluginSettingsStore
}

export interface HandlerOpenInput {
  path: WorkspacePath
  file: FileStat
  candidate: EditorCandidate
}

export type HandlerOpenResult =
  { ok: true } | { ok: false; reason: 'cap' | 'failed'; message?: string }

export interface HandlerPoolOptions {
  transport?: FrameTransport
  shellVersion?: string
  shellOrigin?: string
  theme?: () => ThemeName
  locale?: string
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  maxRequestBytes?: number
  /** Injectable bus; tests and the runtime can share one. */
  events?: EventBus
  /** A handler closed for a reason other than tab close, e.g. plugin removal. */
  onHandlerClosed?: (path: WorkspacePath, reason: HandlerDisposeReason) => void
  /** An active handler asked the shell to save its document. */
  onSaveRequested?: (path: WorkspacePath) => void
  /** Open the one shell-owned picker; the pool supplies the active/focus gate. */
  onRequestFiles?: (request: FilePickerOpenRequest) => Promise<FilePickerOutcome>
  /** Whether another frame's picker is already open. */
  isPickerOpen?: () => boolean
}

interface HandlerRecord {
  session: HandlerSession
  identity: string
  candidate: EditorCandidate
}

function defaultTheme(): ThemeName {
  if (typeof document === 'undefined') return 'dark'
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'high-contrast' ? theme : 'dark'
}

function metadataFor(file: FileStat): {
  path: WorkspacePath
  name: string
  dir: string
  size: number
  mtime: number
  version: string
} {
  return {
    path: file.path,
    name: basename(file.path),
    dir: dirname(file.path),
    size: file.size,
    mtime: file.mtime,
    version: file.version,
  }
}

/**
 * All handler frames for one workspace. The pool is the only place that counts
 * frames per plugin and the only place that closes a document's frame, so the
 * cap and the teardown order cannot drift from the registry.
 */
export class HandlerPool {
  readonly events: EventBus
  private readonly transport: FrameTransport
  private readonly ownsTransport: boolean
  private readonly shellVersion: string
  private readonly shellOrigin: string
  private readonly theme: () => ThemeName
  private readonly locale: string
  private readonly createSessionId: (() => string) | undefined
  private readonly setTimeoutImpl: typeof setTimeout | undefined
  private readonly clearTimeoutImpl: typeof clearTimeout | undefined
  private readonly maxRequestBytes: number
  private readonly onHandlerClosed:
    ((path: WorkspacePath, reason: HandlerDisposeReason) => void) | undefined
  private readonly onSaveRequested: ((path: WorkspacePath) => void) | undefined
  private readonly onRequestFiles:
    ((request: FilePickerOpenRequest) => Promise<FilePickerOutcome>) | undefined
  private readonly isPickerOpen: (() => boolean) | undefined
  private readonly records = new Map<WorkspacePath, HandlerRecord>()
  private readonly surfaces = new Map<WorkspacePath, HTMLElement>()
  private readonly surfaceObservers = new Map<WorkspacePath, ResizeObserver>()
  private attachOptions: HandlerPoolAttachOptions | null = null

  constructor(options: HandlerPoolOptions = {}) {
    this.transport = options.transport ?? new DomFrameTransport()
    this.events =
      options.events ??
      new EventBus({
        onSubscriberRemoved: (label, topic, code) =>
          this.attachOptions?.host.logHandler(label, 'handler-events', code, topic),
      })
    this.ownsTransport = options.transport === undefined
    this.shellVersion = options.shellVersion ?? SHELL_VERSION
    this.shellOrigin =
      options.shellOrigin ??
      (typeof location === 'undefined' ? 'http://localhost' : location.origin)
    this.theme = options.theme ?? defaultTheme
    this.locale =
      options.locale ?? (typeof navigator === 'undefined' ? 'en' : navigator.language || 'en')
    this.createSessionId = options.createSessionId
    this.setTimeoutImpl = options.setTimeoutImpl
    this.clearTimeoutImpl = options.clearTimeoutImpl
    this.maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES
    this.onHandlerClosed = options.onHandlerClosed
    this.onSaveRequested = options.onSaveRequested
    this.onRequestFiles = options.onRequestFiles
    this.isPickerOpen = options.isPickerOpen
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.handleViewportResize)
    }
  }

  attach(options: HandlerPoolAttachOptions): void {
    this.events.reset()
    this.attachOptions = options
  }

  async detach(): Promise<void> {
    const sessions = [...this.records.values()]
    for (const path of [...this.surfaces.keys()]) this.dropSurface(path)
    this.records.clear()
    this.attachOptions = null
    await Promise.all(sessions.map((record) => record.session.dispose('workspace-switch')))
    this.events.reset()
  }

  candidates(path: WorkspacePath): EditorCandidate[] {
    if (!this.attachOptions) return []
    return this.attachOptions.host
      .match(path)
      .filter((candidate) => hasWorkspaceRead(candidate.permissions))
  }

  has(path: WorkspacePath): boolean {
    return this.records.has(path)
  }

  get(path: WorkspacePath): HandlerSession | undefined {
    return this.records.get(path)?.session
  }

  /**
   * Register the document area slot for a visible handler. The iframe stays in
   * the transport container; only its fixed position and visibility change.
   * Passing `null` hides the frame without disposing the session.
   */
  attachSurface(path: WorkspacePath, element: HTMLElement | null): void {
    this.surfaceObservers.get(path)?.disconnect()
    this.surfaceObservers.delete(path)
    if (!element) {
      this.surfaces.delete(path)
      const record = this.records.get(path)
      record?.session.cancelFilePicker()
      record?.session.surface?.hide()
      return
    }
    this.surfaces.set(path, element)
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.updateSurface(path))
      observer.observe(element)
      this.surfaceObservers.set(path, observer)
    }
    this.updateSurface(path)
  }

  count(identity: string): number {
    let total = 0
    for (const record of this.records.values()) {
      if (record.identity === identity) total += 1
    }
    return total
  }

  open(input: HandlerOpenInput, callbacks: HandlerDocumentCallbacks): HandlerOpenResult {
    const attached = this.attachOptions
    if (!attached) return { ok: false, reason: 'failed', message: 'No workspace is attached.' }
    if (this.records.has(input.path)) {
      return { ok: false, reason: 'failed', message: 'A handler is already open for this file.' }
    }
    if (this.count(input.candidate.identity) >= MAX_HANDLER_FRAMES) {
      return { ok: false, reason: 'cap' }
    }

    const capabilities = attached.session.capabilities()
    let record: HandlerRecord | null = null
    const session = new HandlerSession({
      candidate: input.candidate,
      file: metadataFor(input.file),
      session: attached.session,
      transport: this.transport,
      shellVersion: this.shellVersion,
      shellOrigin: this.shellOrigin,
      workspaceName: attached.workspaceName,
      theme: this.theme(),
      locale: this.locale,
      events: this.events,
      canWrite: capabilities.writable,
      maxFileSize: capabilities.maxFileSize ?? DEFAULT_MAX_REQUEST_BYTES,
      maxRequestBytes: this.maxRequestBytes,
      settings: attached.settings?.values(input.candidate.identity) ?? {},
      createSessionId: this.createSessionId,
      setTimeoutImpl: this.setTimeoutImpl,
      clearTimeoutImpl: this.clearTimeoutImpl,
      onActive: () => {
        callbacks.onActive()
        this.updateSurface(input.path)
      },
      onSaveRequested: () => this.onSaveRequested?.(input.path),
      onRequestFiles: (request) => {
        if (this.isPickerOpen?.()) {
          return Promise.resolve({ ok: false as const, code: 'rate-limited' as const })
        }
        if (input.candidate.rendering !== 'frame') {
          return Promise.resolve({ ok: false as const, code: 'permission-denied' as const })
        }
        if (!this.surfaces.has(input.path) || !session.active || !session.hasFocus()) {
          return Promise.resolve({ ok: false as const, code: 'permission-denied' as const })
        }
        return (
          this.onRequestFiles?.(request) ??
          Promise.resolve({ ok: false as const, code: 'internal' as const })
        )
      },
      onDirty: (dirty) => callbacks.onDirty(dirty),
      onVersion: (version) => callbacks.onVersion(version),
      onFailure: (failure) => {
        if (record && this.records.get(input.path) !== record) return
        this.dropSurface(input.path)
        if (record) this.records.delete(input.path)
        attached.host.logHandler(
          input.candidate.identity,
          'handler-failed',
          failure.code,
          failure.message ?? failure.phase,
        )
        callbacks.onFailure(failure)
      },
      onLog: (event) =>
        attached.host.logHandler(input.candidate.identity, event.phase, event.code, event.message),
    })
    record = {
      session,
      identity: input.candidate.identity,
      candidate: input.candidate,
    }
    this.records.set(input.path, record)
    attached.host.logHandler(
      input.candidate.identity,
      'handler-open',
      undefined,
      input.candidate.label,
    )
    session.start()
    return { ok: true }
  }

  dispose(path: WorkspacePath, reason: HandlerDisposeReason): void {
    const record = this.records.get(path)
    if (!record) return
    this.dropSurface(path)
    this.records.delete(path)
    this.attachOptions?.host.logHandler(record.identity, 'handler-dispose', reason, path)
    void record.session.dispose(reason)
  }

  close(path: WorkspacePath): void {
    this.dispose(path, 'closed')
  }

  closeFor(identity: string, reason: HandlerDisposeReason): void {
    for (const [path, record] of [...this.records]) {
      if (record.identity !== identity) continue
      this.dropSurface(path)
      this.records.delete(path)
      this.attachOptions?.host.logHandler(record.identity, 'handler-dispose', reason, path)
      void record.session.dispose(reason)
      this.onHandlerClosed?.(path, reason)
    }
  }

  async disposeAll(reason: HandlerDisposeReason): Promise<void> {
    const sessions = [...this.records.values()]
    for (const path of [...this.surfaces.keys()]) this.dropSurface(path)
    this.records.clear()
    await Promise.all(sessions.map((record) => record.session.dispose(reason)))
  }

  rename(previousPath: WorkspacePath, nextPath: WorkspacePath): void {
    const record = this.records.get(previousPath)
    if (!record) return
    this.records.delete(previousPath)
    this.records.set(nextPath, record)
    const surface = this.surfaces.get(previousPath)
    const observer = this.surfaceObservers.get(previousPath)
    this.surfaces.delete(previousPath)
    this.surfaceObservers.delete(previousPath)
    if (surface) this.attachSurface(nextPath, surface)
    else if (observer) observer.disconnect()
    record.session.rename(nextPath)
  }

  notifyChange(change: WorkspaceChange): void {
    const record =
      this.records.get(change.path) ??
      (change.kind === 'renamed' ? this.records.get(change.previousPath) : undefined)
    record?.session.notifyChange(change)
  }

  publish(topic: EventTopic, payload: unknown, options: { burst?: boolean } = {}): boolean {
    return this.events.publish(topic, payload, options)
  }

  publishWorkspaceClosed(reason: 'switch' | 'close'): void {
    this.events.publishImmediate('workspace/closed', { reason })
  }

  /**
   * Deliver a plugin's new settings only to its own subscribed handler frames.
   * No live frame means there is nothing to notify; the next init carries the
   * values.
   */
  updateSettings(identity: string, values: SettingValues): void {
    let pluginId: string | undefined
    for (const record of this.records.values()) {
      if (record.identity !== identity) continue
      pluginId = record.candidate.pluginId
      break
    }
    if (!pluginId) return
    this.events.publish('config/changed', { pluginId, values }, { target: identity })
  }

  save(path: WorkspacePath): Promise<HandlerSaveRequest> {
    const record = this.records.get(path)
    if (!record) return Promise.resolve({ ok: false, code: 'internal' })
    return record.session.requestSave()
  }

  completeSave(path: WorkspacePath, result: HandlerSaveCompletion): void {
    const record = this.records.get(path)
    if (!record) return
    if (result.ok) {
      this.attachOptions?.host.logHandler(record.identity, 'handler-save', 'ok', path)
    } else {
      this.attachOptions?.host.logHandler(record.identity, 'handler-save', result.code, path)
    }
    record.session.completeSave(result)
  }

  dirtySequence(path: WorkspacePath): number {
    return this.records.get(path)?.session.dirtySequence() ?? 0
  }

  disposeTransport(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.handleViewportResize)
    }
    for (const path of [...this.surfaces.keys()]) this.dropSurface(path)
    if (this.ownsTransport) this.transport.dispose?.()
  }

  private handleViewportResize = (): void => {
    for (const path of [...this.surfaces.keys()]) this.updateSurface(path)
  }

  private updateSurface(path: WorkspacePath): void {
    const record = this.records.get(path)
    const element = this.surfaces.get(path)
    if (!record?.session.active || !element) {
      record?.session.surface?.hide()
      return
    }
    const rect = element.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) {
      record.session.surface?.hide()
      return
    }
    record.session.surface?.show({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }

  private dropSurface(path: WorkspacePath): void {
    this.surfaceObservers.get(path)?.disconnect()
    this.surfaceObservers.delete(path)
    this.surfaces.delete(path)
    this.records.get(path)?.session.surface?.hide()
  }
}
