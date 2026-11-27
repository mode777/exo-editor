import type { WorkbenchConfig } from 'vscode-workbench'

// Exo's empty-shell composition: one real explorer region, no mocked regions.
// Secondary sidebar and bottom panel stay disabled until a layer gives them
// real content.
export const workbenchConfig: WorkbenchConfig = {
  titleBar: {
    enabled: true,
    menuBar: true,
    commandCenter: true,
    layoutControls: true,
    // A browser app has no window chrome to minimize, maximize or close.
    windowControls: false,
  },
  activityBar: {
    enabled: true,
    items: [
      { id: 'explorer', title: 'Explorer', icon: 'files' },
      { id: 'extensions', title: 'Extensions', icon: 'extensions' },
    ],
    bottomItems: [
      {
        id: 'settings',
        title: 'Settings',
        icon: 'gear',
        commandId: 'exo.settings.open',
      },
    ],
  },
  primarySideBar: {
    enabled: true,
    initialWidth: 300,
    minWidth: 200,
    maxWidth: 480,
    views: ['explorer', 'extensions'],
  },
  secondarySideBar: {
    enabled: false,
    initialWidth: 330,
    minWidth: 240,
    maxWidth: 480,
    views: [],
  },
  bottomPanel: {
    enabled: false,
    initialHeight: 230,
    minHeight: 120,
    maxHeight: 600,
    views: [],
  },
  statusBar: {
    enabled: true,
  },
}
