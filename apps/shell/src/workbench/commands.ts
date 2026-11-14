import {
  defaultCommands,
  useWorkbenchStore,
  type CommandListItem,
  type CommandRegistry,
  type WorkbenchCommand,
} from 'vscode-workbench'

// Generic kit commands that operate on the workbench itself and need no
// workspace. The kit's file commands are mocks and are deliberately excluded.
const WORKSPACE_FREE_DEFAULT_IDS = new Set([
  'view.commandPalette',
  'view.quickOpen',
  'view.togglePrimary',
  'view.toggleSecondary',
  'view.togglePanel',
  'view.togglePanelMaximized',
  'view.toggleActivityBar',
  'view.toggleStatusBar',
  'view.toggleTitleBar',
  'view.resetLayout',
])

export interface CommandContext {
  hasWorkspace: boolean
  writable: boolean
  hasSelection: boolean
  hasActiveDocument: boolean
}

export interface ExoCommandHandlers {
  openSettings: () => void
  openPluginSettings: () => void
  openFolder: () => void
  restoreAccess: () => void
  saveActive: () => void
  newFile: () => void
  newFolder: () => void
  rename: () => void
  delete: () => void
  refreshExplorer: () => void
}

export function createExoCommands(handlers: ExoCommandHandlers): WorkbenchCommand[] {
  return [
    ...defaultCommands.filter((command) => WORKSPACE_FREE_DEFAULT_IDS.has(command.id)),
    {
      id: 'exo.workspace.open',
      title: 'Open Folder…',
      category: 'File',
      keybinding: 'Ctrl+K Ctrl+O',
      run: handlers.openFolder,
    },
    {
      id: 'exo.workspace.restoreAccess',
      title: 'Restore Workspace Access',
      category: 'Workspace',
      run: handlers.restoreAccess,
    },
    {
      id: 'exo.explorer.newFile',
      title: 'New File',
      category: 'Explorer',
      run: handlers.newFile,
    },
    {
      id: 'exo.explorer.newFolder',
      title: 'New Folder',
      category: 'Explorer',
      run: handlers.newFolder,
    },
    {
      id: 'exo.explorer.rename',
      title: 'Rename…',
      category: 'Explorer',
      run: handlers.rename,
    },
    {
      id: 'exo.explorer.delete',
      title: 'Delete…',
      category: 'Explorer',
      run: handlers.delete,
    },
    {
      id: 'exo.explorer.refresh',
      title: 'Refresh Explorer',
      category: 'Explorer',
      run: handlers.refreshExplorer,
    },
    {
      id: 'exo.file.save',
      title: 'Save',
      category: 'File',
      keybinding: 'Ctrl+S',
      run: handlers.saveActive,
    },
    {
      id: 'exo.theme.toggle',
      title: 'Toggle Theme',
      category: 'Preferences',
      run: () => useWorkbenchStore.getState().toggleTheme(),
    },
    {
      id: 'exo.plugins.open',
      title: 'Open Plugin Configuration',
      category: 'Preferences',
      run: handlers.openPluginSettings,
    },
    {
      id: 'exo.settings.open',
      title: 'Open Settings',
      category: 'Preferences',
      run: handlers.openSettings,
    },
  ]
}

const AVAILABILITY: Record<string, (context: CommandContext) => boolean> = {
  'exo.workspace.restoreAccess': (context) => context.hasWorkspace && !context.writable,
  'exo.explorer.newFile': (context) => context.hasWorkspace && context.writable,
  'exo.explorer.newFolder': (context) => context.hasWorkspace && context.writable,
  'exo.explorer.rename': (context) =>
    context.hasWorkspace && context.writable && context.hasSelection,
  'exo.explorer.delete': (context) =>
    context.hasWorkspace && context.writable && context.hasSelection,
  'exo.explorer.refresh': (context) => context.hasWorkspace,
  'exo.file.save': (context) => context.hasActiveDocument,
}

/**
 * The palette renders every entry it is given as runnable, so applicability is
 * applied when listing rather than by disabling. `run` re-checks it so a stale
 * palette entry cannot start an invalid operation.
 */
export function createExoCommandRegistry(
  getContext: () => CommandContext,
  handlers: ExoCommandHandlers,
): CommandRegistry {
  const commands = createExoCommands(handlers)
  const isAvailable = (command: WorkbenchCommand, context: CommandContext) =>
    AVAILABILITY[command.id]?.(context) ?? true

  return {
    list(): CommandListItem[] {
      const context = getContext()
      return commands.filter((command) => isAvailable(command, context))
    },
    run(id: string): boolean {
      const command = commands.find((entry) => entry.id === id)
      if (!command) return false
      if (!isAvailable(command, getContext())) return false
      command.run()
      return true
    },
  }
}
