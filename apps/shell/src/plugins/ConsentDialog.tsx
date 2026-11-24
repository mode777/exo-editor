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
  'workspace:read':
    'Read workspace files it opens or requests, including files you select in its picker.',
  'workspace:write': 'Write changes to workspace files when you save.',
  'workspace:list':
    'List folder contents and file names in the workspace, including files it has not opened.',
  'events:subscribe':
    'Receive shell notifications such as theme and file changes, and exchange local messages with this plugin\u2019s own frames.',
}

function rootUrl(manifest: PluginManifest): string {
  return `${manifest.manifestOrigin}${manifest.pluginRoot}`
}

function commandTargetText(
  command: PluginManifest['commands'][number],
  manifest: PluginManifest,
): string {
  const target = command.target
  if (target === 'activeEditor') return 'Acts on the active editor.'
  const label =
    target.kind === 'panel'
      ? manifest.panels.find((panel) => panel.id === target.id)?.title
      : manifest.contentViews.find((view) => view.id === target.id)?.title
  return `Acts on ${target.kind === 'panel' ? 'the panel' : 'the content view'} “${label ?? target.id}”.`
}

function commandPlacementsText(command: PluginManifest['commands'][number]): string {
  const placements = command.menus.map((menu) => {
    if (menu === 'commandPalette') return 'the command palette'
    if (menu === 'explorer/context') return 'the explorer context menu'
    return 'the editor action row'
  })
  return `Offered in ${placements.join(', ')}.`
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

        <section className="exo-consent-section" aria-labelledby="exo-consent-panels">
          <h3 id="exo-consent-panels">Panels it can add</h3>
          {manifest.panels.length === 0 ? (
            <p className="exo-settings-hint">This plugin adds no panels.</p>
          ) : (
            <ul className="exo-consent-list">
              {manifest.panels.map((panel) => (
                <li key={panel.id}>
                  <strong>{panel.title}</strong> — <code>{panel.id}</code>
                  <div className="exo-consent-page">
                    {panel.location === 'primary'
                      ? 'Left side bar, with an activity-bar item.'
                      : panel.location === 'secondary'
                        ? 'Right side bar, opened from the view picker.'
                        : 'Bottom panel tab.'}
                  </div>
                  <div className="exo-consent-page">
                    <code>{panel.entryUrl}</code>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="exo-consent-section" aria-labelledby="exo-consent-content-views">
          <h3 id="exo-consent-content-views">Content views it can open</h3>
          {manifest.contentViews.length === 0 ? (
            <p className="exo-settings-hint">This plugin adds no content-view tabs.</p>
          ) : (
            <ul className="exo-consent-list">
              {manifest.contentViews.map((view) => (
                <li key={view.id}>
                  <strong>{view.title}</strong> — <code>{view.id}</code>
                  <div className="exo-consent-page">Read-only tab in the document area.</div>
                  <div className="exo-consent-page">
                    <code>{view.entryUrl}</code>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="exo-consent-section" aria-labelledby="exo-consent-commands">
          <h3 id="exo-consent-commands">Commands it can add</h3>
          {manifest.commands.length === 0 ? (
            <p className="exo-settings-hint">This plugin adds no commands.</p>
          ) : (
            <ul className="exo-consent-list">
              {manifest.commands.map((command) => (
                <li key={command.id}>
                  <strong>{command.title}</strong> — <code>{command.id}</code>
                  <div className="exo-consent-page">{commandTargetText(command, manifest)}</div>
                  <div className="exo-consent-page">{commandPlacementsText(command)}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="exo-consent-section" aria-labelledby="exo-consent-new-files">
          <h3 id="exo-consent-new-files">New files it can offer</h3>
          {manifest.newFiles.length === 0 ? (
            <p className="exo-settings-hint">This plugin offers no new-file templates.</p>
          ) : (
            <ul className="exo-consent-list">
              {manifest.newFiles.map((template) => (
                <li key={template.id}>
                  <strong>{template.label}</strong> — <code>{template.fileName}</code>
                  <div className="exo-consent-page">
                    Creates a fixed template&rsquo;s content at a name you confirm.
                  </div>
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

        {(manifest.panels.length > 0 || manifest.contentViews.length > 0) && (
          <p className="exo-settings-hint">
            {manifest.permissions.includes('workspace:read') ||
            manifest.permissions.includes('workspace:write')
              ? 'When you invoke it, this plugin can ask the shell to open workspace files and views.'
              : 'This plugin cannot open workspace files because it requests no read permission.'}
          </p>
        )}

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
