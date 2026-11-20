import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  usePluginConfig,
  usePluginHost,
  usePluginSettings,
  useWorkspaceRuntime,
  useWorkspaceSnapshot,
} from '../workspace/context'
import type { PluginHostRecord, PluginLogEntry } from '../plugins/host'
import type { WorkspacePath } from '../workspace/contract'
import type { ManifestConfiguration, ManifestSetting, SettingValue } from '../plugins/manifest'
import type { PluginSettingsView } from '../plugins/settings'
import { ClosePromptDialog } from '../components/ClosePromptDialog'
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

function commandTargetLabel(command: PluginHostRecord['commands'][number]): string {
  if (command.target === 'activeEditor') return 'active editor'
  return `${command.target.kind === 'panel' ? 'panel' : 'content view'} ${command.target.id}`
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
    case 'active': {
      const labels = [
        ...record.registrations.map((editor) => editor.label),
        ...record.panels.map((panel) => panel.title),
        ...record.contentViews.map((view) => view.title),
        ...record.commands.map((command) => command.title),
      ]
      return labels.length === 0 ? 'Active (no contributions)' : `Active — ${labels.join(', ')}`
    }
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
      {record.panels.length > 0 && (
        <p className="exo-plugin-views">
          Panels:{' '}
          {record.panels.map((panel) => (
            <code key={panel.id}>
              {panel.title} ({panel.location})
            </code>
          ))}
        </p>
      )}
      {record.contentViews.length > 0 && (
        <p className="exo-plugin-views">
          Content views:{' '}
          {record.contentViews.map((view) => (
            <code key={view.id}>{view.title}</code>
          ))}
        </p>
      )}
      {record.commands.length > 0 && (
        <p className="exo-plugin-commands">
          Commands:{' '}
          {record.commands.map((command) => (
            <code key={command.id}>
              {command.title} ({commandTargetLabel(command)})
            </code>
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

function settingControlId(identity: string, key: string): string {
  const encode = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-')
  return `exo-plugin-setting-${encode(identity)}-${encode(key)}`
}

function invalidSettingMessage(setting: ManifestSetting): string {
  if (setting.type === 'number') return 'Enter a finite number.'
  if (setting.enum) return 'Choose one of the listed values.'
  return 'Use at most 4096 characters.'
}

function SettingInput({
  identity,
  name,
  setting,
  value,
}: {
  identity: string
  name: string
  setting: ManifestSetting
  value: SettingValue
}) {
  const runtime = useWorkspaceRuntime()
  const controlId = settingControlId(identity, name)
  const initialDraft = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  const [draft, setDraft] = useState(initialDraft)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof value === 'string' || typeof value === 'number') setDraft(String(value))
  }, [value])

  const commit = (next: SettingValue) => {
    const result = runtime.pluginSettings.set(identity, name, next)
    if (!result.ok) {
      setError(invalidSettingMessage(setting))
      return
    }
    setError(null)
    if (typeof next === 'string' || typeof next === 'number') setDraft(String(next))
  }

  const commitDraft = () => {
    if (setting.type === 'number') {
      const trimmed = draft.trim()
      const parsed = Number(trimmed)
      if (trimmed.length === 0 || !Number.isFinite(parsed)) {
        setError('Enter a finite number.')
        return
      }
      commit(parsed)
      return
    }
    if (setting.type === 'string') commit(draft)
  }

  let control
  if (setting.type === 'boolean') {
    control = (
      <input
        id={controlId}
        type="checkbox"
        checked={value === true}
        onChange={(event) => commit(event.target.checked)}
      />
    )
  } else if (setting.enum) {
    const selected = setting.enum.findIndex((option) => option === value)
    control = (
      <select
        id={controlId}
        value={selected >= 0 ? String(selected) : '0'}
        onChange={(event) => {
          const option = setting.enum?.[Number(event.target.value)]
          if (option !== undefined) commit(option)
        }}
      >
        {setting.enum.map((option, index) => (
          <option key={`${String(option)}:${index}`} value={index}>
            {String(option)}
          </option>
        ))}
      </select>
    )
  } else {
    control = (
      <input
        id={controlId}
        type={setting.type === 'number' ? 'number' : 'text'}
        step={setting.type === 'number' ? 'any' : undefined}
        maxLength={setting.type === 'string' ? 4096 : undefined}
        value={draft}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${controlId}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitDraft()
          }
        }}
      />
    )
  }

  return (
    <div className="exo-plugin-setting">
      <label htmlFor={controlId}>{name}</label>
      {setting.description && <p className="exo-settings-hint">{setting.description}</p>}
      {control}
      {error && (
        <p id={`${controlId}-error`} className="exo-plugin-setting-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function PluginSettingFields({
  identity,
  configuration,
  view,
  canReceiveEvents,
}: {
  identity: string
  configuration: ManifestConfiguration
  view: PluginSettingsView | undefined
  canReceiveEvents: boolean
}) {
  const entries = Object.entries(configuration.properties)
  if (entries.length === 0) return null
  return (
    <fieldset className="exo-plugin-settings">
      <legend>Settings</legend>
      {view?.issues.map((issue) => (
        <p key={issue.key} className="exo-settings-warning" role="alert">
          The stored value for <code>{issue.key}</code> is invalid; using its default.
        </p>
      ))}
      {entries.map(([name, setting]) => (
        <SettingInput
          key={name}
          identity={identity}
          name={name}
          setting={setting}
          value={view?.values[name] ?? setting.default}
        />
      ))}
      {!canReceiveEvents && (
        <p className="exo-settings-hint">
          This plugin does not subscribe to configuration changes. New values apply the next time an
          editor opens.
        </p>
      )}
    </fieldset>
  )
}

export function PluginSettings() {
  const runtime = useWorkspaceRuntime()
  const workspace = useWorkspaceSnapshot()
  const config = usePluginConfig()
  const host = usePluginHost()
  const settings = usePluginSettings()
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
  const [pendingPluginAction, setPendingPluginAction] = useState<{
    paths: WorkspacePath[]
    run: () => Promise<void> | void
    error: string | null
  } | null>(null)
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

  const identityFor = (manifestUrl: string) =>
    host.records.find((record) => record.manifestUrl === manifestUrl)?.identity

  const guardPluginAction = (identity: string | undefined, run: () => Promise<void> | void) => {
    const paths = identity ? runtime.documents.dirtyPathsFor(identity) : []
    if (paths.length === 0) {
      void run()
      return
    }
    setPendingPluginAction({ paths, run, error: null })
  }

  const toggle = (entry: PluginConfigEntry) => {
    if (!canMutate) return
    setIssues([])
    guardPluginAction(identityFor(entry.manifest), async () => {
      recordIssues(await store.setEnabled(entry.index, !entry.enabled))
    })
  }

  const remove = (entry: PluginConfigEntry) => {
    if (!canMutate) return
    setIssues([])
    guardPluginAction(identityFor(entry.manifest), async () => {
      recordIssues(await store.removeEntry(entry.index))
    })
  }

  const savePendingPluginAction = async () => {
    if (!pendingPluginAction) return
    for (const path of pendingPluginAction.paths) {
      if (!(await runtime.documents.save(path))) {
        setPendingPluginAction({
          ...pendingPluginAction,
          error: `Could not save ${path}. The plugin was not changed.`,
        })
        return
      }
    }
    const run = pendingPluginAction.run
    setPendingPluginAction(null)
    await run()
  }

  const discardPendingPluginAction = () => {
    if (!pendingPluginAction) return
    const run = pendingPluginAction.run
    setPendingPluginAction(null)
    void run()
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
    <>
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

            {settings.storage !== 'ok' && (
              <p className="exo-settings-warning" role="status">
                {settings.storage === 'read-failed'
                  ? 'Stored plugin settings could not be read. Defaults are in use.'
                  : 'Plugin settings could not be saved. Changes apply for this session only.'}
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
                {config.entries.map((entry) => {
                  const record = host.records.find(
                    (candidate) => candidate.manifestUrl === entry.manifest,
                  )
                  return (
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
                        record={record}
                        onReview={(identity) => runtime.pluginHost.requestConsent(identity)}
                        onRevoke={(identity) =>
                          guardPluginAction(identity, () =>
                            runtime.pluginHost.revokeConsent(identity),
                          )
                        }
                      />
                      {record?.identity && record.manifest?.configuration && (
                        <PluginSettingFields
                          identity={record.identity}
                          configuration={record.manifest.configuration}
                          view={settings.plugins[record.identity]}
                          canReceiveEvents={record.manifest.permissions.includes(
                            'events:subscribe',
                          )}
                        />
                      )}
                    </li>
                  )
                })}
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
                  Adding records the URL and starts loading the manifest. The plugin still needs
                  your consent before a frame is mounted.
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
      {pendingPluginAction && (
        <ClosePromptDialog
          paths={pendingPluginAction.paths}
          error={pendingPluginAction.error}
          onSave={() => void savePendingPluginAction()}
          onDiscard={discardPendingPluginAction}
          onCancel={() => setPendingPluginAction(null)}
        />
      )}
    </>
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
