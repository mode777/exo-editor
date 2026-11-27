import { describe, expect, it, vi } from 'vitest'
import { createExoCommands, type ExoCommandHandlers } from './commands'
import { workbenchMenus } from './menus'

function createHandlers(): ExoCommandHandlers {
  return {
    openSettings: vi.fn(),
    openPluginSettings: vi.fn(),
    openWorkspaceSettings: vi.fn(),
    focusExtensions: vi.fn(),
    refreshMarketplace: vi.fn(),
    openFolder: vi.fn(),
    connectRemote: vi.fn(),
    disconnect: vi.fn(),
    restoreAccess: vi.fn(),
    saveActive: vi.fn(),
    openWith: vi.fn(),
    newFile: vi.fn(),
    newFolder: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    refreshExplorer: vi.fn(),
    collapseExplorer: vi.fn(),
    selectSecondaryView: vi.fn(),
  }
}

function fileMenu() {
  const menu = workbenchMenus.find((entry) => entry.id === 'file')
  if (!menu) throw new Error('File menu is missing')
  return menu
}

describe('workbench menus', () => {
  it('offers Connect Remote Workspace directly after Open Folder', () => {
    const entries = fileMenu().entries
    const openIndex = entries.findIndex((entry) => entry.commandId === 'exo.workspace.open')

    expect(openIndex).toBeGreaterThanOrEqual(0)
    expect(entries[openIndex + 1]).toEqual({
      label: 'Connect Remote Workspace…',
      commandId: 'exo.workspace.connectRemote',
    })
  })

  it('offers Extensions and plugin debugging', () => {
    const view = workbenchMenus.find((entry) => entry.id === 'view')
    const preferences = workbenchMenus.find((entry) => entry.id === 'preferences')
    expect(view?.entries.find((entry) => entry.commandId === 'exo.extensions.focus')).toMatchObject(
      {
        label: 'Extensions',
        keybinding: 'Ctrl+Shift+X',
      },
    )
    expect(
      preferences?.entries.find((entry) => entry.commandId === 'exo.plugins.open')?.label,
    ).toBe('Open Plugin Debugging')
  })

  it('references only commands the shell creates', () => {
    const commandIds = new Set(createExoCommands(createHandlers()).map((command) => command.id))

    for (const menu of workbenchMenus) {
      for (const entry of menu.entries) {
        if (!entry.commandId) continue
        expect(
          commandIds.has(entry.commandId),
          `${menu.label} > ${entry.label ?? entry.commandId} -> ${entry.commandId}`,
        ).toBe(true)
      }
    }
  })
})
