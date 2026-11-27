import { useRef } from 'react'
import { useWorkbenchStore } from 'vscode-workbench'
import { useModalDialog } from '../components/useModalDialog'
import { PluginSettings } from './PluginSettings'
import { WorkspaceSettings } from './WorkspaceSettings'

export type SettingsSection = 'general' | 'workspace' | 'plugins'

interface SettingsDialogProps {
  open: boolean
  section?: SettingsSection
  onClose: () => void
  onOpenFolder: () => void
  onConnectRemote: () => void
  onDisconnect: () => void
  onRemoveRemote: (id: string) => void
}

// The shell-owned settings surface. Theme is global; workspace and plugin
// configuration are workspace-scoped.
export function SettingsDialog({
  open,
  section = 'general',
  onClose,
  onOpenFolder,
  onConnectRemote,
  onDisconnect,
  onRemoveRemote,
}: SettingsDialogProps) {
  const theme = useWorkbenchStore((state) => state.theme)
  const setTheme = useWorkbenchStore((state) => state.setTheme)
  const closeButton = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog({
    open,
    onClose,
    focusKey: section,
    initialFocus: () => {
      if (section === 'plugins') return document.getElementById('exo-settings-plugins')
      if (section === 'workspace') return document.getElementById('exo-settings-workspace')
      return closeButton.current
    },
  })

  if (!open) return null

  return (
    <div className="exo-settings-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="exo-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exo-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="exo-settings-header">
          <h2 id="exo-settings-title">Settings</h2>
          <button
            ref={closeButton}
            type="button"
            className="exo-settings-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>
        <section className="exo-settings-section" aria-labelledby="exo-settings-theme">
          <h3 id="exo-settings-theme">Theme</h3>
          <label className="exo-settings-option">
            <input
              type="radio"
              name="exo-theme"
              value="dark"
              checked={theme === 'dark'}
              onChange={() => setTheme('dark')}
            />
            Dark
          </label>
          <label className="exo-settings-option">
            <input
              type="radio"
              name="exo-theme"
              value="light"
              checked={theme === 'light'}
              onChange={() => setTheme('light')}
            />
            Light
          </label>
        </section>
        <WorkspaceSettings
          onOpenFolder={onOpenFolder}
          onConnectRemote={onConnectRemote}
          onDisconnect={onDisconnect}
          onRemoveRemote={onRemoveRemote}
        />
        <PluginSettings onClose={onClose} />
      </div>
    </div>
  )
}
