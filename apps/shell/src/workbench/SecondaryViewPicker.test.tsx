import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeAxeViolations, runAxe } from '../test-a11y'
import { SecondaryViewPicker } from './SecondaryViewPicker'

let root: Root | null = null
let container: HTMLDivElement | null = null

async function render(props: Partial<Parameters<typeof SecondaryViewPicker>[0]> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onChoose = props.onChoose ?? vi.fn()
  const onClose = props.onClose ?? vi.fn()
  await act(async () =>
    root?.render(
      <SecondaryViewPicker
        open={props.open ?? true}
        views={
          props.views ?? [
            { id: 'outline', title: 'Outline', pluginName: 'Viewer' },
            { id: 'inspector', title: 'Inspector', pluginName: 'Tools' },
          ]
        }
        onChoose={onChoose}
        onClose={onClose}
      />,
    ),
  )
  return { onChoose, onClose }
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('secondary view picker', () => {
  it('lists each view with its plugin name', async () => {
    await render()
    const options = container?.querySelectorAll('[role="option"]') ?? []
    expect(options).toHaveLength(2)
    expect(options[0]?.textContent).toContain('Outline')
    expect(options[0]?.textContent).toContain('Viewer')
    expect(options[1]?.textContent).toContain('Tools')
  })

  it('moves focus with arrow keys and closes on Escape', async () => {
    const { onClose } = await render()
    const options = [...(container?.querySelectorAll<HTMLButtonElement>('.exo-view-choice') ?? [])]
    expect(document.activeElement).toBe(options[0])

    options[0]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(options[1])

    options[1]?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    )
    expect(document.activeElement).toBe(options[0])

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('chooses the focused view', async () => {
    const { onChoose } = await render()
    const second = container?.querySelectorAll<HTMLButtonElement>('.exo-view-choice')[1]
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onChoose).toHaveBeenCalledWith('inspector')
  })

  it('has no Exo-owned axe violations', async () => {
    await render()
    const results = await runAxe(container as Element)
    expect(describeAxeViolations(results)).toEqual([])
  })
})
