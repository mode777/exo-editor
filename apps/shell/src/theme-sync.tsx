import { useEffect, useRef } from 'react'
import { useWorkbenchStore } from 'vscode-workbench'
import type { ThemeName } from './plugins/events'

export interface ThemeSyncProps {
  /** Called when the theme changes after mount; the initial value is in shell/init. */
  onChange?: (theme: ThemeName) => void
}

// The kit's token stylesheets switch on :root[data-theme]. The preset owns the
// theme value but not the document attribute, so the shell applies it here.
export function ThemeSync({ onChange }: ThemeSyncProps = {}) {
  const theme = useWorkbenchStore((state) => state.theme)
  const lastTheme = useRef<ThemeName>(theme)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (lastTheme.current === theme) return
    lastTheme.current = theme
    onChangeRef.current?.(theme)
  }, [theme])

  return null
}
