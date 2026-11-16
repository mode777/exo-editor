import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useModalDialog } from './useModalDialog'

let root: Root | null = null
let container: HTMLDivElement | null = null

function Harness() {
  const [open, setOpen] = useState(false)
  const dialogRef = useModalDialog({ open, onClose: () => setOpen(false) })
  return (
    <>
      <button id="opener" type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test dialog">
          <button id="first" type="button">
            First
          </button>
          <button id="last" type="button">
            Last
          </button>
        </div>
      )}
    </>
  )
}

function Controlled({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useModalDialog({ open, onClose })
  return (
    <>
      <button id="opener" type="button">
        Open
      </button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test dialog">
          <button id="first" type="button">
            First
          </button>
        </div>
      )}
    </>
  )
}

async function render(node = <Harness />) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(node))
  return container
}

function key(value: string, shiftKey = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true }))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('useModalDialog', () => {
  it('focuses the first control and traps Tab and Shift+Tab', async () => {
    const rendered = await render()
    const opener = rendered.querySelector<HTMLButtonElement>('#opener')
    opener?.focus()
    await act(async () => opener?.click())

    expect(document.activeElement?.id).toBe('first')

    const last = rendered.querySelector<HTMLButtonElement>('#last')
    last?.focus()
    key('Tab')
    expect(document.activeElement?.id).toBe('first')

    const first = rendered.querySelector<HTMLButtonElement>('#first')
    first?.focus()
    key('Tab', true)
    expect(document.activeElement?.id).toBe('last')
  })

  it('closes on Escape and restores focus to the opener', async () => {
    const rendered = await render()
    const opener = rendered.querySelector<HTMLButtonElement>('#opener')
    opener?.focus()
    await act(async () => opener?.click())
    expect(rendered.querySelector('[role="dialog"]')).not.toBeNull()

    await act(async () => key('Escape'))

    expect(rendered.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('restores focus when the dialog closes while it stays mounted', async () => {
    const rendered = await render(<Controlled open={false} onClose={() => undefined} />)
    const opener = rendered.querySelector<HTMLButtonElement>('#opener')
    opener?.focus()

    await act(async () => root?.render(<Controlled open onClose={() => undefined} />))
    expect(document.activeElement?.id).toBe('first')

    await act(async () => root?.render(<Controlled open={false} onClose={() => undefined} />))
    expect(document.activeElement).toBe(opener)
  })
})
