import type { MenuDefinition } from 'vscode-workbench'

// Menus only reference commands that exist in the workspace-free registry.
export const workbenchMenus: MenuDefinition[] = [
  {
    id: 'view',
    label: 'View',
    entries: [
      { label: 'Command Palette…', commandId: 'view.commandPalette' },
      { separator: true },
      {
        label: 'Toggle Primary Side Bar',
        commandId: 'view.togglePrimary',
        keybinding: 'Ctrl+B',
      },
      {
        label: 'Toggle Panel',
        commandId: 'view.togglePanel',
        keybinding: 'Ctrl+J',
      },
      { separator: true },
      { label: 'Toggle Activity Bar', commandId: 'view.toggleActivityBar' },
      { label: 'Toggle Status Bar', commandId: 'view.toggleStatusBar' },
      { separator: true },
      { label: 'Reset Layout', commandId: 'view.resetLayout' },
    ],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    entries: [
      { label: 'Open Settings', commandId: 'exo.settings.open' },
      { label: 'Toggle Theme', commandId: 'exo.theme.toggle' },
    ],
  },
]
