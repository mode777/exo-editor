import { useEffect, useState } from 'react'
import type { PluginHostRecord, PluginLogEntry } from '../plugins/host'
import type {
  ManifestConfiguration,
  ManifestSetting,
  PluginPermission,
  SettingValue,
} from '../plugins/manifest'
import type { PluginSettingsView } from '../plugins/settings'
import { useWorkspaceRuntime } from '../workspace/context'
import type { PluginConfigIssue } from '../plugins/config'

export function issueMessage(issue: PluginConfigIssue): string {
  const where = issue.entryIndex === undefined ? 'exo.json' : `Entry ${issue.entryIndex + 1}`
  switch (issue.code) {
    case 'invalid-json':
      return 'exo.json is not valid JSON.'
    case 'unsupported-version':
      return 'exo.json uses a schema version this shell does not support.'
    case 'invalid-config':
      if (issue.field?.endsWith('/manifest')) {
        return `${where} has an invalid manifest URL. Use an absolute https URL or http://localhost.`
      }
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

export function IssueList({ issues }: { issues: PluginConfigIssue[] }) {
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

export function commandTargetLabel(command: {
  target: 'activeEditor' | { kind: 'panel' | 'contentView'; id: string }
}): string {
  if (command.target === 'activeEditor') return 'active editor'
  return `${command.target.kind === 'panel' ? 'panel' : 'content view'} ${command.target.id}`
}

export function phaseText(record: PluginHostRecord | undefined): string {
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

export function permissionLabel(permission: PluginPermission): string {
  switch (permission) {
    case 'workspace:read':
      return 'Read workspace files when asked'
    case 'workspace:write':
      return 'Save workspace files when asked'
    case 'workspace:list':
      return 'List one directory level when asked'
    case 'events:subscribe':
      return 'Receive workspace events'
  }
}

/** A read-only status block. Actions are shown only when callbacks are given. */
export function RuntimeRow({
  record,
  onReview,
  onRevoke,
}: {
  record: PluginHostRecord | undefined
  onReview?: (identity: string) => void
  onRevoke?: (identity: string) => void
}) {
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  if (!record) {
    return <p className="exo-plugin-status">Not loaded yet</p>
  }
  const canReview =
    Boolean(onReview) &&
    (record.phase === 'awaiting-consent' ||
      record.phase === 'denied' ||
      record.consent === 'revoked') &&
    Boolean(record.identity)
  const canRevoke =
    Boolean(onRevoke) &&
    Boolean(record.identity) &&
    (record.phase === 'active' || record.phase === 'registering')

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
      {(canReview || canRevoke) && record.identity && (
        <div className="exo-plugin-runtime-actions">
          {canReview && onReview && (
            <button type="button" onClick={() => onReview(record.identity as string)}>
              Review consent
            </button>
          )}
          {canRevoke && onRevoke && (
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

export function PluginSettingFields({
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
