import {
  WorkspaceError,
  asWorkspaceError,
  isAborted,
  type WorkspaceCapabilities,
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
import { FolderWorkspaceProvider } from './providers/folder/provider'
import { IndexedDbHandleStore, type HandleStore } from './providers/folder/handle-store'
import { supportsFolderWorkspaces } from './providers/folder/fsa'
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
}

export interface WorkspaceRuntimeOptions {
  providerFactory?: () => WorkspaceProvider
  supportsFolder?: () => boolean
  handleStore?: HandleStore
  eventTarget?: EventTarget
  isVisible?: () => boolean
  now?: () => number
  createSession?: (handle: WorkspaceHandle) => WorkspaceSession
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

  private readonly options: WorkspaceRuntimeOptions
  private readonly handleStore: HandleStore
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

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.options = options
    this.handleStore = options.handleStore ?? new IndexedDbHandleStore()
    this.supportsFolder = options.supportsFolder ?? supportsFolderWorkspaces
    this.pluginConfig = new PluginConfigStore({
      eventTarget: options.eventTarget,
      isVisible: options.isVisible,
    })
    this.documents = new DocumentStore({
      getSession: () => this.session,
      onDirtyChange: (path, dirty) => setTabDirty(path, dirty),
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

  setReservedDocumentHandler(handler: ((path: WorkspacePath) => void) | null): void {
    this.reservedDocumentHandler = handler
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
        phase: 'unsupported',
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

  renameOpenPath(
    previousPath: WorkspacePath,
    nextPath: WorkspacePath,
    stat: { version: string; size: number },
  ): void {
    this.documents.rename(previousPath, nextPath, stat)
    updateTabPath(previousPath, nextPath)
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
    this.pluginConfig.detach()
    this.externalRegistration?.dispose()
    this.externalRegistration = null
    await this.session?.dispose()
    this.session = null
    this.provider?.dispose()
    this.provider = null
    this.documents.clear()
    this.listeners.clear()
    this.startPromise = null
  }

  private providerFactory(): WorkspaceProvider {
    if (this.options.providerFactory) return this.options.providerFactory()
    return new FolderWorkspaceProvider({ handleStore: this.handleStore })
  }

  private async startInternal(): Promise<void> {
    if (!this.supportsFolder()) {
      this.patch({
        phase: 'unsupported',
        unsupportedReason:
          'This browser does not support opening a local folder. Chromium is required.',
      })
      return
    }
    this.patch({ phase: 'restoring' })
    let provider: WorkspaceProvider | null = null
    try {
      const record = await this.handleStore.get()
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

  private async activate(handle: WorkspaceHandle, provider: WorkspaceProvider): Promise<void> {
    const previousSession = this.session
    const previousProvider = this.provider
    this.pluginConfig.detach()
    this.externalRegistration?.dispose()
    this.externalRegistration = null
    await previousSession?.dispose()
    previousProvider?.dispose()

    this.generationCount += 1
    clearWorkspaceTabs()
    this.documents.clear()

    const session = this.createSession(handle)
    this.session = session
    this.provider = provider
    this.externalRegistration = session.onExternalChange((change) => {
      this.documents.applyExternal(change)
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

export { WorkspaceError }
