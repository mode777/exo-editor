import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from 'vscode-workbench'
import {
  PERSIST_KEY,
  activeDocumentPath,
  clearWorkspaceTabs,
  closeContentTabsFor,
  configurePresetStore,
  contentViewOf,
  installCloseGuard,
  isCloseGuardInstalled,
  openContentViewTab,
  openFileTab,
  openShellViewTab,
  removeTabsUnder,
  setTabDirty,
  shellViewOf,
  type CloseRequest,
} from './tabs'

async function loadFresh() {
  vi.resetModules()
  const kit = await import('vscode-workbench')
  const tabs = await import('./tabs')
  return { kit, tabs }
}

describe('preset store tab persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkbenchStore.persist.clearStorage()
  })

  it('persists layout and theme but not workspace tabs', () => {
    configurePresetStore()
    openFileTab('/notes.txt')
    setTabDirty('/notes.txt', true)
    useWorkbenchStore.getState().setTheme('light')
    useWorkbenchStore.getState().setPrimarySideBarWidth(420)

    const raw = localStorage.getItem(PERSIST_KEY)
    expect(raw).toBeTruthy()
    const envelope = JSON.parse(raw as string) as {
      state: Record<string, unknown>
    }

    expect(envelope.state.theme).toBe('light')
    expect(envelope.state.primarySideBarWidth).toBe(420)
    expect(envelope.state.tabs).toBeUndefined()
    expect(envelope.state.activeTabId).toBeUndefined()
    expect(envelope.state.closedTabs).toBeUndefined()
  })

  it('restores layout and theme on reload but starts with no tabs', async () => {
    const first = await loadFresh()
    first.tabs.configurePresetStore()
    first.tabs.openFileTab('/notes.txt')
    first.kit.useWorkbenchStore.getState().setTheme('light')
    first.kit.useWorkbenchStore.getState().setPrimarySideBarWidth(420)
    first.kit.useWorkbenchStore.getState().closeTab('/notes.txt')

    const second = await loadFresh()
    second.tabs.configurePresetStore()
    const state = second.kit.useWorkbenchStore.getState()

    expect(state.theme).toBe('light')
    expect(state.primarySideBarWidth).toBe(420)
    expect(state.tabs).toEqual([])
    expect(state.activeTabId).toBeNull()
    expect(state.closedTabs).toEqual([])
  })

  it('clears tabs and reopen history on a workspace switch', () => {
    configurePresetStore()
    openFileTab('/a.txt')
    openFileTab('/b.txt')
    useWorkbenchStore.getState().closeTab('/b.txt')
    expect(useWorkbenchStore.getState().closedTabs).toHaveLength(1)

    clearWorkspaceTabs()

    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(useWorkbenchStore.getState().activeTabId).toBeNull()
    expect(useWorkbenchStore.getState().closedTabs).toEqual([])
  })
})

describe('dirty close guard', () => {
  let uninstall: (() => void) | null = null

  beforeEach(() => {
    localStorage.clear()
    uninstall?.()
    uninstall = null
    configurePresetStore()
    clearWorkspaceTabs()
  })

  it('pauses a dirty close until proceed and then closes the tab', () => {
    openFileTab('/a.txt')
    setTabDirty('/a.txt', true)
    const requests: CloseRequest[] = []
    const closed: string[] = []
    let proceed: (() => void) | null = null
    uninstall = installCloseGuard(
      (request, resume) => {
        requests.push(request)
        proceed = resume
      },
      { onClosed: (tabs) => closed.push(...tabs.map((tab) => tab.id)) },
    )

    useWorkbenchStore.getState().closeTab('/a.txt')

    expect(requests).toHaveLength(1)
    expect(requests[0].reason).toBe('close')
    expect(useWorkbenchStore.getState().tabs.map((tab) => tab.id)).toEqual(['/a.txt'])

    ;(proceed as unknown as () => void)()

    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(closed).toEqual(['/a.txt'])
  })

  it('keeps the tab when the close is cancelled', () => {
    openFileTab('/a.txt')
    setTabDirty('/a.txt', true)
    let cancelled = false
    uninstall = installCloseGuard(() => {
      cancelled = true
    })

    useWorkbenchStore.getState().closeTab('/a.txt')

    expect(cancelled).toBe(true)
    expect(useWorkbenchStore.getState().tabs).toHaveLength(1)
  })

  it('closes a clean tab immediately without prompting', () => {
    openFileTab('/clean.txt')
    let prompted = false
    const closed: string[] = []
    uninstall = installCloseGuard(
      () => {
        prompted = true
      },
      { onClosed: (tabs) => closed.push(...tabs.map((tab) => tab.id)) },
    )

    useWorkbenchStore.getState().closeTab('/clean.txt')

    expect(prompted).toBe(false)
    expect(useWorkbenchStore.getState().tabs).toEqual([])
    expect(closed).toEqual(['/clean.txt'])
  })

  it('prompts for every dirty tab in close-all', () => {
    openFileTab('/a.txt')
    openFileTab('/b.txt')
    setTabDirty('/a.txt', true)
    setTabDirty('/b.txt', true)
    const requests: CloseRequest[] = []
    let proceed: (() => void) | null = null
    uninstall = installCloseGuard((request, resume) => {
      requests.push(request)
      proceed = resume
    })

    useWorkbenchStore.getState().closeAllTabs()

    expect(requests).toHaveLength(1)
    expect(requests[0].tabs.map((tab) => tab.id)).toEqual(['/a.txt', '/b.txt'])
    ;(proceed as unknown as () => void)()
    expect(useWorkbenchStore.getState().tabs).toEqual([])
  })

  it('prompts only for dirty tabs when closing others', () => {
    openFileTab('/keep.txt')
    openFileTab('/dirty.txt')
    openFileTab('/clean.txt')
    setTabDirty('/dirty.txt', true)
    const requests: CloseRequest[] = []
    uninstall = installCloseGuard((request) => {
      requests.push(request)
    })

    useWorkbenchStore.getState().closeOtherTabs('/keep.txt')

    expect(requests[0].tabs.map((tab) => tab.id)).toEqual(['/dirty.txt'])
  })

  it('closes a dirty tab silently when the guard is removed', () => {
    openFileTab('/a.txt')
    setTabDirty('/a.txt', true)
    uninstall = installCloseGuard(() => undefined)
    expect(isCloseGuardInstalled()).toBe(true)
    uninstall()
    uninstall = null
    expect(isCloseGuardInstalled()).toBe(false)

    useWorkbenchStore.getState().closeTab('/a.txt')

    expect(useWorkbenchStore.getState().tabs).toEqual([])
  })
})

describe('shell-owned extension details tabs', () => {
  beforeEach(() => {
    localStorage.clear()
    configurePresetStore()
    clearWorkspaceTabs()
  })

  it('opens and focuses one details tab per manifest URL', () => {
    clearWorkspaceTabs()
    const manifest = 'https://plugins.example.com/exo-manifest.json'
    openShellViewTab(manifest, 'Example')
    openShellViewTab(manifest, 'Example')
    const state = useWorkbenchStore.getState()
    expect(state.tabs).toHaveLength(1)
    const tab = state.tabs[0]
    if (!tab) throw new Error('Details tab missing')
    expect(shellViewOf(tab)).toEqual({ kind: 'extension', manifestUrl: manifest })
    expect(tab.path).toBeUndefined()
    expect(tab.dirty).toBeFalsy()
    expect(activeDocumentPath()).toBeNull()
  })

  it('clears the details tab with the workspace', () => {
    openShellViewTab('https://plugins.example.com/exo-manifest.json')
    clearWorkspaceTabs()
    expect(useWorkbenchStore.getState().tabs).toEqual([])
  })
})

describe('content view tabs', () => {
  beforeEach(() => {
    clearWorkspaceTabs()
  })

  const info = {
    key: 'content:https%3A%2F%2Fplugins.example.com::com.example.other:tutorial:k1',
    title: 'Tutorial',
    pluginName: 'Other Plugin',
    identity: 'https://plugins.example.com::com.example.other',
    pluginId: 'com.example.other',
    viewId: 'tutorial',
    instanceKey: 'k1',
  }

  it('opens a shell-owned read-only tab with no path', () => {
    openContentViewTab(info)
    const tab = useWorkbenchStore.getState().tabs[0]
    expect(tab).toMatchObject({
      id: info.key,
      title: 'Tutorial — Other Plugin',
      kind: 'content',
    })
    expect(tab?.path).toBeUndefined()
    expect(contentViewOf(tab!)).toEqual(info)
    expect(activeDocumentPath()).toBeNull()
  })

  it('keeps content tabs out of path operations', () => {
    openContentViewTab(info)
    openFileTab('/notes.txt')
    removeTabsUnder('/')
    expect(useWorkbenchStore.getState().tabs.map((tab) => tab.id)).toEqual([info.key])
  })

  it('closes only the removed plugin content tabs and picks a fallback tab', () => {
    openContentViewTab(info)
    openContentViewTab({ ...info, key: 'content:other:tutorial:k2', instanceKey: 'k2' })
    openFileTab('/notes.txt')
    const fileTab = useWorkbenchStore.getState().tabs.at(-1)
    useWorkbenchStore.getState().activateTab(info.key)
    closeContentTabsFor(info.identity)
    const state = useWorkbenchStore.getState()
    expect(state.tabs.map((tab) => tab.id)).toEqual([fileTab?.id])
    expect(state.activeTabId).toBe(fileTab?.id)
  })
})
