import type { MenuDefinition } from 'vscode-workbench'

// Menu entries are stable; the registry filters applicability in the palette and
// `run` re-checks it, so an unavailable entry is a no-op rather than a fake.
export const workbenchMenus: MenuDefinition[] = [
  {
    id: 'file',
    label: 'File',
    entries: [
      { label: 'Open Folder…', commandId: 'exo.workspace.open' },
      { label: 'Connect Remote Workspace…', commandId: 'exo.workspace.connectRemote' },
      { separator: true },
      { label: 'New File…', commandId: 'exo.explorer.newFile' },
      { label: 'New Folder…', commandId: 'exo.explorer.newFolder' },
      { separator: true },
      {
        label: 'Save',
        commandId: 'exo.file.save',
        keybinding: 'Ctrl+S',
      },
      { label: 'Open With…', commandId: 'exo.file.openWith' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    entries: [
      { label: 'Command Palette…', commandId: 'view.commandPalette' },
      { label: 'Go to File…', commandId: 'view.quickOpen' },
      { separator: true },
      {
        label: 'Refresh Explorer',
        commandId: 'exo.explorer.refresh',
      },
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
      { label: 'Open Plugin Configuration', commandId: 'exo.plugins.open' },
      { label: 'Toggle Theme', commandId: 'exo.theme.toggle' },
    ],
  },
]
