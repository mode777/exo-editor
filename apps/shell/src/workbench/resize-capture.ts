const RESIZE_HANDLE_SELECTOR = '.resize-handle'

function resizeHandleFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const handle = target.closest(RESIZE_HANDLE_SELECTOR)
  return handle instanceof HTMLElement ? handle : null
}

/**
 * Keep a sash drag on the shell when the pointer crosses a plugin frame.
 *
 * `vscode-workbench`'s ResizablePane listens on `window` for pointermove and
 * pointerup. Exo draws visible plugin frames as fixed overlays above the
 * workbench, so without capture a drag that crosses one stops receiving moves
 * and its release: the pane freezes, then keeps resizing after the button is
 * up. Capturing the pointer on the sash retargets the rest of the gesture to
 * the shell. The kit still owns the drag state and the committed size.
 */
export function installResizePointerCapture(doc: Document = document): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const handle = resizeHandleFrom(event.target)
    if (!handle) return
    try {
      handle.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a safety net; the kit's window listeners still work without it.
    }
  }

  doc.addEventListener('pointerdown', onPointerDown, true)
  return () => doc.removeEventListener('pointerdown', onPointerDown, true)
}
