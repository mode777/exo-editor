import { useWorkbenchStore } from 'vscode-workbench'
import { StatusBar } from 'vscode-workbench/react'
import { useWorkspaceRuntime, useWorkspaceSnapshot } from '../workspace/context'

// The preset expects the statusBar prop to be the row itself. Compose the kit's
// StatusBar primitive so the row keeps its fixed height; a bare div here becomes
// a flex sibling and collapses the workbench body.
export function ExoStatusBar() {
  const theme = useWorkbenchStore((state) => state.theme)
  const setQuickOpen = useWorkbenchStore((state) => state.setQuickOpen)
  const runtime = useWorkspaceRuntime()
  const snapshot = useWorkspaceSnapshot()

  const workspaceLabel =
    snapshot.phase === 'ready' && snapshot.descriptor
      ? `${snapshot.descriptor.name} · ${snapshot.descriptor.providerKind}`
      : snapshot.phase === 'unsupported'
        ? 'No workspace · Unsupported browser'
        : 'No workspace'

  return (
    <StatusBar
      left={
        <>
          <span
            className="status-item"
            title={snapshot.error ? 'The workspace reported an error' : workspaceLabel}
          >
            {workspaceLabel}
          </span>
          {snapshot.phase === 'ready' && !snapshot.writable && (
            <button
              type="button"
              className="status-item exo-status-button exo-status-warning"
              onClick={() => void runtime.requestPermission()}
            >
              Read-only · Restore access
            </button>
          )}
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
