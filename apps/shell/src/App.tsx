import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  VSCodeWorkbench,
  type FileIconResolver,
  type InitialWorkbenchSession,
  type WorkbenchTab,
} from 'vscode-workbench'
import { DocumentArea } from './document/DocumentArea'
import { requestExplorerCommand } from './explorer/bus'
import { ConnectRemoteDialog } from './workspace/ConnectRemoteDialog'
import { onRemoteConnect, requestRemoteConnect } from './workspace/connect-bus'
import { ConsentDialog } from './plugins/ConsentDialog'
import { SettingsDialog, type SettingsSection } from './settings/SettingsDialog'
import { ThemeSync } from './theme-sync'
import {
  createExoCommandRegistry,
  type CommandContext,
  type ExoCommandHandlers,
} from './workbench/commands'
import { workbenchConfig } from './workbench/config'
import { workbenchMenus } from './workbench/menus'
import { createQuickOpenProvider } from './workbench/quick-open'
import { ExoStatusBar } from './workbench/status-bar'
import { activeDocumentPath, configurePresetStore, installCloseGuard } from './workbench/tabs'
import { workbenchViews } from './workbench/views'
import { workspaceErrorMessage, type WorkspacePath } from './workspace/contract'
import {
  useDirtyDocuments,
  usePluginHost,
  useWorkspaceSnapshot,
  WorkspaceRuntimeProvider,
} from './workspace/context'
import { WorkspaceRuntime } from './workspace/runtime'

configurePresetStore()

const EMPTY_SESSION: InitialWorkbenchSession = {
  tabs: [],
  activeTabId: null,
  outputLines: [],
}

const FILE_ICONS: FileIconResolver = { icon: () => 'file' }

interface PendingClose {
  paths: WorkspacePath[]
  proceed: () => void
}

export interface AppProps {
  runtime?: WorkspaceRuntime
}

export function App({ runtime: providedRuntime }: AppProps = {}) {
  const [createdRuntime] = useState(() => new WorkspaceRuntime())
  const runtime = providedRuntime ?? createdRuntime

  return (
    <WorkspaceRuntimeProvider runtime={runtime}>
      <Shell runtime={runtime} />
    </WorkspaceRuntimeProvider>
  )
}

function Shell({ runtime }: { runtime: WorkspaceRuntime }) {
  const snapshot = useWorkspaceSnapshot()
  const dirty = useDirtyDocuments()
  const host = usePluginHost()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [connectOpen, setConnectOpen] = useState(false)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)

  const openSettings = useCallback(() => {
    setSettingsSection('general')
    setSettingsOpen(true)
  }, [])

  const openPluginSettings = useCallback(() => {
    setSettingsSection('plugins')
    setSettingsOpen(true)
  }, [])

  const openWorkspaceSettings = useCallback(() => {
    setSettingsSection('workspace')
    setSettingsOpen(true)
  }, [])

  useEffect(() => {
    void runtime.start()
  }, [runtime])

  useEffect(() => {
    runtime.setReservedDocumentHandler(openPluginSettings)
    return () => runtime.setReservedDocumentHandler(null)
  }, [runtime, openPluginSettings])

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
        return
      }
      if (!activeDocumentPath()) return
      event.preventDefault()
      void runtime.saveActiveDocument()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [runtime])

  useEffect(() => {
    return installCloseGuard(
      (request, proceed) => {
        setCloseError(null)
        setPendingClose({
          paths: request.tabs
            .map((tab) => tab.path)
            .filter((path): path is WorkspacePath => Boolean(path)),
          proceed,
        })
      },
      {
        onClosed: (tabs) => {
          runtime.closeDocuments(
            tabs.map((tab) => tab.path).filter((path): path is WorkspacePath => Boolean(path)),
          )
        },
      },
    )
  }, [runtime])

  const guardDirty = useCallback(
    (action: () => void) => {
      const dirtyPaths = runtime.documents.dirtyPaths()
      if (dirtyPaths.length > 0) {
        setCloseError(null)
        setPendingClose({ paths: dirtyPaths, proceed: action })
        return
      }
      action()
    },
    [runtime],
  )

  const openFolder = useCallback(() => {
    guardDirty(() => void runtime.openFolder())
  }, [guardDirty, runtime])

  const openConnect = useCallback(() => {
    guardDirty(() => setConnectOpen(true))
  }, [guardDirty])

  const disconnectWorkspace = useCallback(() => {
    guardDirty(() => void runtime.disconnect())
  }, [guardDirty, runtime])

  useEffect(() => onRemoteConnect(openConnect), [openConnect])

  const handlers = useMemo<ExoCommandHandlers>(
    () => ({
      openSettings,
      openPluginSettings,
      openWorkspaceSettings,
      openFolder,
      connectRemote: () => requestRemoteConnect(),
      disconnect: disconnectWorkspace,
      restoreAccess: () => void runtime.requestPermission(),
      saveActive: () => void runtime.saveActiveDocument(),
      newFile: () => requestExplorerCommand('new-file'),
      newFolder: () => requestExplorerCommand('new-folder'),
      rename: () => requestExplorerCommand('rename'),
      delete: () => requestExplorerCommand('delete'),
      refreshExplorer: () => runtime.refreshExplorer(),
    }),
    [
      disconnectWorkspace,
      openFolder,
      openPluginSettings,
      openSettings,
      openWorkspaceSettings,
      runtime,
    ],
  )

  const getContext = useCallback((): CommandContext => {
    const current = runtime.getSnapshot()
    return {
      hasWorkspace: current.phase === 'ready',
      writable: current.writable,
      hasSelection: Boolean(current.selection),
      hasActiveDocument: Boolean(activeDocumentPath()),
      remote: Boolean(current.remote),
    }
  }, [runtime])

  const commands = useMemo(
    () => createExoCommandRegistry(getContext, handlers),
    [getContext, handlers],
  )
  const quickOpen = useMemo(createQuickOpenProvider, [])
  const renderDocument = useCallback((tab: WorkbenchTab) => <DocumentArea tab={tab} />, [])

  const savePending = async () => {
    if (!pendingClose) return
    setCloseError(null)
    for (const path of pendingClose.paths) {
      const saved = await runtime.documents.save(path)
      if (!saved) {
        setCloseError(`Could not save ${path}. The document stays open and unsaved.`)
        return
      }
    }
    const proceed = pendingClose.proceed
    setPendingClose(null)
    proceed()
  }

  const discardPending = () => {
    if (!pendingClose) return
    runtime.closeDocuments(pendingClose.paths)
    const proceed = pendingClose.proceed
    setPendingClose(null)
    proceed()
  }

  const cancelPending = () => {
    setPendingClose(null)
    setCloseError(null)
  }

  return (
    <>
      <ThemeSync />
      <VSCodeWorkbench
        config={workbenchConfig}
        views={workbenchViews}
        commands={commands}
        menus={workbenchMenus}
        quickOpen={quickOpen}
        fileIcons={FILE_ICONS}
        renderDocument={renderDocument}
        emptyEditor={<EmptyEditor />}
        branding={{ title: 'Exo Editor', icon: 'code' }}
        commandCenterLabel="Exo Editor"
        statusBar={<ExoStatusBar />}
        initialSession={EMPTY_SESSION}
      />
      <SettingsDialog
        open={settingsOpen}
        section={settingsSection}
        onClose={() => setSettingsOpen(false)}
        onOpenFolder={openFolder}
        onConnectRemote={openConnect}
        onDisconnect={disconnectWorkspace}
      />
      <ConnectRemoteDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      {snapshot.remote?.rejected && (
        <div className="exo-reconnect-banner" role="alert">
          <span>The connection to {snapshot.remote.name} was rejected.</span>
          <button type="button" onClick={openConnect}>
            Reconnect
          </button>
          <button type="button" onClick={disconnectWorkspace}>
            Disconnect
          </button>
        </div>
      )}
      <ConsentDialog
        request={host.consentRequest}
        shellOrigin={typeof window === 'undefined' ? '' : window.location.origin}
        onApprove={(identity) => runtime.pluginHost.approveConsent(identity)}
        onDeny={(identity) => runtime.pluginHost.denyConsent(identity)}
      />
      {pendingClose && (
        <ClosePromptDialog
          paths={pendingClose.paths}
          error={closeError}
          onSave={() => void savePending()}
          onDiscard={discardPending}
          onCancel={cancelPending}
        />
      )}
      {snapshot.phase === 'failed' && snapshot.error && !settingsOpen && (
        <span className="exo-visually-hidden" role="status">
          {workspaceErrorMessage(snapshot.error.code, snapshot.error.path)}
        </span>
      )}
    </>
  )
}

function ClosePromptDialog({
  paths,
  error,
  onSave,
  onDiscard,
  onCancel,
}: {
  paths: WorkspacePath[]
  error: string | null
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const dirtyPaths = paths.filter((path) => Boolean(path))
  return (
    <div className="exo-dialog-backdrop">
      <div className="exo-dialog" role="dialog" aria-modal="true" aria-label="Unsaved changes">
        <h2>Unsaved changes</h2>
        <p>
          {dirtyPaths.length === 1
            ? `${dirtyPaths[0]} has unsaved changes.`
            : `${dirtyPaths.length} documents have unsaved changes.`}
        </p>
        <ul className="exo-close-list">
          {dirtyPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
        {error && <p className="exo-dialog-error">{error}</p>}
        <div className="exo-dialog-actions">
          <button type="button" onClick={onSave}>
            Save and close
          </button>
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyEditor() {
  const snapshot = useWorkspaceSnapshot()
  const hint =
    snapshot.phase === 'ready'
      ? 'Open a file from the explorer.'
      : snapshot.phase === 'unsupported'
        ? 'This browser does not support folder workspaces. Use Chromium.'
        : 'Open a folder to browse files.'
  return (
    <div className="exo-empty-editor">
      <h2>No editors are open</h2>
      <p>{hint}</p>
    </div>
  )
}
