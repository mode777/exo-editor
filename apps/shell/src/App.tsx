import { useCallback, useMemo, useState } from 'react'
import {
  VSCodeWorkbench,
  type FileIconResolver,
  type InitialWorkbenchSession,
  type WorkbenchTab,
} from 'vscode-workbench'
import { SettingsDialog } from './settings/SettingsDialog'
import { ThemeSync } from './theme-sync'
import { createExoCommandRegistry } from './workbench/commands'
import { workbenchConfig } from './workbench/config'
import { workbenchMenus } from './workbench/menus'
import { createQuickOpenProvider } from './workbench/quick-open'
import { ExoStatusBar } from './workbench/status-bar'
import { workbenchViews } from './workbench/views'

// No first-run tabs: layer 1 has no workspace and no documents. Passing an
// explicit empty session keeps the preset from inventing one.
const EMPTY_SESSION: InitialWorkbenchSession = {
  tabs: [],
  activeTabId: null,
  outputLines: [],
}

const FILE_ICONS: FileIconResolver = { icon: () => 'file' }

function renderDocument(tab: WorkbenchTab) {
  return <div className="exo-document-placeholder">No editor is available for {tab.title}.</div>
}

function EmptyEditor() {
  return (
    <div className="exo-empty-editor">
      <h2>No editors are open</h2>
      <p>Open a folder to browse files. Workspace access arrives in the next layer.</p>
    </div>
  )
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const commands = useMemo(() => createExoCommandRegistry({ openSettings }), [openSettings])
  const quickOpen = useMemo(createQuickOpenProvider, [])

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
      <SettingsDialog open={settingsOpen} onClose={closeSettings} />
    </>
  )
}
