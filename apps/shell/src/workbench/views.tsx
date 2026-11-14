import type { WorkbenchViewRegistry } from 'vscode-workbench'
import { ExplorerView } from '../explorer/ExplorerView'

// The explorer is Exo-owned: it renders the current workspace session's tree and
// never the upstream mock tree.
export const workbenchViews: WorkbenchViewRegistry = {
  primary: {
    explorer: {
      id: 'explorer',
      title: 'Explorer',
      icon: 'files',
      component: ExplorerView,
    },
  },
  secondary: {},
  panel: {},
}
