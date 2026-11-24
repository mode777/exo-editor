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
import { ViewPool, type CompanionPanelChange } from '../plugins/view-pool'
import type {
  IntentOutcome,
  IntentSource,
  OpenFileIntent,
  OpenViewIntent,
  PanelIntent,
  PanelIntentOutcome,
} from '../plugins/frame-session'
import { shellCodeFor } from '../plugins/frame-session'
import { FilePickerController } from '../plugins/file-picker'
import { NewFileController } from '../plugins/new-file'
import type { FrameTransport } from '../plugins/frame'
import { PluginSettingsStore, type PluginSettingsStorage } from '../plugins/settings'
import { PluginCommandController, type CommandTargetSession } from '../plugins/commands'
import { EventBus, FileChangeCoalescer, SelfWriteEcho, type ThemeName } from '../plugins/events'
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
import { stratofoldWorkspaceId } from './providers/stratofold/provider'
import { useWorkbenchStore } from 'vscode-workbench'
import {
  clearWorkspaceTabs,
  closeContentTabsFor,
  openContentViewTab,
  openFileTab,
  removeTabsUnder,
  setTabDirty,
  updateTabPath,
  activeDocumentPath,
  contentViewOf,
  type ContentViewTabInfo,
} from '../workbench/tabs'
import { pluginViewId } from '../workbench/plugin-views'
import type { ViewPluginInfo } from '../plugins/view-pool'
import { contentViewKey } from '../plugins/view-pool'
import type { ActiveContentView, ActiveEditor } from '../plugins/view-session'
import type { PluginManifest } from '../plugins/manifest'

export type WorkspacePhase =
  'starting' | 'restoring' | 'no-workspace' | 'ready' | 'unsupported' | 'failed'

/** Shell-facing summary of the remote connection; never contains the token. */
export interface RemoteWorkspaceSummary {
  id: string
  server: string
  vdir: string
  name: string
  role: 'editor' | 'viewer' | 'public'
  /** False only when the connection could not be written to IndexedDB. */
  stored: boolean
  rejected: boolean
  lastOpenedAt?: number
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
  /** Storage seam for workspace-scoped plugin settings. */
  pluginSettingsStorage?: PluginSettingsStorage
  /** Test seam for the Stratofold connect flow. */
  connectSeams?: ConnectSeams
  eventTarget?: EventTarget
  isVisible?: () => boolean
  now?: () => number
  createSession?: (handle: WorkspaceHandle) => WorkspaceSession
  pluginHost?: PluginHost
  handlerPool?: HandlerPool
  viewPool?: ViewPool
  /** Frame transport for the default view pool; tests inject a fake. */
  viewTransport?: FrameTransport
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
  readonly views: ViewPool
  /** The one event bus for the current workspace; shared by handler pools. */
  readonly events: EventBus
  readonly filePicker: FilePickerController
  readonly newFiles: NewFileController
  readonly pluginSettings: PluginSettingsStore
  readonly commands: PluginCommandController

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
  private contentInstance = 0
  private activeContent: ContentViewTabInfo | null = null
  private activeEditor: ActiveEditor | null = null
  private readonly documentSubscription: () => void
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
      now: options.now,
    })
    this.pluginConfig = new PluginConfigStore({
      eventTarget: options.eventTarget,
      isVisible: options.isVisible,
    })
    this.pluginHost = options.pluginHost ?? new PluginHost()
    this.filePicker = new FilePickerController()
    this.newFiles = new NewFileController({
      onCreated: (path, kind) => {
        this.refreshExplorer()
        if (kind === 'template') this.openDocument(path)
        // The dialog closes in the same tick as the write; refresh again once
        // the filesystem listing settles so the new entry is visible.
        setTimeout(() => {
          if (!this.disposed) this.refreshExplorer()
        }, 500)
      },
      onLog: (event) =>
        this.pluginHost.logHandler(event.identity, event.phase, event.code, event.message),
    })
    this.events =
      options.handlerPool?.events ??
      new EventBus({
        onSubscriberRemoved: (label, topic, code) =>
          this.pluginHost.logHandler(label, 'handler-events', code, topic),
      })
    this.handlers =
      options.handlerPool ??
      new HandlerPool({
        events: this.events,
        onHandlerClosed: (path) => {
          this.documents.handleHandlerClosed(path)
          this.syncActiveEditor()
        },
        onSaveRequested: (path) => this.documents.saveFromPlugin(path),
        onRequestFiles: (request) => this.filePicker.request(request),
        onRequestNewFile: (request) =>
          this.filePicker.getSnapshot() !== null
            ? Promise.resolve({ ok: false, code: 'rate-limited' })
            : this.newFiles.request(request),
        isPickerOpen: () => this.filePicker.getSnapshot() !== null,
        onOpenFile: (request, source) => this.openFileIntent(request, source),
        onOpenView: (request, source) => this.openViewIntent(request, source),
        onRequestPanel: (request, source) => this.requestPanelIntent(request, source),
      })
    this.views =
      options.viewPool ??
      new ViewPool({
        ...(options.viewTransport === undefined ? {} : { transport: options.viewTransport }),
        events: this.events,
        onRequestFiles: (request) => this.filePicker.request(request),
        onRequestNewFile: (request) => this.newFiles.request(request),
        onOpenFile: (request, source) => this.openFileIntent(request, source),
        onOpenView: (request, source) => this.openViewIntent(request, source),
        onRequestPanel: (request, source) => this.requestPanelIntent(request, source),
        onCompanionPanel: (change) => this.applyCompanionChange(change),
      })
    this.pluginSettings = new PluginSettingsStore({
      storage: options.pluginSettingsStorage,
      onChange: (identity, values) => {
        if (!this.handlers.updateSettings(identity, values)) {
          this.views.updateSettings(identity, values)
        }
      },
    })
    this.pluginHost.setHandlerLifecycle(this.handlers)
    this.pluginHost.setViewLifecycle({
      closeFor: (identity) => this.closeViewsFor(identity),
    })
    this.pluginHost.setNewFileLifecycle?.({
      closeFor: (identity) => this.newFiles.closeFor(identity, 'plugin-removed'),
    })
    this.commands = new PluginCommandController({
      host: this.pluginHost,
      activeEditor: (identity) => this.activeEditorTarget(identity),
      revealPanel: (identity, panelId) => this.revealCommandPanel(identity, panelId),
      openContentView: (identity, viewId, instanceKey) =>
        this.openCommandContentView(identity, viewId, instanceKey),
    })
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
    this.documentSubscription = this.documents.subscribeAny(() => this.syncActiveEditor())
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
    if (this.session?.descriptor.id !== handle.descriptor.id) return
    this.remote = null
    this.remoteError = null
    this.patch({ remote: undefined, remoteError: undefined })
    await this.persistActive('folder', handle.descriptor.id)
  }

  /**
   * Validate a Stratofold connection, store it in the recent list and make it
   * the active workspace. A failed validation leaves the active workspace, its
   * tabs and its unsaved documents untouched.
   */
  async connectRemote(request: ConnectRequest): Promise<boolean> {
    if (this.disposed) return false
    this.remoteError = null
    this.patch({ remoteError: undefined })

    let connected
    try {
      connected = await this.stratofold.connect(request, {
        onCredentialRejected: () => this.onCredentialRejected(),
      })
    } catch (error) {
      if (isAborted(error)) return false
      this.patch({ remoteError: connectErrorSummary(error) })
      return false
    }

    await this.activate(connected.handle, connected.provider)
    if (this.session?.descriptor.id !== connected.handle.descriptor.id) return false
    this.remote = summaryOf(connected.connection, connected.stored)
    this.patch({ remote: this.remote })
    await this.persistActive('stratofold', connected.handle.descriptor.id)
    return true
  }

  /** Newest-first remote workspaces available for reopening; never includes tokens. */
  async listRemoteConnections(): Promise<RemoteWorkspaceSummary[]> {
    const records = await this.stratofold.list()
    return records.map((record) => summaryOf(record.connection, true, false, record.lastOpenedAt))
  }

  /** Revalidate and open a stored recent workspace without retyping its token. */
  async openRemoteRecent(id: string): Promise<boolean> {
    if (this.disposed) return false
    let record
    try {
      record = await this.stratofold.get(id)
    } catch (error) {
      this.patch({ remoteError: connectErrorSummary(error) })
      return false
    }
    if (!record) {
      this.patch({
        remoteError: {
          code: 'not-found',
          message: 'That workspace is no longer in the recent list.',
        },
      })
      return false
    }
    return this.connectRemote({
      server: record.connection.server,
      token: record.connection.token,
      vdir: record.connection.vdir,
    })
  }

  /** Remove one stored connection and its token, disconnecting it when active. */
  async removeRemoteConnection(id: string): Promise<boolean> {
    if (this.disposed) return false
    try {
      await this.stratofold.remove(id)
    } catch (error) {
      this.patch({ remoteError: connectErrorSummary(error) })
      return false
    }
    if (this.remote?.id === id) await this.disconnect()
    return true
  }

  /** Release the active workspace; the recent entry and its token are kept. */
  async disconnect(): Promise<void> {
    if (this.disposed) return
    const hadWorkspace = this.session !== null
    await this.deactivate('close')
    this.generationCount += 1
    this.remote = null
    this.remoteError = null
    await this.activeStore.clear().catch(() => undefined)
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
    this.syncActiveEditor()
  }

  deletePath(path: WorkspacePath): void {
    this.documents.deleteUnder(path)
    removeTabsUnder(path)
    this.syncActiveEditor()
  }

  closeDocuments(paths: WorkspacePath[]): void {
    for (const path of paths) this.documents.close(path)
    this.syncActiveEditor()
  }

  /** Dispose the frames behind tabs the workbench removed. */
  closeTabs(tabs: Array<{ path?: string; contentView?: { key: string } }>): void {
    const paths: WorkspacePath[] = []
    for (const tab of tabs) {
      if (tab.contentView) {
        this.views.closeContent(tab.contentView.key, 'closed')
        continue
      }
      if (tab.path) paths.push(tab.path)
    }
    if (paths.length > 0) this.closeDocuments(paths)
  }

  /** Show a plugin panel from the palette or a view picker. */
  showPanel(viewId: string, location: 'primary' | 'secondary' | 'bottom'): void {
    const store = useWorkbenchStore.getState()
    if (location === 'primary') store.showPrimaryView(viewId)
    else if (location === 'secondary') store.showSecondaryView(viewId)
    else store.showPanelView(viewId)
  }

  /**
   * Follow the workbench's active tab. The companion belongs to the active
   * content view, not to the set of open tabs, so switching to a file or a
   * non-companion view hides it and returning reveals it again.
   */
  setActiveTab(tabId: string | null): void {
    const store = useWorkbenchStore.getState()
    const tab = tabId ? store.tabs.find((entry) => entry.id === tabId) : undefined
    const next = tab ? (contentViewOf(tab) ?? null) : null
    const previous = this.activeContent
    if (previous?.key !== next?.key) {
      const previousCompanion = previous ? this.companionOf(previous) : null
      const nextCompanion = next ? this.companionOf(next) : null
      const sharedCompanion =
        previousCompanion !== null &&
        nextCompanion !== null &&
        previousCompanion.identity === nextCompanion.identity &&
        previousCompanion.panelId === nextCompanion.panelId

      this.activeContent = next

      if (previousCompanion && !sharedCompanion) {
        this.applyCompanionChange({
          action: 'hide',
          identity: previousCompanion.identity,
          panelId: previousCompanion.panelId,
        })
      }
      if (nextCompanion) {
        this.applyCompanionChange({
          action: 'show',
          identity: nextCompanion.identity,
          panelId: nextCompanion.panelId,
        })
      }

      if (previous && (!next || previous.identity !== next.identity)) {
        this.events.publish(
          'view/active',
          { pluginId: previous.pluginId, active: false },
          { target: previous.identity },
        )
      }
      if (next) {
        this.events.publish(
          'view/active',
          {
            pluginId: next.pluginId,
            active: true,
            viewId: next.viewId,
            instanceId: next.key,
            instanceKey: next.instanceKey,
          },
          { target: next.identity },
        )
      }
    }
    this.syncActiveEditor()
  }

  private activeContentViewContext(): ActiveContentView | null {
    const active = this.activeContent
    if (!active) return null
    return {
      pluginId: active.pluginId,
      viewId: active.viewId,
      instanceId: active.key,
      instanceKey: active.instanceKey,
    }
  }

  /**
   * Derive the active file editor from the active tab, the document surface and
   * the mounted handler. Only an active handler of the active tab is advertised;
   * a mounting, failed, text, content-view or background surface clears it.
   */
  private syncActiveEditor(): void {
    if (!this.session) {
      this.activeEditor = null
      return
    }
    const path = activeDocumentPath()
    const document = path ? this.documents.get(path) : undefined
    const handler = path ? this.handlers.get(path) : undefined
    const next: ActiveEditor | null =
      path &&
      document?.surface === 'plugin' &&
      document.pluginPhase === 'active' &&
      document.editor &&
      handler?.active
        ? {
            identity: document.editor.identity,
            pluginId: document.editor.pluginId,
            path,
            instanceId: handler.instanceId,
          }
        : null
    const previous = this.activeEditor
    if (
      previous?.identity === next?.identity &&
      previous?.path === next?.path &&
      previous?.instanceId === next?.instanceId
    ) {
      return
    }
    this.activeEditor = next
    if (previous && (!next || previous.identity !== next.identity)) {
      this.events.publish(
        'editor/active',
        { pluginId: previous.pluginId, active: false },
        { target: previous.identity },
      )
    }
    if (next) {
      this.events.publish(
        'editor/active',
        { pluginId: next.pluginId, active: true, path: next.path, instanceId: next.instanceId },
        { target: next.identity },
      )
    }
  }

  private activeEditorContext(): ActiveEditor | null {
    return this.activeEditor ? { ...this.activeEditor } : null
  }

  private companionOf(content: ContentViewTabInfo): { identity: string; panelId: string } | null {
    return content.companionPanel
      ? { identity: content.identity, panelId: content.companionPanel }
      : null
  }

  /**
   * Apply a content-view companion change through the ordinary secondary-panel
   * path. A show is skipped unless the panel is registered and secondary; a
   * hide only closes the region when the companion is the active, visible view,
   * so a manual hide or another selected panel is respected.
   */
  private applyCompanionChange(change: CompanionPanelChange): void {
    const panelViewId = pluginViewId(change.identity, change.panelId)
    if (change.action === 'show') {
      const record = this.pluginHost
        .getSnapshot()
        .records.find((entry) => entry.identity === change.identity && entry.phase === 'active')
      const panel = record?.panels.find((entry) => entry.id === change.panelId)
      if (!panel || panel.location !== 'secondary') return
      this.showPanel(panelViewId, 'secondary')
      return
    }
    const store = useWorkbenchStore.getState()
    if (store.secondarySideBarVisible && store.activeSecondaryView === panelViewId) {
      store.toggleSecondarySideBar(panelViewId)
    }
  }

  /** Open a content view from the shell palette or a "Show View" entry. */
  openContentView(identity: string, viewId: string): void {
    this.contentInstance += 1
    void this.openContentViewWithKey(identity, viewId, `shell-${this.contentInstance}`)
  }

  private openContentViewWithKey(identity: string, viewId: string, instanceKey: string): boolean {
    const record = this.pluginHost
      .getSnapshot()
      .records.find((entry) => entry.identity === identity && entry.phase === 'active')
    if (!record?.identity || !record.manifest) return false
    const view = record.contentViews.find((entry) => entry.id === viewId)
    if (!view) return false
    const plugin = viewPluginInfo(record)
    const opened = this.views.openContent({
      plugin,
      view: {
        id: view.id,
        title: view.title,
        entryUrl: view.entryUrl,
        ...(view.companionPanel === undefined ? {} : { companionPanel: view.companionPanel }),
      },
      instanceKey,
    })
    if (!opened.ok) return false
    if (opened.existing) {
      useWorkbenchStore.getState().activateTab(opened.key)
    } else {
      openContentViewTab({
        key: opened.key,
        title: view.title,
        pluginName: plugin.pluginName,
        identity: plugin.identity,
        pluginId: plugin.pluginId,
        viewId: view.id,
        instanceKey,
        ...(view.companionPanel === undefined ? {} : { companionPanel: view.companionPanel }),
      })
    }
    this.setActiveTab(opened.key)
    return true
  }

  private activeEditorTarget(identity: string): CommandTargetSession | null {
    const path = activeDocumentPath()
    if (!path) return null
    const document = this.documents.get(path)
    if (
      document?.surface !== 'plugin' ||
      document.pluginPhase !== 'active' ||
      document.editor?.identity !== identity
    ) {
      return null
    }
    return this.handlers.get(path) ?? null
  }

  private async revealCommandPanel(
    identity: string,
    panelId: string,
  ): Promise<CommandTargetSession | null> {
    const record = this.pluginHost
      .getSnapshot()
      .records.find((entry) => entry.identity === identity && entry.phase === 'active')
    const panel = record?.panels.find((entry) => entry.id === panelId)
    if (!record?.identity || !panel) return null
    this.showPanel(pluginViewId(record.identity, panel.id), panel.location)
    return this.views.waitForPanel(record.identity, panel.id)
  }

  private async openCommandContentView(
    identity: string,
    viewId: string,
    instanceKey: string,
  ): Promise<CommandTargetSession | null> {
    if (!this.openContentViewWithKey(identity, viewId, instanceKey)) return null
    const key = contentViewKey(identity, viewId, instanceKey)
    return this.views.waitForContent(key)
  }

  private async openFileIntent(
    request: OpenFileIntent,
    source: IntentSource,
  ): Promise<IntentOutcome> {
    if (!this.session) return { ok: false, code: 'internal' }
    try {
      const stat = await this.session.forPlugin(source.pluginId).stat(request.path)
      if (stat.kind !== 'file') return { ok: false, code: 'not-a-file' }
    } catch (error) {
      return { ok: false, code: shellCodeFor(error) }
    }
    if (this.fileTabCount() >= 50) {
      return {
        ok: false,
        code: 'rate-limited',
        message: 'The workspace already has the maximum of 50 plugin-opened file tabs.',
      }
    }
    this.openDocument(request.path)
    return { ok: true }
  }

  private async openViewIntent(
    request: OpenViewIntent,
    source: IntentSource,
  ): Promise<IntentOutcome> {
    const snapshot = this.pluginHost.getSnapshot()
    const record = request.pluginId
      ? snapshot.records.find(
          (entry) => entry.phase === 'active' && entry.manifest?.id === request.pluginId,
        )
      : snapshot.records.find(
          (entry) => entry.phase === 'active' && entry.identity === source.identity,
        )
    if (!record?.identity || !record.manifest) return { ok: false, code: 'not-found' }
    const view = record.contentViews.find((entry) => entry.id === request.viewId)
    if (!view) return { ok: false, code: 'not-found' }
    const plugin = viewPluginInfo(record)
    this.contentInstance += 1
    const instanceKey = request.instanceKey ?? `auto-${this.contentInstance}`
    const opened = this.views.openContent({
      plugin,
      view: {
        id: view.id,
        title: view.title,
        entryUrl: view.entryUrl,
        ...(view.companionPanel === undefined ? {} : { companionPanel: view.companionPanel }),
      },
      instanceKey,
      ...(request.payload === undefined ? {} : { payload: request.payload }),
      openedBy: {
        pluginId: source.pluginId,
        pluginName: source.pluginName,
        origin: source.origin,
      },
    })
    if (!opened.ok) {
      return { ok: false, code: opened.code, message: opened.message }
    }
    if (!opened.existing) {
      openContentViewTab({
        key: opened.key,
        title: view.title,
        pluginName: plugin.pluginName,
        identity: plugin.identity,
        pluginId: plugin.pluginId,
        viewId: view.id,
        instanceKey,
        ...(view.companionPanel === undefined ? {} : { companionPanel: view.companionPanel }),
      })
    }
    this.setActiveTab(opened.key)
    return { ok: true }
  }

  private async requestPanelIntent(
    request: PanelIntent,
    source: IntentSource,
  ): Promise<PanelIntentOutcome> {
    const record = this.pluginHost
      .getSnapshot()
      .records.find((entry) => entry.phase === 'active' && entry.identity === source.identity)
    const panel = record?.panels.find((entry) => entry.id === request.panel)
    if (!record?.identity || !panel) return { ok: false, code: 'not-found' }
    const viewId = pluginViewId(record.identity, panel.id)
    const store = useWorkbenchStore.getState()
    const location = panel.location
    const isOpen =
      location === 'primary'
        ? store.primarySideBarVisible && store.activePrimaryView === viewId
        : location === 'secondary'
          ? store.secondarySideBarVisible && store.activeSecondaryView === viewId
          : store.bottomPanelVisible && store.activePanelView === viewId
    const show = () => this.showPanel(viewId, location)
    const hide = () => {
      if (location === 'primary') store.togglePrimarySideBar(viewId)
      else if (location === 'secondary') store.toggleSecondarySideBar(viewId)
      else store.toggleBottomPanel()
    }
    if (request.action === 'show') {
      show()
      return { ok: true, open: true }
    }
    if (request.action === 'hide') {
      if (isOpen) hide()
      return { ok: true, open: false }
    }
    if (isOpen) hide()
    else show()
    return { ok: true, open: !isOpen }
  }

  private closeViewsFor(identity: string): void {
    this.views.closeFor(identity, 'plugin-removed')
    closeContentTabsFor(identity)
  }

  private fileTabCount(): number {
    return useWorkbenchStore.getState().tabs.filter((tab) => tab.kind === 'file').length
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.reservedDocumentHandler = null
    this.commands.reset()
    this.pluginHost.dispose()
    this.handlers.disposeTransport()
    this.views.disposeTransport()
    this.pluginSettings.detach()
    this.pluginConfig.detach()
    await this.deactivate('close')
    this.documentSubscription()
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
        onCredentialRejected: () => this.onCredentialRejected(),
      })
      if (!restored) return false
      await this.activate(restored.handle, restored.provider)
      if (this.session?.descriptor.id !== restored.handle.descriptor.id) return false
      this.remote = summaryOf(restored.connection, restored.stored)
      this.patch({ remote: this.remote, remoteError: undefined })
      return true
    } catch (error) {
      if (error instanceof StratofoldConnectError) {
        const stored = await this.stratofold.peek(id).catch(() => null)
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
    const generation = this.generationCount
    this.events.reset()
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
    await this.pluginSettings.attach(handle.descriptor.id)
    if (generation !== this.generationCount || this.session !== session) return
    void this.pluginConfig.attach(session)
    this.pluginHost.attach({
      session,
      config: this.pluginConfig,
      settings: this.pluginSettings,
    })
    this.handlers.attach({
      session,
      host: this.pluginHost,
      workspaceName: handle.descriptor.name,
      settings: this.pluginSettings,
    })
    this.views.attach({
      session,
      host: this.pluginHost,
      workspaceName: handle.descriptor.name,
      settings: this.pluginSettings,
      activeContentView: () => this.activeContentViewContext(),
      activeEditor: () => this.activeEditorContext(),
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
    this.newFiles.reset()
    this.filePicker.reset()
    this.commands.reset()
    this.handlers.publishWorkspaceClosed(reason)
    await this.handlers.detach()
    await this.views.detach()
    this.events.reset()
    this.fileChanges.reset()
    this.echoes.reset()
    this.pluginHost.detach()
    this.pluginSettings.detach()
    this.pluginConfig.detach()
    this.externalRegistration?.dispose()
    this.externalRegistration = null
    const previousSession = this.session
    const previousProvider = this.provider
    this.session = null
    this.provider = null
    this.activeEditor = null
    // Cancel in-flight saves and drop document state before the old session is
    // released, so no write can reach the previous workspace.
    this.documents.clear()
    this.activeContent = null
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
  stored: boolean,
  rejected = false,
  lastOpenedAt?: number,
): RemoteWorkspaceSummary {
  return {
    id: stratofoldWorkspaceId(connection),
    server: connection.server,
    vdir: connection.vdir,
    name: connection.name,
    role: connection.role,
    stored,
    rejected,
    ...(lastOpenedAt === undefined ? {} : { lastOpenedAt }),
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

function viewPluginInfo(record: { identity?: string; manifest?: PluginManifest }): ViewPluginInfo {
  if (!record.identity || !record.manifest) {
    throw new Error('A view plugin needs an active identity and manifest.')
  }
  return {
    identity: record.identity,
    pluginId: record.manifest.id,
    pluginName: record.manifest.name,
    pluginVersion: record.manifest.version,
    origin: record.manifest.manifestOrigin,
    permissions: record.manifest.permissions,
  }
}

export { WorkspaceError }
