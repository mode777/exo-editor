import { useWorkbenchStore } from 'vscode-workbench'

// Status bar content is Exo-owned. It reports the two global facts layer 1 has:
// no workspace is open, and which theme is active. The command-palette button is
// the keyboard path to the palette: the kit's menu bar does not move focus into
// its context menu on open, so a menu entry is pointer-only in 0.1.3.
export function ExoStatusBar() {
  const theme = useWorkbenchStore((state) => state.theme)
  const setQuickOpen = useWorkbenchStore((state) => state.setQuickOpen)

  return (
    <div className="exo-status-bar">
      <span className="exo-status-item" title="No workspace is open">
        No workspace
      </span>
      <button
        type="button"
        className="exo-status-button"
        onClick={() => setQuickOpen(true, 'commands')}
      >
        Command Palette
      </button>
      <span className="exo-status-item">Theme: {theme}</span>
    </div>
  )
}
