import type { WorkspacePath } from '../workspace/contract'

export function ClosePromptDialog({
  paths,
  error,
  onSave,
  onDiscard,
  onCancel,
}: {
  paths: WorkspacePath[]
  error: string | null
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const dirtyPaths = paths.filter((path) => Boolean(path))
  return (
    <div className="exo-dialog-backdrop">
      <div className="exo-dialog" role="dialog" aria-modal="true" aria-label="Unsaved changes">
        <h2>Unsaved changes</h2>
        <p>
          {dirtyPaths.length === 1
            ? `${dirtyPaths[0]} has unsaved changes.`
            : `${dirtyPaths.length} documents have unsaved changes.`}
        </p>
        <ul className="exo-close-list">
          {dirtyPaths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
        {error && <p className="exo-dialog-error">{error}</p>}
        <div className="exo-dialog-actions">
          <button type="button" onClick={onSave}>
            Save and close
          </button>
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
