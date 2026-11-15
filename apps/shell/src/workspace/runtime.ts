import {
  WorkspaceError,
  asWorkspaceError,
  isAborted,
  workspaceErrorMessage,
  type FileStat,
  type WorkspaceCapabilities,
  type WorkspaceChange,
  type WorkspaceDescriptor,
  type WorkspaceErrorCode,
  type WorkspaceHandle,
  type WorkspacePath,
  type WorkspaceProvider,
  type WorkspaceSession,
} from './contract'
import { DocumentStore } from './documents'
import { Session } from './session'
import { isReservedPath, normalizePath } from './paths'
import { PluginConfigStore } from '../plugins/store'
import { PluginHost } from '../plugins/host'
import { HandlerPool } from '../plugins/handlers'
import { FileChangeCoalescer, SelfWriteEcho, type ThemeName } from '../plugins/events'
import { FolderWorkspaceProvider } from './providers/folder/provider'
import { IndexedDbHandleStore, type HandleStore } from './providers/folder/handle-store'
import { supportsFolderWorkspaces } from './providers/folder/fsa'
import { IndexedDbActiveWorkspaceStore, type ActiveWorkspaceStore } from './providers/active-store'
import {
  IndexedDbConnectionStore,
  type ConnectionStore,
} from './providers/stratofold/connection-store'
import {
  StratofoldConnectError,
  type ConnectRequest,
  type ConnectSeams,
  type StratofoldConnection,
} from './providers/stratofold/connection'
import { StratofoldSource } from './providers/stratofold/source'
import {
  clearWorkspaceTabs,
  openFileTab,
  removeTabsUnder,
  setTabDirty,
  updateTabPath,
  activeDocumentPath,
} from '../workbench/tabs'

export type WorkspacePhase =
  'starting' | 'restoring' | 'no-workspace' | 'ready' | 'unsupported' | 'failed'

/** Shell-facing summary of the remote connection; never contains the token. */
export interface RemoteWorkspaceSummary {
  server: string
  vdir: string
  name: string
  role: 'editor' | 'viewer' | 'public'
  remembered: boolean
  rejected: boolean
}

export interface RemoteErrorSummary {
  code: string
  message: string
}

export interface WorkspaceSnapshot {
  phase: WorkspacePhase
  generation: number
  descriptor?: WorkspaceDescriptor
  capabilities?: WorkspaceCapabilities
  error?: { code: WorkspaceErrorCode; path?: WorkspacePath }
  restoreAvailable: boolean
  writable: boolean
  selection: WorkspacePath | null
  explorerRevision: number
  unsupportedReason?: string
  remote?: RemoteWorkspaceSummary
  remoteError?: RemoteErrorSummary
}

export interface WorkspaceRuntimeOptions {
  /** Folder source seam: creates the provider used by open and restore. */
  providerFactory?: () => WorkspaceProvider
  supportsFolder?: () => boolean
  handleStore?: HandleStore
  activeStore?: ActiveWorkspaceStore
  connectionStore?: ConnectionStore
  /** Test seam for the Stratofold connect flow. */
  connectSeams?: ConnectSeams
  eventTarget?: EventTarget
  isVisible?: () => boolean
  now?: () => number
  createSession?: (handle: WorkspaceHandle) => WorkspaceSession
  pluginHost?: PluginHost
  handlerPool?: HandlerPool
}

const INITIAL_SNAPSHOT: WorkspaceSnapshot = {
  phase: 'starting',
  generation: 0,
  restoreAvailable: false,
  writable: false,
  selection: null,
  explorerRevision: 0,
}

export class WorkspaceRuntime {
  readonly documents: DocumentStore
  readonly pluginConfig: PluginConfigStore
  readonly pluginHost: PluginHost
  readonly handlers: HandlerPool

  private readonly fileChanges: FileChangeCoalescer
  private readonly echoes: SelfWriteEcho
  private readonly options: WorkspaceRuntimeOptions
  private readonly handleStore: HandleStore
  private readonly activeStore: ActiveWorkspaceStore
  private readonly stratofold: StratofoldSource
  private readonly listeners = new Set<() => void>()
  private readonly supportsFolder: () => boolean
  private current: WorkspaceSnapshot = INITIAL_SNAPSHOT
  private provider: WorkspaceProvider | null = null
  private session: WorkspaceSession | null = null
  private externalRegistration: { dispose(): void } | null = null
  private reservedDocumentHandler: ((path: WorkspacePath) => void) | null = null
  private startPromise: Promise<void> | null = null
  private disposed = false
  private generationCount = 0
  private remote: RemoteWorkspaceSummary | null = null
  private remoteError: RemoteErrorSummary | null = null

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.options = options
    this.handleStore = options.handleStore ?? new IndexedDbHandleStore()
    this.activeStore = options.activeStore ?? new IndexedDbActiveWorkspaceStore()
    this.supportsFolder = options.supportsFolder ?? supportsFolderWorkspaces
    this.stratofold = new StratofoldSource({
      connectionStore: options.connectionStore ?? new IndexedDbConnectionStore(),
      seams: options.connectSeams,
    })
    this.pluginConfig = new PluginConfigStore({
      eventTarget: options.eventTarget,
      isVisible: options.isVisible,
    })
    this.pluginHost = options.pluginHost ?? new PluginHost()
    this.handlers =
      options.handlerPool ??
      new HandlerPool({
        onHandlerClosed: (path) => this.documents.handleHandlerClosed(path),
      })
    this.pluginHost.setHandlerLifecycle(this.handlers)
    this.fileChanges = new FileChangeCoalescer({
      publish: (payload) => {
        this.handlers.publish('workspace/file-changed', payload, { burst: true })
      },
    })
    this.echoes = new SelfWriteEcho(() => this.now())
    this.documents = new DocumentStore({
      getSession: () => this.session,
      onDirtyChange: (path, dirty) => setTabDirty(path, dirty),
      onSaved: (change) => this.publishShellChange(change),
      editors: this.handlers,
    })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): WorkspaceSnapshot => this.current

  getSession(): WorkspaceSession | null {
    return this.session
  }

  getProvider(): WorkspaceProvider | null {
    return this.provider
  }

  getRemote(): RemoteWorkspaceSummary | null {
    return this.remote
  }

  setReservedDocumentHandler(handler: ((path: WorkspacePath) => void) | null): void {
    this.reservedDocumentHandler = handler
  }

  /** The workbench theme is global, so this does not depend on a workspace. */
  publishTheme(theme: ThemeName): void {
    this.handlers.publish('theme/changed', { theme })
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.startInternal()
    return this.startPromise
  }

  async openFolder(): Promise<void> {
    if (this.disposed) return
    if (!this.supportsFolder()) {
      this.patch({
        phase: this.session ? this.current.phase : 'unsupported',
        error: { code: 'unsupported' },
        unsupportedReason:
          'This browser does not support opening a local folder. Chromium is required.',
      })
      return
    }
    const provider = this.providerFactory()
    let handle: WorkspaceHandle
    try {
      handle = await provider.open()
    } catch (error) {
      provider.dispose()
      if (isAborted(error)) return
      const mapped = asWorkspaceError(error)
      this.patch({
        phase: this.session ? this.current.phase : 'failed',
        error: { code: mapped.code, path: mapped.path },
      })
      return
    }
    await this.activate(handle, provider)
    this.remote = null
    this.remoteError = null
    this.patch({ remote: undefined, remoteError: undefined })
    await this.persistActive('folder', handle.descriptor.id)
  }

  /**
   * Validate a Stratofold connection and make it the active workspace. A failed
   * validation leaves the active workspace, its tabs and its unsaved documents
   * untouched.
   */
  async connectRemote(
    request: ConnectRequest,
    options: { remember?: boolean } = {},
  ): Promise<boolean> {
    if (this.disposed) return false
    this.remoteError = null
    this.patch({ remoteError: undefined })

    let connected
    try {
      connected = await this.stratofold.connect(request, {
        remember: options.remember ?? false,
        onCredentialRejected: () => this.onCredentialRejected(),
      })
    } catch (error) {
      if (isAborted(error)) return false
      this.patch({ remoteError: connectErrorSummary(error) })
      return false
    }

    await this.activate(connected.handle, connected.provider)
    this.remote = summaryOf(connected.connection, connected.remembered)
    this.patch({ remote: this.remote })
    await this.persistActive('stratofold', connected.handle.descriptor.id)
    return true
  }

  /** Release the active workspace and forget the remote connection. */
  async disconnect(): Promise<void> {
    if (this.disposed) return
    const hadWorkspace = this.session !== null
    await this.deactivate('close')
    this.generationCount += 1
    this.remote = null
    this.remoteError = null
    await this.activeStore.clear().catch(() => undefined)
    await this.stratofold.forget().catch(() => undefined)
    this.patch({
      phase: hadWorkspace || this.current.phase === 'ready' ? 'no-workspace' : this.current.phase,
      generation: this.generationCount,
      descriptor: undefined,
      capabilities: undefined,
      error: undefined,
      restoreAvailable: false,
      writable: false,
      selection: null,
      explorerRevision: this.current.explorerRevision + 1,
      remote: undefined,
      remoteError: undefined,
    })
  }

  async requestPermission(): Promise<void> {
    if (!this.session) return
    const session = this.session
    try {
      const capabilities = await session.requestPermission()
      if (this.session !== session) return
      this.patch({
        capabilities,
        writable: capabilities.writable,
        descriptor: session.descriptor,
        error: undefined,
      })
    } catch (error) {
      if (isAborted(error)) return
      const mapped = asWorkspaceError(error)
      this.patch({ error: { code: mapped.code, path: mapped.path } })
    }
  }

  refreshExplorer(): void {
    this.patch({ explorerRevision: this.current.explorerRevision + 1 })
  }

  setSelection(path: WorkspacePath | null): void {
    if (this.current.selection === path) return
    this.patch({ selection: path })
  }

  setError(error: { code: WorkspaceErrorCode; path?: WorkspacePath } | null): void {
    this.patch({ error: error ?? undefined })
  }

  openDocument(path: WorkspacePath): void {
    let normalized: WorkspacePath
    try {
      normalized = normalizePath(path)
    } catch {
      return
    }
    const caseSensitive = this.current.capabilities?.caseSensitive ?? true
    if (isReservedPath(normalized, caseSensitive)) {
      this.reservedDocumentHandler?.(normalized)
      return
    }
    openFileTab(path)
    void this.documents.open(path)
  }

  async saveActiveDocument(): Promise<boolean> {
    const path = activeDocumentPath()
    if (!path) return false
    return this.documents.save(path)
  }

  renameOpenPath(previousPath: WorkspacePath, nextPath: WorkspacePath, stat: FileStat): void {
    this.documents.rename(previousPath, nextPath, stat)
    updateTabPath(previousPath, nextPath)
    this.publishShellChange({
      kind: 'renamed',
      previousPath,
      path: nextPath,
      stat,
    })
  }

  deletePath(path: WorkspacePath): void {
    this.documents.deleteUnder(path)
    removeTabsUnder(path)
  }

  closeDocuments(paths: WorkspacePath[]): void {
    for (const path of paths) this.documents.close(path)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.reservedDocumentHandler = null
    this.pluginHost.dispose()
    this.handlers.disposeTransport()
    this.pluginConfig.detach()
    await this.deactivate('close')
    this.documents.clear()
    this.listeners.clear()
    this.startPromise = null
  }

  private providerFactory(): WorkspaceProvider {
    if (this.options.providerFactory) return this.options.providerFactory()
    return new FolderWorkspaceProvider({ handleStore: this.handleStore })
  }

  private async startInternal(): Promise<void> {
    this.patch({ phase: 'restoring' })

    let marker: { kind: string; id: string } | null
    try {
      marker = await this.activeStore.get()
    } catch {
      marker = null
    }

    if (marker?.kind === 'stratofold') {
      if (await this.restoreRemote(marker.id)) return
      this.patch({ phase: 'no-workspace', restoreAvailable: true, remote: this.remoteSummary() })
      return
    }

    if (marker && marker.kind !== 'folder') {
      this.patch({ phase: 'no-workspace', restoreAvailable: true })
      return
    }

    if (!this.supportsFolder()) {
      this.patch({
        phase: 'unsupported',
        unsupportedReason:
          'This browser does not support opening a local folder. Chromium is required.',
      })
      return
    }

    let provider: WorkspaceProvider | null = null
    try {
      const record = marker ? { id: marker.id } : await this.handleStore.get()
      if (!record) {
        this.patch({ phase: 'no-workspace', restoreAvailable: false })
        return
      }
      provider = this.providerFactory()
      if (!provider.restore) {
        provider.dispose()
        provider = null
        this.patch({ phase: 'no-workspace', restoreAvailable: true })
        return
      }
      const handle = await provider.restore(record.id)
      if (handle) {
        await this.activate(handle, provider)
        await this.persistActive('folder', handle.descriptor.id)
        return
      }
      this.patch({
        phase: 'no-workspace',
        restoreAvailable: true,
        error: { code: 'not-found' },
      })
      provider.dispose()
    } catch (error) {
      provider?.dispose()
      const mapped = asWorkspaceError(error)
      this.patch({
        phase: 'failed',
        error: { code: mapped.code, path: mapped.path },
      })
    }
  }

  private async restoreRemote(id: string): Promise<boolean> {
    try {
      const restored = await this.stratofold.restore(id, {
        remember: true,
        onCredentialRejected: () => this.onCredentialRejected(),
      })
      if (!restored) return false
      await this.activate(restored.handle, restored.provider)
      this.remote = summaryOf(restored.connection, true)
      this.patch({ remote: this.remote, remoteError: undefined })
      return true
    } catch (error) {
      if (error instanceof StratofoldConnectError) {
        const stored = await this.stratofold.peek().catch(() => null)
        this.remote = stored ? summaryOf(stored, true, true) : null
        this.remoteError = { code: error.code, message: error.message }
        this.patch({ remote: this.remote ?? undefined, remoteError: this.remoteError })
        return false
      }
      const mapped = asWorkspaceError(error)
      this.remoteError = {
        code: mapped.code,
        message: workspaceErrorMessage(mapped.code, mapped.path),
      }
      this.patch({ remoteError: this.remoteError })
      return false
    }
  }

  private remoteSummary(): RemoteWorkspaceSummary | undefined {
    return this.remote ?? undefined
  }

  private onCredentialRejected(): void {
    if (!this.remote || this.remote.rejected) return
    this.remote = { ...this.remote, rejected: true }
    this.patch({ remote: this.remote })
  }

  private async activate(handle: WorkspaceHandle, provider: WorkspaceProvider): Promise<void> {
    await this.deactivate()

    this.generationCount += 1
    const session = this.createSession(handle)
    this.session = session
    this.provider = provider
    this.externalRegistration = session.onExternalChange((change) => {
      this.publishExternalChange(change)
      if (change.kind === 'renamed') {
        updateTabPath(change.previousPath, change.path)
      }
    })
    const capabilities = session.capabilities()
    this.patch({
      phase: 'ready',
      generation: this.generationCount,
      descriptor: handle.descriptor,
      capabilities,
      error: undefined,
      restoreAvailable: false,
      writable: capabilities.writable,
      selection: null,
      explorerRevision: this.current.explorerRevision + 1,
    })
    void this.pluginConfig.attach(session)
    this.pluginHost.attach({ session, config: this.pluginConfig })
    this.handlers.attach({
      session,
      host: this.pluginHost,
      workspaceName: handle.descriptor.name,
    })
  }

  private publishExternalChange(change: WorkspaceChange): void {
    this.documents.applyExternal(change)
    if (this.echoes.isEcho(change)) return
    this.fileChanges.push(change)
  }

  private publishShellChange(change: WorkspaceChange): void {
    if (change.kind !== 'deleted') {
      this.echoes.record(change.path, change.stat.version)
    }
    this.fileChanges.push(change)
  }

  private now(): number {
    return (this.options.now ?? (() => Date.now()))()
  }

  private async deactivate(reason: 'switch' | 'close' = 'switch'): Promise<void> {
    this.handlers.publishWorkspaceClosed(reason)
    await this.handlers.detach()
    this.fileChanges.reset()
    this.echoes.reset()
    this.pluginHost.detach()
    this.pluginConfig.detach()
    this.externalRegistration?.dispose()
    this.externalRegistration = null
    const previousSession = this.session
    const previousProvider = this.provider
    this.session = null
    this.provider = null
    // Cancel in-flight saves and drop document state before the old session is
    // released, so no write can reach the previous workspace.
    this.documents.clear()
    clearWorkspaceTabs()
    await previousSession?.dispose()
    previousProvider?.dispose()
  }

  private async persistActive(kind: string, id: string): Promise<void> {
    try {
      await this.activeStore.put({ kind, id })
    } catch {
      // Persistence is best effort; the workspace still works for this session.
    }
  }

  private createSession(handle: WorkspaceHandle): WorkspaceSession {
    if (this.options.createSession) return this.options.createSession(handle)
    return new Session(handle, {
      eventTarget: this.options.eventTarget,
      now: this.options.now,
    })
  }

  private patch(partial: Partial<WorkspaceSnapshot>): void {
    this.current = { ...this.current, ...partial }
    for (const listener of this.listeners) listener()
  }
}

function summaryOf(
  connection: StratofoldConnection,
  remembered: boolean,
  rejected = false,
): RemoteWorkspaceSummary {
  return {
    server: connection.server,
    vdir: connection.vdir,
    name: connection.name,
    role: connection.role,
    remembered,
    rejected,
  }
}

function connectErrorSummary(error: unknown): RemoteErrorSummary {
  if (error instanceof StratofoldConnectError) {
    return { code: error.code, message: error.message }
  }
  const mapped = asWorkspaceError(error)
  return {
    code: mapped.code,
    message: workspaceErrorMessage(mapped.code, mapped.path),
  }
}

export { WorkspaceError }
