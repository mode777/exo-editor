import {
  WorkspaceError,
  asWorkspaceError,
  type Disposable,
  type FileStat,
  type ListOptions,
  type OpenDocumentSnapshot,
  type ReadOptions,
  type WorkspaceAccess,
  type WorkspaceCapabilities,
  type WorkspaceChange,
  type WorkspaceDescriptor,
  type WorkspaceErrorCode,
  type WorkspaceHandle,
  type WorkspaceLogEntry,
  type WorkspaceOperation,
  type WorkspacePath,
  type WorkspaceSession,
  type WriteOptions,
} from './contract'
import { filterReserved, isReservedPath, normalizePath, pathIsUnder } from './paths'

type Actor = { kind: 'shell' } | { kind: 'plugin'; pluginId: string }

const SHELL: Actor = { kind: 'shell' }

export interface SessionOptions {
  eventTarget?: EventTarget
  now?: () => number
  /** Injectable for tests; defaults to the document visibility check. */
  isVisible?: () => boolean
}

function aborted(path?: WorkspacePath): WorkspaceError {
  return new WorkspaceError('aborted', 'The workspace operation was cancelled.', {
    path,
  })
}

function throwIfAborted(signal?: AbortSignal, path?: WorkspacePath): void {
  if (signal?.aborted) throw aborted(path)
}

/**
 * The single shell-facing access path. Providers implement storage; this class
 * owns normalization, containment, the reserved-path guard, versions, the
 * refresh fallback and the generation that makes teardown safe.
 */
export class Session implements WorkspaceSession {
  private readonly handle: WorkspaceHandle
  private readonly eventTarget: EventTarget
  private readonly now: () => number
  private readonly isVisible: () => boolean
  private readonly inflight = new Set<AbortController>()
  private readonly logEntries: WorkspaceLogEntry[] = []
  private readonly documents = new Map<WorkspacePath, string>()
  private readonly listeners = new Set<(change: WorkspaceChange) => void>()
  private readonly facades = new Map<string, WorkspaceAccess>()
  private descriptorSnapshot: WorkspaceDescriptor
  private capabilitiesSnapshot: WorkspaceCapabilities
  private generation = 0
  private documentsRevision = 0
  private disposed = false
  private refreshInFlight: Promise<WorkspaceChange[]> | null = null
  private watchRegistration: Disposable | null = null
  private listenersInstalled = false

  constructor(handle: WorkspaceHandle, options: SessionOptions = {}) {
    this.handle = handle
    this.descriptorSnapshot = handle.descriptor
    this.capabilitiesSnapshot = handle.descriptor.capabilities
    this.eventTarget =
      options.eventTarget ?? (typeof window === 'undefined' ? new EventTarget() : window)
    this.now = options.now ?? (() => Date.now())
    this.isVisible =
      options.isVisible ??
      (() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  }

  get descriptor(): WorkspaceDescriptor {
    return this.descriptorSnapshot
  }

  capabilities(): WorkspaceCapabilities {
    return { ...this.capabilitiesSnapshot }
  }

  getLog(): WorkspaceLogEntry[] {
    return this.logEntries.map((entry) => ({ ...entry }))
  }

  forPlugin(pluginId: string): WorkspaceAccess {
    if (typeof pluginId !== 'string' || pluginId.length === 0) {
      throw new WorkspaceError('permission-denied', 'A plugin id is required.')
    }
    const existing = this.facades.get(pluginId)
    if (existing) return existing
    const actor: Actor = { kind: 'plugin', pluginId }
    const facade: WorkspaceAccess = {
      list: (path, options) => this.listAs(actor, path, options),
      stat: (path, options) => this.statAs(actor, path, options),
      read: (path, options) => this.readAs(actor, path, options),
      write: (path, data, options) => this.writeAs(actor, path, data, options),
      mkdir: (path, options) => this.mkdirAs(actor, path, options),
      remove: (path, options) => this.removeAs(actor, path, options),
      move: (from, to, options) => this.moveAs(actor, from, to, options),
    }
    this.facades.set(pluginId, facade)
    return facade
  }

  list(path: WorkspacePath, options?: ListOptions): Promise<FileStat[]> {
    return this.listAs(SHELL, path, options)
  }

  stat(path: WorkspacePath, options?: { signal?: AbortSignal }): Promise<FileStat> {
    return this.statAs(SHELL, path, options)
  }

  read(path: WorkspacePath, options?: ReadOptions): Promise<Uint8Array> {
    return this.readAs(SHELL, path, options)
  }

  write(path: WorkspacePath, data: Uint8Array, options?: WriteOptions): Promise<FileStat> {
    return this.writeAs(SHELL, path, data, options)
  }

  mkdir(
    path: WorkspacePath,
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    return this.mkdirAs(SHELL, path, options)
  }

  remove(
    path: WorkspacePath,
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    return this.removeAs(SHELL, path, options)
  }

  move(
    from: WorkspacePath,
    to: WorkspacePath,
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<FileStat> {
    return this.moveAs(SHELL, from, to, options)
  }

  async requestPermission(options: { signal?: AbortSignal } = {}): Promise<WorkspaceCapabilities> {
    this.assertAlive()
    throwIfAborted(options.signal)
    const handleRequest = this.handle.requestPermission
    if (!handleRequest) {
      throw new WorkspaceError('unsupported', 'The provider cannot request additional permission.')
    }
    const generation = this.generation
    try {
      const next = await handleRequest.call(this.handle, { signal: options.signal })
      if (generation !== this.generation) throw aborted()
      this.capabilitiesSnapshot = { ...next }
      this.descriptorSnapshot = {
        ...this.descriptorSnapshot,
        capabilities: this.capabilitiesSnapshot,
      }
      this.log('permission', SHELL, undefined)
      return this.capabilitiesSnapshot
    } catch (error) {
      if (generation !== this.generation) throw aborted()
      throw this.mapError(error, 'permission', SHELL)
    }
  }

  setOpenDocuments(documents: OpenDocumentSnapshot[]): void {
    this.assertAlive()
    const next = new Map<WorkspacePath, string>()
    for (const document of documents) {
      const path = normalizePath(document.path)
      next.set(path, document.version)
    }
    this.documents.clear()
    for (const [path, version] of next) this.documents.set(path, version)
    this.documentsRevision += 1
    this.syncSubscriptions()
  }

  refreshOpenDocuments(): Promise<WorkspaceChange[]> {
    if (this.disposed) return Promise.resolve([])
    if (this.refreshInFlight) return this.refreshInFlight
    if (this.documents.size === 0) return Promise.resolve([])

    const revision = this.documentsRevision
    const generation = this.generation
    const paths = [...this.documents.keys()]
    this.refreshInFlight = this.run('stat', SHELL, undefined, undefined, async (signal) => {
      const changes: WorkspaceChange[] = []
      for (const path of paths) {
        throwIfAborted(signal, path)
        try {
          const stat = await this.handle.stat(path, { signal })
          const previous = this.documents.get(path)
          if (stat.kind !== 'file') {
            changes.push({ kind: 'changed', path, stat })
            this.documents.set(path, stat.version)
            continue
          }
          if (previous !== stat.version) {
            changes.push({ kind: 'changed', path, stat })
            this.documents.set(path, stat.version)
          }
        } catch (error) {
          const mapped = asWorkspaceError(error, path)
          if (mapped.code === 'not-found') {
            changes.push({ kind: 'deleted', path })
            this.documents.delete(path)
          } else if (mapped.code !== 'aborted') {
            throw mapped
          }
        }
      }
      if (generation !== this.generation || revision !== this.documentsRevision) {
        return []
      }
      for (const change of changes) this.emit(change)
      return changes
    }).finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  onExternalChange(listener: (change: WorkspaceChange) => void): Disposable {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    for (const controller of this.inflight) controller.abort()
    this.inflight.clear()
    this.removeRefreshListeners()
    this.watchRegistration?.dispose()
    this.watchRegistration = null
    this.documents.clear()
    this.listeners.clear()
    this.facades.clear()
    this.refreshInFlight = null
    this.logEntries.length = 0
  }

  private async listAs(
    actor: Actor,
    rawPath: WorkspacePath,
    options: ListOptions = {},
  ): Promise<FileStat[]> {
    const path = this.preparePath(actor, 'list', rawPath)
    return this.run('list', actor, path, options.signal, async (signal) => {
      const entries = await this.handle.list(path, { ...options, signal })
      return actor.kind === 'plugin'
        ? filterReserved(entries, this.capabilitiesSnapshot.caseSensitive)
        : entries
    })
  }

  private async statAs(
    actor: Actor,
    rawPath: WorkspacePath,
    options: { signal?: AbortSignal } = {},
  ): Promise<FileStat> {
    const path = this.preparePath(actor, 'stat', rawPath)
    return this.run('stat', actor, path, options.signal, (signal) =>
      this.handle.stat(path, { signal }),
    )
  }

  private async readAs(
    actor: Actor,
    rawPath: WorkspacePath,
    options: ReadOptions = {},
  ): Promise<Uint8Array> {
    const path = this.preparePath(actor, 'read', rawPath)
    return this.run('read', actor, path, options.signal, (signal) =>
      this.handle.read(path, { ...options, signal }),
    )
  }

  private async writeAs(
    actor: Actor,
    rawPath: WorkspacePath,
    data: Uint8Array,
    options: WriteOptions = {},
  ): Promise<FileStat> {
    const path = this.preparePath(actor, 'write', rawPath)
    return this.run('write', actor, path, options.signal, async (signal) => {
      if (options.ifVersion !== undefined) {
        const current = await this.handle.stat(path, { signal })
        if (current.version !== options.ifVersion) {
          throw new WorkspaceError('conflict', 'The file changed on disk.', {
            path,
          })
        }
      }
      const stat = await this.handle.write(path, data, { ...options, signal })
      if (this.documents.has(path)) this.documents.set(path, stat.version)
      return stat
    })
  }

  private async mkdirAs(
    actor: Actor,
    rawPath: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const path = this.preparePath(actor, 'mkdir', rawPath)
    return this.run('mkdir', actor, path, options.signal, (signal) =>
      this.handle.mkdir(path, { ...options, signal }),
    )
  }

  private async removeAs(
    actor: Actor,
    rawPath: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    const path = this.preparePath(actor, 'remove', rawPath)
    if (path === '/') {
      throw this.deny(actor, 'remove', path, 'The workspace root cannot be removed.')
    }
    return this.run('remove', actor, path, options.signal, async (signal) => {
      await this.handle.remove(path, { ...options, signal })
      for (const tracked of [...this.documents.keys()]) {
        if (pathIsUnder(tracked, path)) this.documents.delete(tracked)
      }
      this.documentsRevision += 1
      this.syncSubscriptions()
    })
  }

  private async moveAs(
    actor: Actor,
    rawFrom: WorkspacePath,
    rawTo: WorkspacePath,
    options: { overwrite?: boolean; signal?: AbortSignal } = {},
  ): Promise<FileStat> {
    const from = this.preparePath(actor, 'move', rawFrom)
    const to = this.preparePath(actor, 'move', rawTo)
    if (from === '/' || to === '/') {
      throw this.deny(actor, 'move', from, 'The workspace root cannot be moved.')
    }
    return this.run('move', actor, from, options.signal, async (signal) => {
      const stat = await this.handle.move(from, to, { ...options, signal })
      const moved = [...this.documents.entries()]
        .filter(([tracked]) => pathIsUnder(tracked, from))
        .map(
          ([tracked, version]) =>
            [
              `${to}${tracked.slice(from.length)}`,
              tracked === from ? stat.version : version,
            ] as const,
        )
      for (const [tracked] of [...this.documents.entries()]) {
        if (pathIsUnder(tracked, from)) this.documents.delete(tracked)
      }
      for (const [tracked, version] of moved) this.documents.set(tracked, version)
      this.documentsRevision += 1
      this.syncSubscriptions()
      return stat
    })
  }

  private preparePath(
    actor: Actor,
    operation: WorkspaceOperation,
    raw: WorkspacePath,
  ): WorkspacePath {
    let path: WorkspacePath
    try {
      path = normalizePath(raw)
    } catch (error) {
      const mapped = asWorkspaceError(error, typeof raw === 'string' ? raw : undefined)
      this.log(operation, actor, mapped.path, mapped.code)
      throw mapped
    }
    if (actor.kind === 'plugin' && isReservedPath(path, this.capabilitiesSnapshot.caseSensitive)) {
      throw this.deny(actor, operation, path, 'The path is reserved for the shell.')
    }
    return path
  }

  private deny(
    actor: Actor,
    operation: WorkspaceOperation,
    path: WorkspacePath,
    message: string,
  ): WorkspaceError {
    const error = new WorkspaceError('permission-denied', message, { path })
    this.log(operation, actor, path, error.code)
    return error
  }

  private async run<T>(
    operation: WorkspaceOperation,
    actor: Actor,
    path: WorkspacePath | undefined,
    signal: AbortSignal | undefined,
    operationFunction: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.assertAlive(path)
    throwIfAborted(signal, path)
    const generation = this.generation
    const controller = new AbortController()
    const forwardAbort = () => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })
    this.inflight.add(controller)
    try {
      const result = await operationFunction(controller.signal)
      if (generation !== this.generation || controller.signal.aborted) {
        throw aborted(path)
      }
      return result
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) {
        throw aborted(path)
      }
      throw this.mapError(error, operation, actor, path)
    } finally {
      this.inflight.delete(controller)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private mapError(
    error: unknown,
    operation: WorkspaceOperation,
    actor: Actor,
    path?: WorkspacePath,
  ): WorkspaceError {
    const mapped = asWorkspaceError(error, path)
    this.log(operation, actor, mapped.path ?? path, mapped.code)
    return mapped
  }

  private assertAlive(path?: WorkspacePath): void {
    if (this.disposed) throw aborted(path)
  }

  private log(
    operation: WorkspaceOperation,
    actor: Actor,
    path?: WorkspacePath,
    code?: WorkspaceErrorCode,
  ): void {
    this.logEntries.push({
      at: this.now(),
      operation,
      pluginId: actor.kind === 'plugin' ? actor.pluginId : undefined,
      path,
      code,
    })
    if (this.logEntries.length > 200) this.logEntries.shift()
  }

  private syncSubscriptions(): void {
    this.watchRegistration?.dispose()
    this.watchRegistration = null
    if (this.documents.size === 0) {
      this.removeRefreshListeners()
      return
    }
    if (this.capabilitiesSnapshot.watchable && this.handle.watch) {
      this.removeRefreshListeners()
      this.watchRegistration = this.handle.watch([...this.documents.keys()], (change) =>
        this.applyWatchChange(change),
      )
      return
    }
    this.installRefreshListeners()
  }

  private applyWatchChange(change: WorkspaceChange): void {
    if (this.disposed) return
    if (change.kind === 'deleted') {
      this.documents.delete(change.path)
    } else {
      this.documents.set(change.path, change.stat.version)
    }
    this.emit(change)
  }

  private installRefreshListeners(): void {
    if (this.listenersInstalled) return
    this.listenersInstalled = true
    this.eventTarget.addEventListener('focus', this.handleFocus)
    this.eventTarget.addEventListener('visibilitychange', this.handleFocus)
  }

  private removeRefreshListeners(): void {
    if (!this.listenersInstalled) return
    this.listenersInstalled = false
    this.eventTarget.removeEventListener('focus', this.handleFocus)
    this.eventTarget.removeEventListener('visibilitychange', this.handleFocus)
  }

  private handleFocus = (): void => {
    if (!this.isVisible()) return
    void this.refreshOpenDocuments().catch(() => {
      // A refresh failure is surfaced by the next workspace operation; focus
      // must never throw into the browser's event dispatch.
    })
  }

  private emit(change: WorkspaceChange): void {
    if (this.disposed) return
    for (const listener of [...this.listeners]) {
      try {
        listener(change)
      } catch {
        // A listener must not break refresh or teardown.
      }
    }
  }
}
