import {
  createCommandRegistry,
  defaultCommands,
  useWorkbenchStore,
  type CommandRegistry,
  type WorkbenchCommand,
} from 'vscode-workbench'

// Generic kit commands that operate on the workbench itself and need no
// workspace. File and tab commands are deliberately absent until a workspace
// provider and real documents exist.
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

export interface ExoCommandHandlers {
  openSettings: () => void
}

export function createExoCommands(handlers: ExoCommandHandlers): WorkbenchCommand[] {
  return [
    ...defaultCommands.filter((command) => WORKSPACE_FREE_DEFAULT_IDS.has(command.id)),
    {
      id: 'exo.theme.toggle',
      title: 'Toggle Theme',
      category: 'Preferences',
      run: () => useWorkbenchStore.getState().toggleTheme(),
    },
    {
      id: 'exo.settings.open',
      title: 'Open Settings',
      category: 'Preferences',
      run: handlers.openSettings,
    },
  ]
}

export function createExoCommandRegistry(handlers: ExoCommandHandlers): CommandRegistry {
  return createCommandRegistry(createExoCommands(handlers))
}
