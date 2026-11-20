import { useEffect, useRef } from 'react'

export interface SecondaryViewChoice {
  id: string
  title: string
  pluginName: string
}

export function SecondaryViewPicker({
  open,
  views,
  onChoose,
  onClose,
}: {
  open: boolean
  views: SecondaryViewChoice[]
  onChoose: (id: string) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const first = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    first.current?.focus()
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const move = (direction: 1 | -1) => {
    const buttons = [
      ...(dialog.current?.querySelectorAll<HTMLButtonElement>('.exo-view-choice') ?? []),
    ]
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = (index + direction + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div
      className="exo-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        className="exo-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Select secondary view"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          }
        }}
      >
        <h2>Select secondary view</h2>
        {views.length === 0 ? (
          <p className="exo-settings-hint">No plugin contributes a secondary panel.</p>
        ) : (
          <ul className="exo-view-choice-list" role="listbox" aria-label="Secondary views">
            {views.map((view, index) => (
              <li key={view.id} role="presentation">
                <button
                  ref={index === 0 ? first : undefined}
                  type="button"
                  role="option"
                  aria-selected={index === 0}
                  className="exo-view-choice"
                  onClick={() => onChoose(view.id)}
                >
                  <span>{view.title}</span>
                  <span className="exo-view-choice-plugin">{view.pluginName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="exo-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
