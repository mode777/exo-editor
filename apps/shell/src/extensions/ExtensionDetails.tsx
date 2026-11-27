import { useState } from 'react'
import { normalizeManifestUrl, type PluginConfigIssue } from '../plugins/config'
import type { PluginHostRecord } from '../plugins/host'
import type { PluginManifest } from '../plugins/manifest'
import {
  IssueList,
  PluginSettingFields,
  RuntimeRow,
  commandTargetLabel,
  permissionLabel,
} from '../components/PluginUi'
import {
  useMarketplace,
  usePluginConfig,
  usePluginHost,
  usePluginSettings,
  useWorkspaceRuntime,
  useWorkspaceSnapshot,
} from '../workspace/context'

function safeIcon(icon: string | undefined, manifestUrl: string): string | undefined {
  if (!icon) return undefined
  try {
    return new URL(icon, manifestUrl).href
  } catch {
    return undefined
  }
}

function sourceLabel(catalogName: string | undefined, installed: boolean): string {
  if (catalogName) return catalogName
  return installed ? 'Added by URL' : 'Marketplace feed'
}

function contributionRows(manifest: PluginManifest): string[] {
  const rows: string[] = []
  for (const editor of manifest.fileEditors) {
    rows.push(
      `Editor: ${editor.label} — ${editor.glob}${
        editor.rendering === 'frame' ? ' (visible frame)' : ''
      }`,
    )
  }
  for (const panel of manifest.panels) {
    rows.push(`Panel: ${panel.title} — ${panel.location}`)
  }
  for (const view of manifest.contentViews) {
    rows.push(`Content view: ${view.title}`)
  }
  for (const command of manifest.commands) {
    rows.push(`Command: ${command.title} — ${commandTargetLabel(command)}`)
  }
  for (const template of manifest.newFiles) {
    rows.push(`New file: ${template.label} — ${template.fileName}`)
  }
  return rows
}

export function ExtensionDetails({ manifestUrl }: { manifestUrl: string }) {
  const runtime = useWorkspaceRuntime()
  const workspace = useWorkspaceSnapshot()
  const config = usePluginConfig()
  const host = usePluginHost()
  const marketplace = useMarketplace()
  const settings = usePluginSettings()
  const [issues, setIssues] = useState<PluginConfigIssue[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const key = normalizeManifestUrl(manifestUrl)
  const catalog = marketplace.plugins.find((plugin) => plugin.key === key)
  const entry = config.entries.find((candidate) => normalizeManifestUrl(candidate.manifest) === key)
  const record: PluginHostRecord | undefined = host.records.find(
    (candidate) => normalizeManifestUrl(candidate.manifestUrl) === key,
  )
  const manifest = record?.manifest
  const installed = Boolean(entry)
  const canManage =
    workspace.phase === 'ready' &&
    workspace.writable &&
    !config.busy &&
    (config.status === 'valid' || config.status === 'absent')

  const fallbackName = (() => {
    try {
      return new URL(manifestUrl).hostname
    } catch {
      return 'Extension'
    }
  })()
  const name = manifest?.name ?? catalog?.entry.name ?? fallbackName
  const publisher =
    manifest?.publisher.name ?? catalog?.entry.publisher?.name ?? 'Unknown publisher'
  const version = manifest?.version ?? catalog?.entry.version
  const description =
    manifest?.description ??
    catalog?.entry.description ??
    'This extension was added by manifest URL and is not listed by a configured feed.'
  const icon = safeIcon(manifest?.icon ?? catalog?.entry.icon, manifestUrl)
  const homepage = manifest?.homepage ?? catalog?.entry.homepage
  const license = manifest?.license ?? catalog?.entry.license
  const source = sourceLabel(catalog?.feedName, installed)
  const contributions = manifest ? contributionRows(manifest) : []

  const run = async (operation: () => Promise<{ ok: boolean; issues?: PluginConfigIssue[] }>) => {
    if (!canManage || busy) return
    setBusy(true)
    setIssues([])
    setStatus(null)
    const result = await operation()
    setBusy(false)
    if (!result.ok) setIssues(result.issues ?? [])
  }

  const install = () =>
    run(async () => {
      const result = await runtime.pluginManagement.install(manifestUrl)
      if (result.ok) setStatus('Installed. The plugin still needs consent before it can run.')
      return result
    })

  const toggle = () => {
    if (!entry) return
    setConfirmRemove(false)
    void run(() => runtime.pluginManagement.setEnabled(entry.manifest, !entry.enabled))
  }

  const remove = () => {
    if (!entry) return
    if (!confirmRemove) {
      setConfirmRemove(true)
      return
    }
    setConfirmRemove(false)
    void run(() => runtime.pluginManagement.remove(entry.manifest))
  }

  return (
    <div className="exo-extension-details">
      <header className="exo-extension-details-header">
        {icon ? (
          <img
            className="exo-extension-details-icon"
            src={icon}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
          />
        ) : (
          <span
            className="codicon codicon-extensions exo-extension-details-icon exo-extension-icon-fallback"
            aria-hidden="true"
          />
        )}
        <div className="exo-extension-details-title">
          <h2>{name}</h2>
          <p>
            {publisher}
            {version ? ` · ${version}` : ''}
          </p>
          <p>{description}</p>
        </div>
      </header>

      <div className="exo-extension-details-actions">
        {installed ? (
          <>
            <button type="button" onClick={toggle} disabled={!canManage || busy}>
              {entry?.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              type="button"
              className="exo-extension-remove"
              onClick={remove}
              disabled={!canManage || busy}
              onBlur={() => setConfirmRemove(false)}
            >
              {confirmRemove ? 'Confirm remove' : 'Remove'}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void install()} disabled={!canManage || busy}>
            Install
          </button>
        )}
      </div>

      {workspace.phase !== 'ready' && (
        <p className="exo-extensions-hint" role="status">
          Open a folder to install or manage this extension.
        </p>
      )}
      {workspace.phase === 'ready' && !workspace.writable && (
        <p className="exo-extensions-hint" role="status">
          This workspace is read-only. Extension settings remain editable because they are shell
          state.
        </p>
      )}
      {config.status === 'invalid' && <IssueList issues={config.issues} />}
      {status && (
        <p className="exo-extensions-hint" role="status">
          {status}
        </p>
      )}
      <IssueList issues={issues} />

      <dl className="exo-extension-facts">
        <dt>Source</dt>
        <dd>{source}</dd>
        <dt>Manifest</dt>
        <dd>
          <code>{manifestUrl}</code>
        </dd>
        {manifest && (
          <>
            <dt>Origin</dt>
            <dd>
              <code>{manifest.manifestOrigin}</code>
            </dd>
            <dt>Engine</dt>
            <dd>{manifest.engines.exo}</dd>
          </>
        )}
        {homepage && (
          <>
            <dt>Homepage</dt>
            <dd>
              <a href={homepage} target="_blank" rel="noopener noreferrer">
                {homepage}
              </a>
            </dd>
          </>
        )}
        {license && (
          <>
            <dt>License</dt>
            <dd>{license}</dd>
          </>
        )}
      </dl>

      {installed ? (
        <section className="exo-extension-details-section" aria-labelledby="exo-extension-status">
          <h3 id="exo-extension-status">Status</h3>
          <RuntimeRow
            record={record}
            onReview={(identity) => runtime.pluginManagement.reviewConsent(identity)}
            onRevoke={(identity) => {
              void runtime.pluginManagement.revokeConsent(identity).then((result) => {
                if (!result.ok) setIssues(result.issues)
              })
            }}
          />
        </section>
      ) : (
        <p className="exo-extensions-hint">
          Not installed. Installing adds this manifest URL to the active workspace's exo.json.
        </p>
      )}

      {manifest && (
        <section
          className="exo-extension-details-section"
          aria-labelledby="exo-extension-permissions"
        >
          <h3 id="exo-extension-permissions">Permissions</h3>
          <ul className="exo-extension-facts-list">
            {manifest.permissions.length === 0 ? (
              <li>No workspace permissions requested.</li>
            ) : (
              manifest.permissions.map((permission) => (
                <li key={permission}>
                  <code>{permission}</code> — {permissionLabel(permission)}
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      {contributions.length > 0 && (
        <section
          className="exo-extension-details-section"
          aria-labelledby="exo-extension-contributions"
        >
          <h3 id="exo-extension-contributions">Contributions</h3>
          <ul className="exo-extension-facts-list">
            {contributions.map((contribution) => (
              <li key={contribution}>{contribution}</li>
            ))}
          </ul>
        </section>
      )}

      {record?.identity && manifest?.configuration && (
        <section className="exo-extension-details-section" aria-labelledby="exo-extension-settings">
          <h3 id="exo-extension-settings">Settings</h3>
          <PluginSettingFields
            identity={record.identity}
            configuration={manifest.configuration}
            view={settings.plugins[record.identity]}
            canReceiveEvents={manifest.permissions.includes('events:subscribe')}
          />
        </section>
      )}
    </div>
  )
}
