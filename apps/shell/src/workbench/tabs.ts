import { useWorkbenchStore, type WorkbenchTab } from 'vscode-workbench'
import { basename, pathIsUnder } from '../workspace/paths'
import type { WorkspacePath } from '../workspace/contract'

const PERSIST_KEY = 'desktop-ui-template:v1'
let configured = false

type StoreState = ReturnType<typeof useWorkbenchStore.getState>
type PersistOptions = Parameters<typeof useWorkbenchStore.persist.setOptions>[0]
type Partialize = NonNullable<PersistOptions['partialize']>

/**
 * The preset persists layout, theme and tabs together. Tabs are workspace
 * scoped, so persisting them would make a tab from folder A reappear over
 * folder B after a reload. The adapter keeps the global fields and drops the
 * workspace-scoped ones; omitted fields hydrate to their defaults.
 */
export function configurePresetStore(): void {
  if (configured) return
  configured = true

  const partialize = ((state: StoreState) => ({
    theme: state.theme,
    primarySideBarVisible: state.primarySideBarVisible,
    secondarySideBarVisible: state.secondarySideBarVisible,
    bottomPanelVisible: state.bottomPanelVisible,
    activityBarVisible: state.activityBarVisible,
    statusBarVisible: state.statusBarVisible,
    titleBarVisible: state.titleBarVisible,
    panelMaximized: state.panelMaximized,
    primarySideBarWidth: state.primarySideBarWidth,
    secondarySideBarWidth: state.secondarySideBarWidth,
    bottomPanelHeight: state.bottomPanelHeight,
    activePrimaryView: state.activePrimaryView,
    activeSecondaryView: state.activeSecondaryView,
    activePanelView: state.activePanelView,
  })) as unknown as Partialize

  useWorkbenchStore.persist.setOptions({ partialize })
  clearWorkspaceTabs()
}

/** Drop every workspace-scoped tab field, including the reopen history. */
export function clearWorkspaceTabs(): void {
  useWorkbenchStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabs: [],
  })
}

export function openFileTab(path: WorkspacePath, title = basename(path)): void {
  const tab: WorkbenchTab = {
    id: path,
    title,
    kind: 'file',
    path,
  }
  useWorkbenchStore.getState().openTab(tab)
}

export function activateFileTab(path: WorkspacePath): void {
  useWorkbenchStore.getState().activateTab(path)
}

export function setTabDirty(path: WorkspacePath, dirty: boolean): void {
  useWorkbenchStore.setState((state) => ({
    tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, dirty } : tab)),
  }))
}

export function updateTabPath(previousPath: WorkspacePath, nextPath: WorkspacePath): void {
  useWorkbenchStore.setState((state) => {
    const tabs = state.tabs.map((tab) =>
      tab.path === previousPath
        ? {
            ...tab,
            id: nextPath,
            path: nextPath,
            title: basename(nextPath),
          }
        : tab,
    )
    const activeTabId = state.activeTabId === previousPath ? nextPath : state.activeTabId
    return { tabs, activeTabId }
  })
}

/** Remove tabs for a deleted path or directory without a close prompt. */
export function removeTabsUnder(path: WorkspacePath): void {
  useWorkbenchStore.setState((state) => {
    const tabs = state.tabs.filter((tab) => !(tab.path && pathIsUnder(tab.path, path)))
    const activeExists = tabs.some((tab) => tab.id === state.activeTabId)
    return {
      tabs,
      activeTabId: activeExists ? state.activeTabId : (tabs.at(-1)?.id ?? null),
    }
  })
}

export function activeDocumentPath(): WorkspacePath | null {
  const state = useWorkbenchStore.getState()
  const tab = state.tabs.find((entry) => entry.id === state.activeTabId)
  return tab?.path ?? null
}

export function tabByPath(path: WorkspacePath): WorkbenchTab | undefined {
  return useWorkbenchStore.getState().tabs.find((tab) => tab.path === path)
}

export type CloseReason = 'close' | 'close-others' | 'close-all'

export interface CloseRequest {
  reason: CloseReason
  tabs: WorkbenchTab[]
}

export type CloseGuardHandler = (request: CloseRequest, proceed: () => void) => void

export interface CloseGuardOptions {
  onClosed?: (tabs: WorkbenchTab[]) => void
}

let guardInstalled = false
let originalActions: Pick<StoreState, 'closeTab' | 'closeOtherTabs' | 'closeAllTabs'> | null = null

/**
 * The kit's tab strip closes a tab unconditionally and has no close hook in
 * 0.1.3. Wrapping the public store actions is the only way to protect dirty
 * documents without forking the preset. Clean closes proceed immediately;
 * dirty closes pause until the handler calls `proceed`.
 */
export function installCloseGuard(
  handler: CloseGuardHandler,
  options: CloseGuardOptions = {},
): () => void {
  if (guardInstalled) {
    throw new Error('A close guard is already installed.')
  }
  const state = useWorkbenchStore.getState()
  originalActions = {
    closeTab: state.closeTab,
    closeOtherTabs: state.closeOtherTabs,
    closeAllTabs: state.closeAllTabs,
  }
  guardInstalled = true
  const originals = originalActions

  const finish = (tabs: WorkbenchTab[]) => {
    options.onClosed?.(tabs)
  }

  const guard = (reason: CloseReason, tabs: WorkbenchTab[], proceed: () => void) => {
    const dirty = tabs.filter((tab) => tab.dirty)
    if (dirty.length === 0) {
      proceed()
      finish(tabs)
      return
    }
    handler({ reason, tabs: dirty }, () => {
      proceed()
      finish(tabs)
    })
  }

  useWorkbenchStore.setState({
    closeTab: (id) => {
      const current = useWorkbenchStore.getState()
      const tab = current.tabs.find((entry) => entry.id === id)
      if (!tab) {
        originals.closeTab(id)
        return
      }
      guard('close', [tab], () => originals.closeTab(id))
    },
    closeOtherTabs: (id) => {
      const current = useWorkbenchStore.getState()
      const tabs = current.tabs.filter((entry) => entry.id !== id)
      guard('close-others', tabs, () => originals.closeOtherTabs(id))
    },
    closeAllTabs: () => {
      const current = useWorkbenchStore.getState()
      guard('close-all', current.tabs, () => originals.closeAllTabs())
    },
  })

  return () => {
    if (!guardInstalled || !originalActions) return
    useWorkbenchStore.setState({ ...originalActions })
    guardInstalled = false
    originalActions = null
  }
}

export function isCloseGuardInstalled(): boolean {
  return guardInstalled
}

export { PERSIST_KEY }
