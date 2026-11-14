import { useWorkbenchStore } from 'vscode-workbench'

// Status bar content is Exo-owned. It reports the two global facts layer 1 has:
// no workspace is open, and which theme is active.
export function ExoStatusBar() {
  const theme = useWorkbenchStore((state) => state.theme)

  return (
    <div className="exo-status-bar">
      <span className="exo-status-item" title="No workspace is open">
        No workspace
      </span>
      <span className="exo-status-item">Theme: {theme}</span>
    </div>
  )
}
