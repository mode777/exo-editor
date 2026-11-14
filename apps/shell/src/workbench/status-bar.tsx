import { useWorkbenchStore } from 'vscode-workbench'
import { StatusBar } from 'vscode-workbench/react'

// The preset expects the statusBar prop to be the row itself. Compose the kit's
// StatusBar primitive so the row keeps its fixed height; a bare div here becomes
// a flex sibling and collapses the workbench body. The command-palette button is
// the keyboard path to the palette: the kit's menu bar does not move focus into
// its context menu on open, so a menu entry is pointer-only in 0.1.3.
export function ExoStatusBar() {
  const theme = useWorkbenchStore((state) => state.theme)
  const setQuickOpen = useWorkbenchStore((state) => state.setQuickOpen)

  return (
    <StatusBar
      left={
        <>
          <span className="status-item" title="No workspace is open">
            No workspace
          </span>
          <button
            type="button"
            className="status-item exo-status-button"
            onClick={() => setQuickOpen(true, 'commands')}
          >
            Command Palette
          </button>
        </>
      }
      right={<span className="status-item">Theme: {theme}</span>}
    />
  )
}
