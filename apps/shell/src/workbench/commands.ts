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
  /** More than one registered editor matches the active document. */
  hasEditorChoice: boolean
  /** The active workspace is a remote connection. */
  remote: boolean
  /** Number of active secondary panels; the picker needs more than one. */
  secondaryViewCount: number
}

/** One active plugin command as the palette lists it; ids stay shell-owned. */
export interface PluginPaletteEntry {
  identity: string
  commandId: string
  title: string
  category: string
  inPalette: boolean
}

export interface PluginPaletteProvider {
  list(): PluginPaletteEntry[]
  invoke(identity: string, commandId: string): void
}

export interface ExoCommandHandlers {
  openSettings: () => void
  openPluginSettings: () => void
  openWorkspaceSettings: () => void
  focusExtensions: () => void
  refreshMarketplace: () => void
  openFolder: () => void
  connectRemote: () => void
  disconnect: () => void
  restoreAccess: () => void
  saveActive: () => void
  openWith: () => void
  newFile: () => void
  newFolder: () => void
  rename: () => void
  delete: () => void
  refreshExplorer: () => void
  collapseExplorer: () => void
  selectSecondaryView: () => void
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
      id: 'exo.workspace.connectRemote',
      title: 'Connect Remote Workspace…',
      category: 'File',
      run: handlers.connectRemote,
    },
    {
      id: 'exo.workspace.disconnect',
      title: 'Disconnect Workspace',
      category: 'Workspace',
      run: handlers.disconnect,
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
      id: 'exo.explorer.collapseAll',
      title: 'Collapse Folders in Explorer',
      category: 'Explorer',
      run: handlers.collapseExplorer,
    },
    {
      id: 'exo.views.selectSecondary',
      title: 'Select Secondary View…',
      category: 'View',
      run: handlers.selectSecondaryView,
    },
    {
      id: 'exo.file.save',
      title: 'Save',
      category: 'File',
      keybinding: 'Ctrl+S',
      run: handlers.saveActive,
    },
    {
      id: 'exo.file.openWith',
      title: 'Open With…',
      category: 'File',
      run: handlers.openWith,
    },
    {
      id: 'exo.theme.toggle',
      title: 'Toggle Theme',
      category: 'Preferences',
      run: () => useWorkbenchStore.getState().toggleTheme(),
    },
    {
      id: 'exo.extensions.focus',
      title: 'Focus Extensions View',
      category: 'View',
      keybinding: 'Ctrl+Shift+X',
      run: handlers.focusExtensions,
    },
    {
      id: 'exo.extensions.refresh',
      title: 'Refresh Marketplace',
      category: 'Extensions',
      run: handlers.refreshMarketplace,
    },
    {
      id: 'exo.plugins.open',
      title: 'Open Plugin Debugging',
      category: 'Preferences',
      run: handlers.openPluginSettings,
    },
    {
      id: 'exo.settings.open',
      title: 'Open Settings',
      category: 'Preferences',
      run: handlers.openSettings,
    },
    {
      id: 'exo.settings.workspace',
      title: 'Open Workspace Settings',
      category: 'Preferences',
      run: handlers.openWorkspaceSettings,
    },
  ]
}

const AVAILABILITY: Record<string, (context: CommandContext) => boolean> = {
  'exo.workspace.restoreAccess': (context) => context.hasWorkspace && !context.writable,
  'exo.workspace.disconnect': (context) => context.hasWorkspace && context.remote,
  'exo.explorer.newFile': (context) => context.hasWorkspace && context.writable,
  'exo.explorer.newFolder': (context) => context.hasWorkspace && context.writable,
  'exo.explorer.rename': (context) =>
    context.hasWorkspace && context.writable && context.hasSelection,
  'exo.explorer.delete': (context) =>
    context.hasWorkspace && context.writable && context.hasSelection,
  'exo.explorer.refresh': (context) => context.hasWorkspace,
  'exo.explorer.collapseAll': (context) => context.hasWorkspace,
  'exo.views.selectSecondary': (context) => context.secondaryViewCount > 1,
  'exo.file.save': (context) => context.hasActiveDocument,
  'exo.file.openWith': (context) => context.hasActiveDocument && context.hasEditorChoice,
}

/**
 * A shell-owned, collision-free palette id. The plugin id is encoded, so even a
 * plugin command named `exo.settings.open` cannot replace the shell entry.
 */
export function pluginCommandPaletteId(identity: string, commandId: string): string {
  return `exo.plugin.${encodeURIComponent(identity)}.${encodeURIComponent(commandId)}`
}

/**
 * The palette renders every entry it is given as runnable, so applicability is
 * applied when listing rather than by disabling. `run` re-checks it so a stale
 * palette entry cannot start an invalid operation.
 */
export function createExoCommandRegistry(
  getContext: () => CommandContext,
  handlers: ExoCommandHandlers,
  getDynamicCommands: () => WorkbenchCommand[] = () => [],
  pluginCommands?: PluginPaletteProvider,
): CommandRegistry {
  const commands = createExoCommands(handlers)
  const knownPluginIds = new Map<string, { identity: string; commandId: string }>()
  const pluginCommandList = (): WorkbenchCommand[] => {
    if (!pluginCommands) return []
    const entries: WorkbenchCommand[] = []
    for (const entry of pluginCommands.list()) {
      const id = pluginCommandPaletteId(entry.identity, entry.commandId)
      knownPluginIds.set(id, { identity: entry.identity, commandId: entry.commandId })
      if (!entry.inPalette) continue
      entries.push({
        id,
        title: entry.title,
        category: entry.category,
        run: () => pluginCommands.invoke(entry.identity, entry.commandId),
      })
    }
    return entries
  }
  const all = () => [...commands, ...getDynamicCommands(), ...pluginCommandList()]
  const isAvailable = (command: WorkbenchCommand, context: CommandContext) =>
    AVAILABILITY[command.id]?.(context) ?? true

  return {
    list(): CommandListItem[] {
      const context = getContext()
      return all().filter((command) => isAvailable(command, context))
    },
    run(id: string): boolean {
      const command = all().find((entry) => entry.id === id)
      if (command) {
        if (!isAvailable(command, getContext())) return false
        command.run()
        return true
      }
      const known = knownPluginIds.get(id)
      if (known && pluginCommands) {
        pluginCommands.invoke(known.identity, known.commandId)
        return true
      }
      return false
    },
  }
}
