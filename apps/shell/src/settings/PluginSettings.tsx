import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  usePluginConfig,
  usePluginHost,
  useWorkspaceRuntime,
  useWorkspaceSnapshot,
} from '../workspace/context'
import type { PluginHostRecord, PluginLogEntry } from '../plugins/host'
import {
  emptyExoConfig,
  serializeExoConfig,
  type PluginConfigEntry,
  type PluginConfigIssue,
} from '../plugins/config'

const EMPTY_TEMPLATE = serializeExoConfig(emptyExoConfig())

function issueMessage(issue: PluginConfigIssue): string {
  const where = issue.entryIndex === undefined ? 'exo.json' : `Entry ${issue.entryIndex + 1}`
  switch (issue.code) {
    case 'invalid-json':
      return 'exo.json is not valid JSON.'
    case 'unsupported-version':
      return 'exo.json uses a schema version this shell does not support.'
    case 'invalid-config':
      return `${where} is invalid.`
    case 'too-many-plugins':
      return 'exo.json declares more than 50 plugins.'
    case 'duplicate-manifest':
      return `${where} repeats a manifest URL.`
    case 'too-large':
      return 'exo.json is larger than 256 KiB.'
    case 'not-readable':
      return 'exo.json could not be read or written.'
    case 'conflict':
      return 'exo.json changed on disk. Reload it before saving again.'
  }
}

function IssueList({ issues }: { issues: PluginConfigIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="exo-plugin-issues" role="alert">
      {issues.map((issue, index) => (
        <li key={`${issue.code}:${issue.field ?? ''}:${issue.entryIndex ?? ''}:${index}`}>
          <code>{issue.code}</code>
          {issue.entryIndex !== undefined && <span> entry {issue.entryIndex + 1}</span>}
          {issue.field && (
            <span>
              {' '}
              at <code>{issue.field}</code>
            </span>
          )}
          <span> — {issueMessage(issue)}</span>
        </li>
      ))}
    </ul>
  )
}

function phaseText(record: PluginHostRecord | undefined): string {
  if (!record) return 'Not loaded yet'
  switch (record.phase) {
    case 'disabled':
      return 'Disabled'
    case 'loading':
      return 'Loading manifest…'
    case 'awaiting-consent':
      return 'Awaiting consent'
    case 'denied':
      return 'Consent denied for this session'
    case 'registering':
      return 'Registering…'
    case 'active':
      return record.registrations.length === 0
        ? 'Active (no editors)'
        : `Active — ${record.registrations.map((editor) => editor.label).join(', ')}`
    case 'failed':
      return record.error ? `Failed — ${record.error.code} (${record.error.phase})` : 'Failed'
  }
}

export function RuntimeRow({
  record,
  onReview,
  onRevoke,
}: {
  record: PluginHostRecord | undefined
  onReview: (identity: string) => void
  onRevoke: (identity: string) => void
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  if (!record) {
    return <p className="exo-plugin-status">Not loaded yet</p>
  }
  const canReview =
    (record.phase === 'awaiting-consent' ||
      record.phase === 'denied' ||
      record.consent === 'revoked') &&
    Boolean(record.identity)
  const canRevoke =
    Boolean(record.identity) && (record.phase === 'active' || record.phase === 'registering')

  return (
    <div className="exo-plugin-runtime">
      <p className={`exo-plugin-status exo-plugin-status-${record.phase}`}>{phaseText(record)}</p>
      {record.manifest && (
        <p className="exo-plugin-meta">
          {record.manifest.name} {record.manifest.version} — {record.manifest.publisher.name}
        </p>
      )}
      {record.manifest && (
        <p className="exo-plugin-origin">
          Origin: <code>{record.manifest.manifestOrigin}</code>
        </p>
      )}
      {record.error?.message && <p className="exo-plugin-error-message">{record.error.message}</p>}
      {record.registrations.length > 0 && (
        <p className="exo-plugin-editors">
          Editors:{' '}
          {record.registrations.map((editor) => (
            <code key={`${editor.glob}:${editor.entryUrl}`}>{editor.label}</code>
          ))}
        </p>
      )}
      {(canReview || canRevoke) && (
        <div className="exo-plugin-runtime-actions">
          {canReview && record.identity && (
            <button type="button" onClick={() => onReview(record.identity as string)}>
              Review consent
            </button>
          )}
          {canRevoke && record.identity && (
            <button
              type="button"
              className="exo-plugin-revoke"
              onClick={() => {
                if (!confirmRevoke) {
                  setConfirmRevoke(true)
                  return
                }
                setConfirmRevoke(false)
                onRevoke(record.identity as string)
              }}
              onBlur={() => setConfirmRevoke(false)}
            >
              {confirmRevoke ? 'Confirm revoke' : 'Revoke consent'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function PluginSettings() {
  const runtime = useWorkspaceRuntime()
  const workspace = useWorkspaceSnapshot()
  const config = usePluginConfig()
  const host = usePluginHost()
  const store = runtime.pluginConfig

  const writable = workspace.phase === 'ready' && workspace.writable
  const notReadable = config.status === 'invalid' && config.version === null && config.text === null
  const canMutate =
    writable &&
    !config.busy &&
    config.status !== 'invalid' &&
    (config.status === 'valid' || config.status === 'absent')

  const [url, setUrl] = useState('')
  const [issues, setIssues] = useState<PluginConfigIssue[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [rawOpen, setRawOpen] = useState(false)
  const [rawText, setRawText] = useState('')
  const [rawDirty, setRawDirty] = useState(false)
  const [rawIssues, setRawIssues] = useState<PluginConfigIssue[]>([])
  const [rawChangedExternally, setRawChangedExternally] = useState(false)
  const rawSavedText = useRef(EMPTY_TEMPLATE)
  const configText = config.text ?? (config.status === 'absent' ? EMPTY_TEMPLATE : '')

  useEffect(() => {
    if (workspace.phase === 'ready') void store.refresh(true)
  }, [store, workspace.phase])

  useEffect(() => {
    if (!rawOpen) return
    if (rawDirty) {
      if (config.text !== null && config.text !== rawSavedText.current) {
        setRawChangedExternally(true)
      }
      return
    }
    setRawText(configText)
    rawSavedText.current = configText
    setRawChangedExternally(false)
  }, [config.text, configText, rawDirty, rawOpen])

  const openRaw = () => {
    const text = config.text ?? (config.status === 'absent' ? EMPTY_TEMPLATE : '')
    setRawText(text)
    rawSavedText.current = text
    setRawDirty(false)
    setRawIssues([])
    setRawChangedExternally(false)
    setRawOpen(true)
  }

  const recordIssues = (result: { ok: boolean; issues?: PluginConfigIssue[] }) => {
    if (result.ok) return
    const next = result.issues ?? []
    setIssues(next)
    if (next.some((issue) => issue.code === 'conflict')) {
      void store.refresh(true)
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canMutate) return
    setIssues([])
    setStatus('Adding plugin…')
    const result = await store.addEntry(url.trim())
    setStatus(null)
    if (result.ok) {
      setUrl('')
    } else {
      recordIssues(result)
    }
  }

  const toggle = async (entry: PluginConfigEntry) => {
    if (!canMutate) return
    setIssues([])
    recordIssues(await store.setEnabled(entry.index, !entry.enabled))
  }

  const remove = async (entry: PluginConfigEntry) => {
    if (!canMutate) return
    setIssues([])
    recordIssues(await store.removeEntry(entry.index))
  }

  const saveRaw = async () => {
    if (!writable || config.busy) return
    setRawIssues([])
    setStatus('Saving exo.json…')
    const result = await store.saveRaw(rawText)
    setStatus(null)
    if (result.ok) {
      const next = store.getSnapshot().text ?? EMPTY_TEMPLATE
      rawSavedText.current = next
      setRawText(next)
      setRawDirty(false)
      setRawChangedExternally(false)
      setRawIssues([])
      return
    }
    setRawIssues(result.issues)
    if (result.issues.some((issue) => issue.code === 'conflict')) {
      void store.refresh(true)
    }
  }

  const reloadRaw = async () => {
    await store.refresh(true)
    const snapshot = store.getSnapshot()
    const text = snapshot.text ?? (snapshot.status === 'absent' ? EMPTY_TEMPLATE : '')
    rawSavedText.current = text
    setRawText(text)
    setRawDirty(false)
    setRawIssues([])
    setRawChangedExternally(false)
  }

  return (
    <section className="exo-settings-section" aria-labelledby="exo-settings-plugins">
      <h3 id="exo-settings-plugins" tabIndex={-1}>
        Plugins
      </h3>

      {workspace.phase !== 'ready' ? (
        <p className="exo-settings-hint">Open a folder to configure workspace plugins.</p>
      ) : (
        <>
          {!writable && (
            <p className="exo-settings-warning" role="status">
              This workspace is read-only. Plugin configuration can be viewed but not changed.
            </p>
          )}

          {config.status === 'idle' || config.status === 'loading' ? (
            <p className="exo-settings-hint" role="status">
              Loading exo.json…
            </p>
          ) : null}

          {config.status === 'absent' && (
            <p className="exo-settings-hint">
              No plugins are declared. Adding one creates exo.json.
            </p>
          )}

          {config.status === 'invalid' && <IssueList issues={config.issues} />}

          {config.status === 'valid' && (
            <ul className="exo-plugin-list" aria-label="Declared plugins">
              {config.entries.map((entry) => (
                <li className="exo-plugin-entry" key={`${entry.index}:${entry.manifest}`}>
                  <code className="exo-plugin-manifest">{entry.manifest}</code>
                  <div className="exo-plugin-actions">
                    <label className="exo-settings-option">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        disabled={!canMutate}
                        onChange={() => void toggle(entry)}
                      />
                      Enabled
                    </label>
                    <button
                      type="button"
                      className="exo-plugin-remove"
                      disabled={!canMutate}
                      onClick={() => void remove(entry)}
                    >
                      Remove
                    </button>
                  </div>
                  <RuntimeRow
                    record={host.records.find((record) => record.manifestUrl === entry.manifest)}
                    onReview={(identity) => runtime.pluginHost.requestConsent(identity)}
                    onRevoke={(identity) => runtime.pluginHost.revokeConsent(identity)}
                  />
                </li>
              ))}
            </ul>
          )}

          {(config.status === 'valid' || config.status === 'absent') && (
            <form className="exo-plugin-add" onSubmit={(event) => void submit(event)}>
              <label htmlFor="exo-plugin-add-url">Manifest URL</label>
              <div className="exo-plugin-add-row">
                <input
                  id="exo-plugin-add-url"
                  type="text"
                  inputMode="url"
                  placeholder="https://plugins.example.com/exo-manifest.json"
                  value={url}
                  disabled={!canMutate}
                  onChange={(event) => {
                    setUrl(event.target.value)
                    setIssues([])
                  }}
                />
                <button type="submit" disabled={!canMutate || url.trim().length === 0}>
                  Add
                </button>
              </div>
              <p className="exo-settings-hint">
                Adding records the URL and starts loading the manifest. The plugin still needs your
                consent before a frame is mounted.
              </p>
            </form>
          )}

          <IssueList issues={issues} />

          <div className="exo-plugin-raw-toggle">
            <button type="button" onClick={openRaw} disabled={config.status === 'loading'}>
              Open exo.json
            </button>
          </div>

          <p className="exo-settings-hint">
            Saving rewrites exo.json as canonical 2-space JSON. Comments, formatting and key order
            are not preserved; comments are not valid JSON.
          </p>

          {rawOpen && (
            <div className="exo-plugin-raw">
              <label htmlFor="exo-plugin-raw-text">exo.json content</label>
              <textarea
                id="exo-plugin-raw-text"
                aria-label="exo.json content"
                value={rawText}
                readOnly={!writable || notReadable || config.busy}
                onChange={(event) => {
                  setRawText(event.target.value)
                  setRawDirty(event.target.value !== rawSavedText.current)
                  setRawIssues([])
                  setRawChangedExternally(false)
                }}
              />
              {notReadable && (
                <p className="exo-settings-warning" role="alert">
                  exo.json cannot be read, so it cannot be edited here.
                </p>
              )}
              {rawChangedExternally && (
                <p className="exo-settings-warning" role="alert">
                  exo.json changed on disk. Your draft is kept; reload to see the current file.
                </p>
              )}
              <IssueList issues={rawIssues} />
              <div className="exo-plugin-raw-actions">
                <button
                  type="button"
                  onClick={() => void saveRaw()}
                  disabled={!writable || config.busy || !rawDirty || notReadable}
                >
                  Save
                </button>
                <button type="button" onClick={() => void reloadRaw()} disabled={config.busy}>
                  Reload
                </button>
                <button type="button" onClick={() => setRawOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {status && (
        <p className="exo-settings-hint" role="status">
          {status}
        </p>
      )}

      {workspace.phase === 'ready' && <PluginLog entries={host.log} />}
    </section>
  )
}

export function PluginLog({ entries }: { entries: PluginLogEntry[] }) {
  if (entries.length === 0) return null
  return (
    <section className="exo-plugin-log" aria-labelledby="exo-plugin-log-title">
      <h4 id="exo-plugin-log-title">Plugin log</h4>
      <ul>
        {entries.map((entry, index) => (
          <li key={`${entry.at}:${entry.phase}:${entry.code ?? ''}:${index}`}>
            <time dateTime={new Date(entry.at).toISOString()}>
              {new Date(entry.at).toLocaleTimeString()}
            </time>{' '}
            <code>{entry.pluginId ?? entry.manifestUrl ?? 'shell'}</code> {entry.phase}
            {entry.code && (
              <>
                {' '}
                <code>{entry.code}</code>
              </>
            )}
            {entry.message && <span> — {entry.message}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
