import { useEffect } from 'react'
import { useWorkbenchStore } from 'vscode-workbench'

// The kit's token stylesheets switch on :root[data-theme]. The preset owns the
// theme value but not the document attribute, so the shell applies it here.
export function ThemeSync() {
  const theme = useWorkbenchStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return null
}
