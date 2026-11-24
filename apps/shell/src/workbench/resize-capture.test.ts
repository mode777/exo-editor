import { afterEach, describe, expect, it, vi } from 'vitest'
import { installResizePointerCapture } from './resize-capture'

afterEach(() => {
  document.body.innerHTML = ''
})

function appendSash(): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'resize-handle resize-handle--vertical'
  document.body.append(handle)
  return handle
}

function pointerDown(target: EventTarget, pointerId = 7): boolean {
  return target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId }))
}

describe('resize pointer capture', () => {
  it('captures the drag from the sash, including a nested target', () => {
    const handle = appendSash()
    const capture = vi.fn()
    Object.defineProperty(handle, 'setPointerCapture', { value: capture })
    const stop = installResizePointerCapture(document)

    pointerDown(handle, 11)
    expect(capture).toHaveBeenCalledWith(11)

    const child = document.createElement('span')
    handle.append(child)
    pointerDown(child, 12)
    expect(capture).toHaveBeenLastCalledWith(12)

    stop()
  })

  it('leaves pointer presses outside a sash alone', () => {
    const pane = document.createElement('div')
    pane.className = 'resizable-pane resizable-pane--right'
    document.body.append(pane)
    const capture = vi.fn()
    Object.defineProperty(pane, 'setPointerCapture', { value: capture })
    const stop = installResizePointerCapture(document)

    pointerDown(pane)

    expect(capture).not.toHaveBeenCalled()
    stop()
  })

  it('stops listening when the returned cleanup runs', () => {
    const handle = appendSash()
    const capture = vi.fn()
    Object.defineProperty(handle, 'setPointerCapture', { value: capture })
    const stop = installResizePointerCapture(document)

    stop()
    pointerDown(handle)

    expect(capture).not.toHaveBeenCalled()
  })

  it('does not break the gesture when capture is unavailable', () => {
    const handle = appendSash()
    Object.defineProperty(handle, 'setPointerCapture', {
      value: () => {
        throw new Error('capture refused')
      },
    })
    const stop = installResizePointerCapture(document)

    expect(() => pointerDown(handle)).not.toThrow()
    stop()
  })
})
