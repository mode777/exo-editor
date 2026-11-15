import { useEffect, useRef } from 'react'
import type { WorkspacePath } from '../workspace/contract'
import type { EditorCandidate } from '../plugins/registry'

export function OpenWithDialog({
  path,
  candidates,
  currentIdentity,
  onChoose,
  onCancel,
}: {
  path: WorkspacePath
  candidates: EditorCandidate[]
  currentIdentity?: string
  onChoose: (candidate: EditorCandidate) => void
  onCancel: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    first.current?.focus()
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      className="exo-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="exo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Open with"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Open with</h2>
        <p className="exo-open-with-path">{path}</p>
        <ul className="exo-open-with-list">
          {candidates.map((candidate, index) => (
            <li key={`${candidate.identity}:${candidate.glob}`}>
              <button
                ref={index === 0 ? first : undefined}
                type="button"
                className={candidate.identity === currentIdentity ? 'is-current' : undefined}
                aria-current={candidate.identity === currentIdentity ? 'true' : undefined}
                onClick={() => onChoose(candidate)}
              >
                <span className="exo-open-with-label">{candidate.label}</span>
                <span className="exo-open-with-plugin">
                  {candidate.pluginName}
                  {candidate.identity === currentIdentity ? ' · current' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="exo-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
