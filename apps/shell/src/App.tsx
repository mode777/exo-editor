import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  VSCodeWorkbench,
  useWorkbenchStore,
  type FileIconResolver,
  type InitialWorkbenchSession,
  type WorkbenchCommand,
  type WorkbenchTab,
} from 'vscode-workbench'
import { DocumentArea } from './document/DocumentArea'
import { FilePickerDialog } from './document/FilePickerDialog'
import { NewFileDialog } from './document/NewFileDialog'
import { OpenWithDialog } from './document/OpenWithDialog'
import { ClosePromptDialog } from './components/ClosePromptDialog'
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
  type PluginPaletteProvider,
} from './workbench/commands'
import { workbenchMenus } from './workbench/menus'
import { createQuickOpenProvider } from './workbench/quick-open'
import { ExoStatusBar } from './workbench/status-bar'
import { CommandNotices } from './workbench/CommandNotices'
import { activeDocumentPath, configurePresetStore, installCloseGuard } from './workbench/tabs'
import type { EditorCandidate } from './plugins/registry'
import { derivePluginWorkbench, pluginViewId } from './workbench/plugin-views'
import { SecondaryViewPicker } from './workbench/SecondaryViewPicker'
import { workspaceErrorMessage, type WorkspacePath } from './workspace/contract'
import {
  useDirtyDocuments,
  useFilePicker,
  useNewFile,
  usePluginHost,
  useWorkspaceSnapshot,
  WorkspaceRuntimeProvider,
} from './workspace/context'
import { WorkspaceRuntime } from './workspace/runtime'
import { dirname } from './workspace/paths'

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
  const filePicker = useFilePicker()
  const newFile = useNewFile()
  const activeTabId = useWorkbenchStore((state) => state.activeTabId)
  const pluginWorkbench = useMemo(() => derivePluginWorkbench(host), [host])
  const secondaryViews = useMemo(
    () =>
      host.records.flatMap((record) =>
        record.phase === 'active' && record.manifest
          ? record.panels
              .filter((panel) => panel.location === 'secondary')
              .map((panel) => ({
                id: pluginViewId(record.identity ?? '', panel.id),
                title: panel.title,
                pluginName: record.manifest?.name ?? 'Plugin',
              }))
          : [],
      ),
    [host],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general')
  const [connectOpen, setConnectOpen] = useState(false)
  const [viewPickerOpen, setViewPickerOpen] = useState(false)
  const [pendingClose, setPendingClose] = useState<PendingClose | null>(null)
  const [closeError, setCloseError] = useState<string | null>(null)
  const [openWith, setOpenWith] = useState<{
    path: WorkspacePath
    candidates: EditorCandidate[]
    currentIdentity?: string
  } | null>(null)

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
    runtime.setActiveTab(activeTabId)
  }, [runtime, activeTabId])

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
          runtime.closeTabs(tabs)
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

  const requestOpenWith = useCallback(() => {
    const path = activeDocumentPath()
    if (!path) return
    const candidates = runtime.documents.candidatesFor(path)
    if (candidates.length === 0) return
    setOpenWith({
      path,
      candidates,
      currentIdentity: runtime.documents.get(path)?.editor?.identity,
    })
  }, [runtime])

  const chooseEditor = useCallback(
    (candidate: EditorCandidate) => {
      if (!openWith) return
      const path = openWith.path
      setOpenWith(null)
      void runtime.documents.chooseEditor(path, candidate)
    },
    [openWith, runtime],
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

  const removeRemoteWorkspace = useCallback(
    (id: string) => {
      guardDirty(() => void runtime.removeRemoteConnection(id))
    },
    [guardDirty, runtime],
  )

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
      openWith: requestOpenWith,
      newFile: () => requestExplorerCommand('new-file'),
      newFolder: () => requestExplorerCommand('new-folder'),
      rename: () => requestExplorerCommand('rename'),
      delete: () => requestExplorerCommand('delete'),
      refreshExplorer: () => runtime.refreshExplorer(),
      collapseExplorer: () => requestExplorerCommand('collapse-all'),
      selectSecondaryView: () => setViewPickerOpen(true),
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
    const activePath = activeDocumentPath()
    const hostSnapshot = runtime.pluginHost.getSnapshot()
    const secondaryViewCount = hostSnapshot.records.reduce(
      (total, record) =>
        total +
        (record.phase === 'active'
          ? record.panels.filter((panel) => panel.location === 'secondary').length
          : 0),
      0,
    )
    return {
      hasWorkspace: current.phase === 'ready',
      writable: current.writable,
      hasSelection: Boolean(current.selection),
      hasActiveDocument: Boolean(activePath),
      hasEditorChoice: activePath ? runtime.documents.candidatesFor(activePath).length > 1 : false,
      remote: Boolean(current.remote),
      secondaryViewCount,
    }
  }, [runtime])

  const getDynamicCommands = useCallback((): WorkbenchCommand[] => {
    const commands: WorkbenchCommand[] = []
    for (const record of runtime.pluginHost.getSnapshot().records) {
      if (record.phase !== 'active' || !record.identity || !record.manifest) continue
      const identity = record.identity
      for (const panel of record.panels) {
        const viewId = pluginViewId(identity, panel.id)
        commands.push({
          id: `exo.views.show.${viewId}`,
          title: `Show ${panel.title}`,
          category: `Views · ${record.manifest.name}`,
          run: () => runtime.showPanel(viewId, panel.location),
        })
      }
      for (const view of record.contentViews) {
        commands.push({
          id: `exo.views.open.${encodeURIComponent(identity)}.${view.id}`,
          title: `Open ${view.title}`,
          category: `Views · ${record.manifest.name}`,
          run: () => runtime.openContentView(identity, view.id),
        })
      }
      for (const template of record.newFiles) {
        commands.push({
          id: `exo.new-file.${encodeURIComponent(identity)}.${template.id}`,
          title: `New ${template.label}`,
          category: `New File · ${record.manifest.name}`,
          run: () => {
            const session = runtime.getSession()
            if (!session) return
            const selection = runtime.getSnapshot().selection
            const directory = selection ? dirname(selection) : '/'
            runtime.newFiles.beginTemplate({
              kind: 'template',
              templateId: template.id,
              fileName: template.fileName,
              identity,
              pluginId: record.manifest?.id ?? '',
              pluginName: record.manifest?.name ?? 'Plugin',
              content: {
                bytes: template.bytes,
                ...(template.text === undefined ? {} : { text: template.text }),
              },
              fallbackDirectory: directory,
              directory,
              session,
            })
          },
        })
      }
    }
    return commands
  }, [runtime])

  const pluginPalette = useMemo<PluginPaletteProvider>(
    () => ({
      list: () =>
        runtime.pluginHost.listCommands().map((entry) => ({
          identity: entry.identity,
          commandId: entry.command.id,
          title: entry.command.title,
          category: entry.command.category
            ? `${entry.pluginName} · ${entry.command.category}`
            : entry.pluginName,
          inPalette: entry.command.menus.includes('commandPalette'),
        })),
      invoke: (identity, commandId) => {
        void runtime.commands.invoke(identity, commandId, 'palette')
      },
    }),
    [runtime],
  )

  const commands = useMemo(
    () => createExoCommandRegistry(getContext, handlers, getDynamicCommands, pluginPalette),
    [getContext, getDynamicCommands, handlers, pluginPalette],
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
      <ThemeSync onChange={(theme) => runtime.publishTheme(theme)} />
      <VSCodeWorkbench
        config={pluginWorkbench.config}
        views={pluginWorkbench.views}
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
      <CommandNotices />
      <SettingsDialog
        open={settingsOpen}
        section={settingsSection}
        onClose={() => setSettingsOpen(false)}
        onOpenFolder={openFolder}
        onConnectRemote={openConnect}
        onDisconnect={disconnectWorkspace}
        onRemoveRemote={removeRemoteWorkspace}
      />
      <ConnectRemoteDialog open={connectOpen} onClose={() => setConnectOpen(false)} />
      {openWith && (
        <OpenWithDialog
          path={openWith.path}
          candidates={openWith.candidates}
          currentIdentity={openWith.currentIdentity}
          onChoose={chooseEditor}
          onCancel={() => setOpenWith(null)}
        />
      )}
      {filePicker && (
        <FilePickerDialog
          key={`${filePicker.pluginId}:${filePicker.path}:${filePicker.directory ?? ''}:${filePicker.multiple}`}
          request={filePicker}
          onCancel={() => runtime.filePicker.cancel()}
          onSelect={(paths) => runtime.filePicker.select(paths)}
        />
      )}
      {newFile && (
        <NewFileDialog
          key={`${newFile.kind}:${newFile.identity}:${newFile.directory}:${newFile.name}`}
          request={newFile}
          onCancel={() => runtime.newFiles.cancel()}
          onSubmit={(directory, name) => void runtime.newFiles.submit(directory, name)}
        />
      )}
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
      <SecondaryViewPicker
        open={viewPickerOpen}
        views={secondaryViews}
        onChoose={(id) => {
          runtime.showPanel(id, 'secondary')
          setViewPickerOpen(false)
        }}
        onClose={() => setViewPickerOpen(false)}
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
