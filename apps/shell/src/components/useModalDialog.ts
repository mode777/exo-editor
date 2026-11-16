import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.hasAttribute('hidden') &&
      !element.closest('[hidden]'),
  )
}

export interface ModalDialogOptions {
  open: boolean
  onClose: () => void
  /** Focused when the dialog opens and whenever `focusKey` changes. */
  initialFocus?: () => HTMLElement | null
  /** Re-run the initial focus when this value changes while open. */
  focusKey?: unknown
}

/**
 * The shared modal lifecycle for Exo-owned dialogs: focus moves inside on open,
 * Tab and Shift+Tab stay inside, Escape closes, and closing restores focus to
 * the element that opened the dialog. The command palette is upstream and is
 * documented as an exception instead of using this hook.
 */
export function useModalDialog({
  open,
  onClose,
  initialFocus,
  focusKey,
}: ModalDialogOptions): RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const initialFocusRef = useRef(initialFocus)
  onCloseRef.current = onClose
  initialFocusRef.current = initialFocus

  useEffect(() => {
    if (!open) return
    previousFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(containerRef.current)
      if (focusable.length === 0) {
        event.preventDefault()
        containerRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && containerRef.current?.contains(active)
      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const target = previousFocus.current
      previousFocus.current = null
      if (target?.isConnected) target.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const target = initialFocusRef.current?.() ?? focusableElements(containerRef.current)[0]
    target?.focus()
  }, [open, focusKey])

  return containerRef
}
