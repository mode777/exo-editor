import { useWorkbenchStore } from 'vscode-workbench'
import { describe, expect, it, vi } from 'vitest'
import { createExoCommandRegistry, type CommandContext, type ExoCommandHandlers } from './commands'

const NO_WORKSPACE: CommandContext = {
  hasWorkspace: false,
  writable: false,
  hasSelection: false,
  hasActiveDocument: false,
  hasEditorChoice: false,
  remote: false,
  secondaryViewCount: 0,
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
    openWith: vi.fn(),
    newFile: vi.fn(),
    newFolder: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    refreshExplorer: vi.fn(),
    collapseExplorer: vi.fn(),
    selectSecondaryView: vi.fn(),
  }
  return {
    handlers,
    registry: createExoCommandRegistry(() => context, handlers),
  }
}

describe('exo command registry', () => {
  it('lists and runs dynamic plugin view commands', () => {
    const run = vi.fn()
    const { handlers } = setup()
    const registry = createExoCommandRegistry(
      () => NO_WORKSPACE,
      handlers,
      () => [
        {
          id: 'exo.views.show.plugin:viewer:outline',
          title: 'Show Outline',
          category: 'Views · Viewer',
          run,
        },
      ],
    )
    expect(registry.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'exo.views.show.plugin:viewer:outline',
          title: 'Show Outline',
          category: 'Views · Viewer',
        }),
      ]),
    )
    expect(registry.run('exo.views.show.plugin:viewer:outline')).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('lists plugin commands under a synthetic id and plugin-attributed category', () => {
    const invoke = vi.fn()
    const { handlers } = setup()
    const registry = createExoCommandRegistry(
      () => NO_WORKSPACE,
      handlers,
      () => [],
      {
        list: () => [
          {
            identity: 'https://plugins.example.com::com.example.test',
            commandId: 'format',
            title: 'Format Document',
            category: 'Example Plugin · Editing',
            inPalette: true,
          },
          {
            identity: 'https://plugins.example.com::com.example.test',
            commandId: 'explorer-only',
            title: 'Explorer Only',
            category: 'Example Plugin',
            inPalette: false,
          },
        ],
        invoke,
      },
    )
    const listed = registry.list().filter((command) => command.id.startsWith('exo.plugin.'))
    expect(listed).toEqual([
      expect.objectContaining({
        id: 'exo.plugin.https%3A%2F%2Fplugins.example.com%3A%3Acom.example.test.format',
        title: 'Format Document',
        category: 'Example Plugin · Editing',
      }),
    ])
    expect(registry.run(listed[0]?.id ?? '')).toBe(true)
    expect(invoke).toHaveBeenCalledWith('https://plugins.example.com::com.example.test', 'format')
  })

  it('keeps a shell command and a same-named plugin command separate', () => {
    const invoke = vi.fn()
    const { handlers } = setup()
    const registry = createExoCommandRegistry(
      () => NO_WORKSPACE,
      handlers,
      () => [],
      {
        list: () => [
          {
            identity: 'https://plugins.example.com::com.example.test',
            commandId: 'exo.settings.open',
            title: 'Open Settings',
            category: 'Example Plugin',
            inPalette: true,
          },
        ],
        invoke,
      },
    )
    const ids = registry.list().map((command) => command.id)
    expect(ids).toContain('exo.settings.open')
    expect(ids).toContain(
      'exo.plugin.https%3A%2F%2Fplugins.example.com%3A%3Acom.example.test.exo.settings.open',
    )
    expect(registry.run('exo.settings.open')).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('records a stale palette invocation instead of silently dropping it', () => {
    const invoke = vi.fn()
    const { handlers } = setup()
    const registry = createExoCommandRegistry(
      () => NO_WORKSPACE,
      handlers,
      () => [],
      {
        list: () => [
          {
            identity: 'https://plugins.example.com::com.example.test',
            commandId: 'format',
            title: 'Format Document',
            category: 'Example Plugin',
            inPalette: true,
          },
        ],
        invoke,
      },
    )
    const id = registry.list().find((command) => command.id.startsWith('exo.plugin.'))?.id ?? ''
    expect(registry.run(id)).toBe(true)
    // A later list without the command still routes the known id to the controller,
    // which records the stale invocation in the plugin log.
    expect(registry.run(id)).toBe(true)
    expect(invoke).toHaveBeenCalledTimes(2)
  })

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
      'exo.explorer.collapseAll',
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
      hasEditorChoice: false,
      remote: false,
      secondaryViewCount: 0,
    })
    const ids = writable.registry.list().map((command) => command.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'exo.explorer.newFile',
        'exo.explorer.newFolder',
        'exo.explorer.refresh',
        'exo.explorer.collapseAll',
      ]),
    )
    expect(ids).not.toContain('exo.explorer.rename')
    expect(ids).not.toContain('exo.file.save')

    const withSelection = setup({
      hasWorkspace: true,
      writable: true,
      hasSelection: true,
      hasActiveDocument: true,
      hasEditorChoice: false,
      remote: false,
      secondaryViewCount: 0,
    })
    const selectedIds = withSelection.registry.list().map((command) => command.id)
    expect(selectedIds).toEqual(
      expect.arrayContaining(['exo.explorer.rename', 'exo.explorer.delete', 'exo.file.save']),
    )
  })

  it('runs collapse folders only with a workspace', () => {
    const withoutWorkspace = setup()
    expect(withoutWorkspace.registry.run('exo.explorer.collapseAll')).toBe(false)
    expect(withoutWorkspace.handlers.collapseExplorer).not.toHaveBeenCalled()

    const workspace = setup({
      hasWorkspace: true,
      writable: true,
      hasSelection: false,
      hasActiveDocument: false,
      hasEditorChoice: false,
      remote: false,
      secondaryViewCount: 0,
    })
    expect(workspace.registry.run('exo.explorer.collapseAll')).toBe(true)
    expect(workspace.handlers.collapseExplorer).toHaveBeenCalledTimes(1)
  })

  it('offers restore access only on a read-only workspace', () => {
    const readOnly = setup({
      hasWorkspace: true,
      writable: false,
      hasSelection: false,
      hasActiveDocument: false,
      hasEditorChoice: false,
      remote: false,
      secondaryViewCount: 0,
    })
    expect(readOnly.registry.list().map((command) => command.id)).toContain(
      'exo.workspace.restoreAccess',
    )

    const writable = setup({
      hasWorkspace: true,
      writable: true,
      hasSelection: false,
      hasActiveDocument: false,
      hasEditorChoice: false,
      remote: false,
      secondaryViewCount: 0,
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
