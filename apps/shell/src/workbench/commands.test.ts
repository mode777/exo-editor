import { useWorkbenchStore } from 'vscode-workbench'
import { describe, expect, it, vi } from 'vitest'
import { createExoCommandRegistry, type CommandContext, type ExoCommandHandlers } from './commands'

const NO_WORKSPACE: CommandContext = {
  hasWorkspace: false,
  writable: false,
  hasSelection: false,
  hasActiveDocument: false,
  remote: false,
}

function setup(context: CommandContext = NO_WORKSPACE) {
  const handlers: ExoCommandHandlers = {
    openSettings: vi.fn(),
    openPluginSettings: vi.fn(),
    openWorkspaceSettings: vi.fn(),
    openFolder: vi.fn(),
    connectRemote: vi.fn(),
    disconnect: vi.fn(),
    restoreAccess: vi.fn(),
    saveActive: vi.fn(),
    newFile: vi.fn(),
    newFolder: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    refreshExplorer: vi.fn(),
  }
  return {
    handlers,
    registry: createExoCommandRegistry(() => context, handlers),
  }
}

describe('exo command registry', () => {
  it('exposes the workspace-free commands', () => {
    const { registry } = setup()
    const ids = registry.list().map((command) => command.id)

    expect(ids).toContain('exo.theme.toggle')
    expect(ids).toContain('exo.settings.open')
    expect(ids).toContain('view.togglePrimary')
    expect(ids).toContain('view.resetLayout')
  })

  it('offers Open Folder without a workspace', () => {
    const { registry } = setup()
    expect(registry.list().map((command) => command.id)).toContain('exo.workspace.open')
    expect(registry.run('exo.workspace.open')).toBe(true)
  })

  it('omits the kit mock file commands and workspace-only actions', () => {
    const { registry } = setup()
    const ids = registry.list().map((command) => command.id)

    for (const id of [
      'file.new',
      'file.open',
      'file.save',
      'file.saveAll',
      'file.close',
      'exo.explorer.newFile',
      'exo.explorer.newFolder',
      'exo.explorer.rename',
      'exo.explorer.delete',
      'exo.explorer.refresh',
      'exo.file.save',
      'exo.workspace.restoreAccess',
      'view.toggleTheme',
    ]) {
      expect(ids).not.toContain(id)
    }
  })

  it('offers explorer and save actions only when applicable', () => {
    const writable = setup({
      hasWorkspace: true,
      writable: true,
      hasSelection: false,
      hasActiveDocument: false,
      remote: false,
    })
    const ids = writable.registry.list().map((command) => command.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'exo.explorer.newFile',
        'exo.explorer.newFolder',
        'exo.explorer.refresh',
      ]),
    )
    expect(ids).not.toContain('exo.explorer.rename')
    expect(ids).not.toContain('exo.file.save')

    const withSelection = setup({
      hasWorkspace: true,
      writable: true,
      hasSelection: true,
      hasActiveDocument: true,
      remote: false,
    })
    const selectedIds = withSelection.registry.list().map((command) => command.id)
    expect(selectedIds).toEqual(
      expect.arrayContaining(['exo.explorer.rename', 'exo.explorer.delete', 'exo.file.save']),
    )
  })

  it('offers restore access only on a read-only workspace', () => {
    const readOnly = setup({
      hasWorkspace: true,
      writable: false,
      hasSelection: false,
      hasActiveDocument: false,
      remote: false,
    })
    expect(readOnly.registry.list().map((command) => command.id)).toContain(
      'exo.workspace.restoreAccess',
    )

    const writable = setup({
      hasWorkspace: true,
      writable: true,
      hasSelection: false,
      hasActiveDocument: false,
      remote: false,
    })
    expect(writable.registry.list().map((command) => command.id)).not.toContain(
      'exo.workspace.restoreAccess',
    )
  })

  it('re-checks applicability when run directly', () => {
    const { registry, handlers } = setup()
    expect(registry.run('exo.file.save')).toBe(false)
    expect(handlers.saveActive).not.toHaveBeenCalled()
  })

  it('opens the settings surface through its handler', () => {
    const { registry, handlers } = setup()

    expect(registry.run('exo.settings.open')).toBe(true)
    expect(handlers.openSettings).toHaveBeenCalledTimes(1)
  })

  it('opens plugin configuration without a workspace', () => {
    const { registry, handlers } = setup()

    expect(registry.list().map((command) => command.id)).toContain('exo.plugins.open')
    expect(registry.run('exo.plugins.open')).toBe(true)
    expect(handlers.openPluginSettings).toHaveBeenCalledTimes(1)
  })

  it('toggles the theme immediately', () => {
    const { registry } = setup()
    const initial = useWorkbenchStore.getState().theme

    registry.run('exo.theme.toggle')
    expect(useWorkbenchStore.getState().theme).not.toBe(initial)

    registry.run('exo.theme.toggle')
    expect(useWorkbenchStore.getState().theme).toBe(initial)
  })
})
