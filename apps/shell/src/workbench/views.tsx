import type { WorkbenchViewRegistry } from 'vscode-workbench'
import { ExplorerView } from '../explorer/ExplorerView'
import { ExtensionsView } from '../extensions/ExtensionsView'

// The explorer and extensions views are Exo-owned: the explorer renders the
// current workspace session's tree and never the upstream mock tree.
export const workbenchViews: WorkbenchViewRegistry = {
  primary: {
    explorer: {
      id: 'explorer',
      title: 'Explorer',
      icon: 'files',
      component: ExplorerView,
    },
    extensions: {
      id: 'extensions',
      title: 'Extensions',
      icon: 'extensions',
      component: ExtensionsView,
      actions: [
        {
          icon: 'refresh',
          label: 'Refresh Marketplace',
          commandId: 'exo.extensions.refresh',
        },
      ],
    },
  },
  secondary: {},
  panel: {},
}
