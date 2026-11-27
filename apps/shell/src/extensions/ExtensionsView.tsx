import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  normalizeManifestUrl,
  type PluginConfigEntry,
  type PluginConfigIssue,
} from '../plugins/config'
import type { MarketplaceCatalogPlugin, MarketplaceSnapshot } from '../marketplace/store'
import type { PluginHostRecord } from '../plugins/host'
import { IssueList, phaseText } from '../components/PluginUi'
import {
  useMarketplace,
  usePluginConfig,
  usePluginHost,
  useWorkspaceRuntime,
  useWorkspaceSnapshot,
} from '../workspace/context'
import { openShellViewTab } from '../workbench/tabs'

interface InstalledItem {
  entry: PluginConfigEntry
  record: PluginHostRecord | undefined
  catalog: MarketplaceCatalogPlugin | undefined
}

function normalized(value: string): string | null {
  return normalizeManifestUrl(value)
}

function installedItems(
  entries: PluginConfigEntry[],
  records: PluginHostRecord[],
  catalog: MarketplaceCatalogPlugin[],
): InstalledItem[] {
  return entries.map((entry) => {
    const key = normalized(entry.manifest)
    return {
      entry,
      record: records.find((record) => normalized(record.manifestUrl) === key),
      catalog: catalog.find((plugin) => plugin.key === key),
    }
  })
}

function displayMetadata(item: InstalledItem): {
  name: string
  publisher: string
  version: string
  description: string
  icon?: string
} {
  const manifest = item.record?.manifest
  const catalog = item.catalog?.entry
  const fallbackName = (() => {
    try {
      return new URL(item.entry.manifest).hostname
    } catch {
      return 'Installed extension'
    }
  })()
  return {
    name: manifest?.name ?? catalog?.name ?? fallbackName,
    publisher: manifest?.publisher.name ?? catalog?.publisher?.name ?? 'Installed from URL',
    version: manifest?.version ?? catalog?.version ?? '',
    description:
      manifest?.description ??
      catalog?.description ??
      'This extension was added by manifest URL and is not listed by a configured feed.',
    ...(manifest?.icon
      ? { icon: new URL(manifest.icon, item.entry.manifest).href }
      : catalog?.icon
        ? { icon: catalog.icon }
        : {}),
  }
}

function PluginIcon({ icon, name }: { icon?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [icon])
  if (icon && !failed) {
    return (
      <img
        className="exo-extension-icon"
        src={icon}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span
      className="codicon codicon-extensions exo-extension-icon exo-extension-icon-fallback"
      aria-hidden="true"
      title={name}
    />
  )
}

function matches(query: string, values: Array<string | undefined>): boolean {
  if (query.length === 0) return true
  return values.some((value) => value?.toLowerCase().includes(query))
}

function statusClass(record: PluginHostRecord | undefined): string {
  return record
    ? `exo-extension-status exo-extension-status-${record.phase}`
    : 'exo-extension-status'
}

function MarketplaceIssueList({ issues }: { issues: MarketplaceSnapshot['sourceIssues'] }) {
  if (issues.length === 0) return null
  return (
    <ul className="exo-plugin-issues">
      {issues.map((issue, index) => (
        <li key={`${issue.code}:${issue.field ?? ''}:${index}`}>
          <code>{issue.code}</code>
          {issue.field && (
            <span>
              {' '}
              at <code>{issue.field}</code>
            </span>
          )}
          {issue.message && <span> — {issue.message}</span>}
        </li>
      ))}
    </ul>
  )
}

function FeedStatus({
  marketplace,
  onRetry,
}: {
  marketplace: MarketplaceSnapshot
  onRetry: () => void
}) {
  const failed = marketplace.feeds.filter((feed) => feed.status === 'failed')
  const loading = marketplace.phase === 'loading'
  return (
    <>
      {loading && (
        <p className="exo-extensions-hint" role="status">
          {marketplace.sourceStatus === 'loading'
            ? 'Loading marketplace sources…'
            : 'Loading marketplace feeds…'}
        </p>
      )}
      {marketplace.sourceStatus === 'failed' && (
        <div className="exo-extensions-error" role="alert">
          <p>This deployment's marketplace sources could not be loaded.</p>
          <MarketplaceIssueList issues={marketplace.sourceIssues} />
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {failed.map((feed) => (
        <div className="exo-extensions-error" key={feed.url} role="alert">
          <p>
            Feed <code>{feed.url}</code> could not be loaded.
          </p>
          <MarketplaceIssueList issues={feed.issues} />
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ))}
    </>
  )
}

function InstalledRow({
  item,
  onManage,
  onReview,
}: {
  item: InstalledItem
  onManage: () => void
  onReview: (identity: string) => void
}) {
  const metadata = displayMetadata(item)
  const record = item.record
  const canReview =
    record?.identity &&
    (record.phase === 'awaiting-consent' ||
      record.phase === 'denied' ||
      record.consent === 'revoked')
  return (
    <li className="exo-extension-row">
      <button type="button" className="exo-extension-open" onClick={onManage}>
        <PluginIcon {...(metadata.icon ? { icon: metadata.icon } : {})} name={metadata.name} />
        <span className="exo-extension-copy">
          <span className="exo-extension-title">{metadata.name}</span>
          <span className="exo-extension-subtitle">{metadata.publisher}</span>
          <span className="exo-extension-description">{metadata.description}</span>
          <span className={statusClass(record)}>{phaseText(record)}</span>
        </span>
      </button>
      <span className="exo-extension-actions">
        {canReview && record?.identity && (
          <button type="button" onClick={() => onReview(record.identity as string)}>
            Review
          </button>
        )}
        <button type="button" onClick={onManage}>
          Manage
        </button>
      </span>
    </li>
  )
}

function CatalogRow({
  plugin,
  installed,
  canInstall,
  onInstall,
  onManage,
}: {
  plugin: MarketplaceCatalogPlugin
  installed: InstalledItem | undefined
  canInstall: boolean
  onInstall: () => void
  onManage: () => void
}) {
  const entry = plugin.entry
  return (
    <li className="exo-extension-row">
      <button type="button" className="exo-extension-open" onClick={onManage}>
        <PluginIcon {...(entry.icon ? { icon: entry.icon } : {})} name={entry.name} />
        <span className="exo-extension-copy">
          <span className="exo-extension-title">{entry.name}</span>
          <span className="exo-extension-subtitle">
            {entry.publisher?.name ?? 'Unknown publisher'}
            {entry.version ? ` · ${entry.version}` : ''}
          </span>
          {entry.description && (
            <span className="exo-extension-description">{entry.description}</span>
          )}
          <span className="exo-extension-source">Source: {plugin.feedName}</span>
        </span>
      </button>
      <span className="exo-extension-actions">
        {installed ? (
          <button type="button" onClick={onManage}>
            {installed.entry.enabled ? 'Installed' : 'Disabled'}
          </button>
        ) : (
          <button type="button" onClick={onInstall} disabled={!canInstall}>
            Install
          </button>
        )}
      </span>
    </li>
  )
}

export function ExtensionsView() {
  const runtime = useWorkspaceRuntime()
  const workspace = useWorkspaceSnapshot()
  const config = usePluginConfig()
  const host = usePluginHost()
  const marketplace = useMarketplace()
  const [query, setQuery] = useState('')
  const [installedOpen, setInstalledOpen] = useState(true)
  const [marketplaceOpen, setMarketplaceOpen] = useState(true)
  const [url, setUrl] = useState('')
  const [issues, setIssues] = useState<PluginConfigIssue[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void runtime.marketplace.ensureLoaded()
  }, [runtime])

  const installed = useMemo(
    () => installedItems(config.entries, host.records, marketplace.plugins),
    [config.entries, host.records, marketplace.plugins],
  )
  const installedByManifest = useMemo(() => {
    const map = new Map<string, InstalledItem>()
    for (const item of installed) {
      const key = normalized(item.entry.manifest)
      if (key) map.set(key, item)
    }
    return map
  }, [installed])

  const ready = workspace.phase === 'ready'
  const writable = ready && workspace.writable
  const canManage =
    writable && !config.busy && (config.status === 'valid' || config.status === 'absent')
  const queryText = query.trim().toLowerCase()
  const visibleInstalled = installed.filter((item) => {
    const metadata = displayMetadata(item)
    return matches(queryText, [
      metadata.name,
      metadata.publisher,
      metadata.description,
      item.entry.manifest,
    ])
  })
  const visibleCatalog = marketplace.plugins.filter((plugin) =>
    matches(queryText, [
      plugin.entry.name,
      plugin.entry.publisher?.name,
      plugin.entry.description,
      ...(plugin.entry.keywords ?? []),
    ]),
  )

  const openDetails = (manifestUrl: string, title: string) => {
    openShellViewTab(manifestUrl, title)
  }

  const install = async (manifestUrl: string, title: string) => {
    if (!canManage || busy) return
    setBusy(manifestUrl)
    setIssues([])
    setStatus(null)
    const result = await runtime.pluginManagement.install(manifestUrl)
    setBusy(null)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    openDetails(manifestUrl, title)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canManage || url.trim().length === 0) return
    setBusy('url')
    setIssues([])
    setStatus('Adding extension…')
    const result = await runtime.pluginManagement.install(url)
    setBusy(null)
    setStatus(null)
    if (!result.ok) {
      setIssues(result.issues)
      return
    }
    setUrl('')
  }

  const installHint = !ready
    ? 'Open a folder to install extensions into a workspace.'
    : !workspace.writable
      ? 'This workspace is read-only. Extension folders can be browsed but not changed.'
      : config.status === 'invalid'
        ? 'Fix exo.json before installing extensions.'
        : null

  return (
    <div className="exo-extensions">
      <label className="exo-visually-hidden" htmlFor="exo-extensions-search">
        Search extensions
      </label>
      <input
        id="exo-extensions-search"
        className="exo-extensions-search"
        type="search"
        placeholder="Search extensions"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />

      {installHint && (
        <p className="exo-extensions-hint" role="status">
          {installHint}
        </p>
      )}
      {ready && (config.status === 'idle' || config.status === 'loading') && (
        <p className="exo-extensions-hint" role="status">
          Loading exo.json…
        </p>
      )}
      {config.status === 'invalid' && <IssueList issues={config.issues} />}

      <section className="exo-extensions-section" aria-labelledby="exo-extensions-installed">
        <h3 id="exo-extensions-installed">
          <button
            type="button"
            className="exo-extensions-section-toggle"
            aria-expanded={installedOpen}
            onClick={() => setInstalledOpen((open) => !open)}
          >
            <span
              className={`codicon codicon-chevron-${installedOpen ? 'down' : 'right'}`}
              aria-hidden="true"
            />
            Installed
            <span className="exo-extensions-count">{installed.length}</span>
          </button>
        </h3>
        {installedOpen && (
          <>
            {installed.length === 0 ? (
              <p className="exo-extensions-empty">
                {ready
                  ? 'No extensions are installed in this workspace.'
                  : 'Open a folder to see installed extensions.'}
              </p>
            ) : visibleInstalled.length === 0 ? (
              <p className="exo-extensions-empty">No installed extensions match.</p>
            ) : (
              <ul className="exo-extensions-list" aria-label="Installed extensions">
                {visibleInstalled.map((item) => (
                  <InstalledRow
                    key={`${item.entry.index}:${item.entry.manifest}`}
                    item={item}
                    onManage={() => {
                      const metadata = displayMetadata(item)
                      openDetails(item.entry.manifest, metadata.name)
                    }}
                    onReview={(identity) => runtime.pluginManagement.reviewConsent(identity)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="exo-extensions-section" aria-labelledby="exo-extensions-marketplace">
        <h3 id="exo-extensions-marketplace">
          <button
            type="button"
            className="exo-extensions-section-toggle"
            aria-expanded={marketplaceOpen}
            onClick={() => setMarketplaceOpen((open) => !open)}
          >
            <span
              className={`codicon codicon-chevron-${marketplaceOpen ? 'down' : 'right'}`}
              aria-hidden="true"
            />
            Marketplace
            <span className="exo-extensions-count">{marketplace.plugins.length}</span>
          </button>
        </h3>
        {marketplaceOpen && (
          <>
            <FeedStatus
              marketplace={marketplace}
              onRetry={() => {
                void runtime.marketplace.refresh()
              }}
            />
            {marketplace.phase === 'ready' &&
              marketplace.sourceStatus === 'ready' &&
              marketplace.plugins.length === 0 &&
              marketplace.feeds.every((feed) => feed.status === 'ready') && (
                <p className="exo-extensions-empty">
                  No plugins are listed by the configured marketplace feeds.
                </p>
              )}
            {marketplace.plugins.length > 0 &&
              (visibleCatalog.length === 0 ? (
                <p className="exo-extensions-empty">No marketplace extensions match.</p>
              ) : (
                <ul className="exo-extensions-list" aria-label="Marketplace extensions">
                  {visibleCatalog.map((plugin) => {
                    const item = installedByManifest.get(plugin.key)
                    return (
                      <CatalogRow
                        key={plugin.key}
                        plugin={plugin}
                        installed={item}
                        canInstall={canManage}
                        onInstall={() => void install(plugin.manifest, plugin.entry.name)}
                        onManage={() =>
                          openDetails(
                            item?.entry.manifest ?? plugin.manifest,
                            item ? displayMetadata(item).name : plugin.entry.name,
                          )
                        }
                      />
                    )
                  })}
                </ul>
              ))}
          </>
        )}
      </section>

      <form className="exo-extensions-install" onSubmit={(event) => void submit(event)}>
        <label htmlFor="exo-extensions-url">Install from URL</label>
        <div className="exo-extensions-install-row">
          <input
            id="exo-extensions-url"
            type="text"
            inputMode="url"
            placeholder="https://plugins.example.com/exo-manifest.json"
            value={url}
            disabled={!canManage || busy !== null}
            onChange={(event) => {
              setUrl(event.target.value)
              setIssues([])
            }}
          />
          <button type="submit" disabled={!canManage || busy !== null || url.trim().length === 0}>
            Install
          </button>
        </div>
        <p className="exo-extensions-hint">
          Adds a manifest URL to this workspace's exo.json. The plugin still needs your consent
          before any code is loaded.
        </p>
        {busy === 'url' && (
          <p className="exo-extensions-hint" role="status">
            Adding extension…
          </p>
        )}
        {status && (
          <p className="exo-extensions-hint" role="status">
            {status}
          </p>
        )}
        <IssueList issues={issues} />
      </form>
    </div>
  )
}
