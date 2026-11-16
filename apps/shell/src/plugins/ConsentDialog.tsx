import { useRef } from 'react'
import { useModalDialog } from '../components/useModalDialog'
import type { PluginManifest, PluginPermission } from './manifest'

export interface ConsentRequestView {
  identity: string
  manifest: PluginManifest
  fingerprint: string
}

interface ConsentDialogProps {
  request: ConsentRequestView | null
  shellOrigin: string
  onApprove: (identity: string) => void
  onDeny: (identity: string) => void
}

const PERMISSION_TEXT: Record<PluginPermission, string> = {
  'workspace:read': 'Read workspace files when you open one with this plugin.',
  'workspace:write': 'Write changes to workspace files when you save.',
  'events:subscribe': 'Receive shell notifications such as theme and file changes.',
}

function rootUrl(manifest: PluginManifest): string {
  return `${manifest.manifestOrigin}${manifest.pluginRoot}`
}

export function ConsentDialog({ request, shellOrigin, onApprove, onDeny }: ConsentDialogProps) {
  const denyButton = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog({
    open: Boolean(request),
    onClose: () => {
      if (request) onDeny(request.identity)
    },
    initialFocus: () => denyButton.current,
  })

  if (!request) return null
  const { manifest } = request
  const sameOrigin = manifest.manifestOrigin === shellOrigin
  const canWrite = manifest.permissions.includes('workspace:write')

  return (
    <div
      className="exo-consent-backdrop"
      onMouseDown={() => onDeny(request.identity)}
      data-testid="consent-backdrop"
    >
      <div
        ref={dialogRef}
        className="exo-consent"
        role="dialog"
        aria-modal="true"
        aria-label="Plugin consent"
        aria-labelledby="exo-consent-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="exo-consent-header">
          <h2 id="exo-consent-title">Allow &ldquo;{manifest.name}&rdquo;?</h2>
          <p className="exo-consent-lead">
            This plugin wants to run code in a sandboxed frame. Review exactly what it is and what
            it can ask the shell to do. Nothing loads until you choose.
          </p>
        </header>

        <dl className="exo-consent-details">
          <dt>Plugin id</dt>
          <dd>
            <code>{manifest.id}</code>
          </dd>
          <dt>Version</dt>
          <dd>{manifest.version}</dd>
          <dt>Publisher</dt>
          <dd>{manifest.publisher.name}</dd>
          <dt>Manifest origin</dt>
          <dd>
            <code className="exo-consent-origin">{manifest.manifestOrigin}</code>
          </dd>
          <dt>Controller entry</dt>
          <dd>
            <code>{manifest.controllerUrl}</code>
          </dd>
          <dt>Plugin root</dt>
          <dd>
            <code>{rootUrl(manifest)}</code>
          </dd>
        </dl>

        <section className="exo-consent-section" aria-labelledby="exo-consent-editors">
          <h3 id="exo-consent-editors">Editors it can open</h3>
          {manifest.fileEditors.length === 0 ? (
            <p className="exo-settings-hint">This plugin registers no file editors.</p>
          ) : (
            <ul className="exo-consent-list">
              {manifest.fileEditors.map((editor) => (
                <li key={`${editor.glob}:${editor.entryUrl}`}>
                  <strong>{editor.label}</strong> — <code>{editor.glob}</code>
                  <div className="exo-consent-page">
                    <code>{editor.entryUrl}</code>
                  </div>
                  {editor.rendering === 'frame' && (
                    <div className="exo-consent-page">
                      Renders its own editor surface in the document area.
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="exo-consent-section" aria-labelledby="exo-consent-permissions">
          <h3 id="exo-consent-permissions">Permissions</h3>
          {manifest.permissions.length === 0 ? (
            <p className="exo-settings-hint">This plugin requests no workspace permissions.</p>
          ) : (
            <ul className="exo-consent-list">
              {manifest.permissions.map((permission) => (
                <li key={permission}>
                  <code>{permission}</code> — {PERMISSION_TEXT[permission]}
                </li>
              ))}
            </ul>
          )}
          <p className={canWrite ? 'exo-consent-warning' : 'exo-settings-hint'}>
            {canWrite
              ? 'This plugin can write to your workspace when you save.'
              : 'This plugin cannot write to your workspace.'}
          </p>
        </section>

        {sameOrigin && (
          <p className="exo-consent-warning" role="alert">
            This plugin is served from the same origin as the shell. It runs without storage access,
            and it cannot be isolated by origin.
          </p>
        )}

        {manifest.homepage && (
          <p className="exo-consent-homepage">
            <a href={manifest.homepage} target="_blank" rel="noopener noreferrer">
              Plugin homepage
            </a>
          </p>
        )}

        <div className="exo-consent-actions">
          <button
            ref={denyButton}
            type="button"
            onClick={() => onDeny(request.identity)}
            className="exo-consent-deny"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onApprove(request.identity)}
            className="exo-consent-approve"
          >
            Allow plugin
          </button>
        </div>
      </div>
    </div>
  )
}
