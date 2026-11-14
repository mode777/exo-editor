import type { WorkbenchViewRegistry } from 'vscode-workbench'

// The explorer is Exo-owned from layer 1 on. Until a workspace provider exists
// it renders an explicit empty state - never the upstream mock tree.
function ExplorerView() {
  return (
    <div className="exo-explorer" role="region" aria-label="Explorer">
      <p className="exo-explorer-empty">No workspace is open.</p>
      <p className="exo-explorer-hint">
        Workspace access arrives with the workspace provider layer.
      </p>
    </div>
  )
}

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
