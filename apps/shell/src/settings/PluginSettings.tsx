import { useEffect, useRef, useState } from 'react'
import {
  usePluginConfig,
  usePluginHost,
  useWorkspaceRuntime,
  useWorkspaceSnapshot,
} from '../workspace/context'
import type { PluginHostRecord } from '../plugins/host'
import { IssueList, PluginLog, RuntimeRow } from '../components/PluginUi'
import { emptyExoConfig, serializeExoConfig, type PluginConfigIssue } from '../plugins/config'

const EMPTY_TEMPLATE = serializeExoConfig(emptyExoConfig())

function statusRecord(records: PluginHostRecord[], manifest: string): PluginHostRecord | undefined {
  return records.find((record) => record.manifestUrl === manifest)
}

export function PluginSettings({ onClose }: { onClose?: () => void }) {
  const runtime = useWorkspaceRuntime()
  const workspace = useWorkspaceSnapshot()
  const config = usePluginConfig()
  const host = usePluginHost()
  const store = runtime.pluginConfig

  const writable = workspace.phase === 'ready' && workspace.writable
  const notReadable = config.status === 'invalid' && config.version === null && config.text === null
  const configText = config.text ?? (config.status === 'absent' ? EMPTY_TEMPLATE : '')

  const [rawOpen, setRawOpen] = useState(false)
  const [rawText, setRawText] = useState('')
  const [rawDirty, setRawDirty] = useState(false)
  const [rawIssues, setRawIssues] = useState<PluginConfigIssue[]>([])
  const [rawChangedExternally, setRawChangedExternally] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const rawSavedText = useRef(EMPTY_TEMPLATE)

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
        Plugin debugging
      </h3>

      <p className="exo-settings-hint">
        Install, enable, remove and configure plugins in the{' '}
        <button
          type="button"
          className="exo-link-button"
          onClick={() => {
            runtime.showPanel('extensions', 'primary')
            onClose?.()
          }}
        >
          Extensions
        </button>{' '}
        view. This section keeps raw exo.json editing, validation issues, runtime status and the
        plugin log.
      </p>

      {workspace.phase !== 'ready' ? (
        <p className="exo-settings-hint">
          Open a folder to inspect workspace plugin configuration.
        </p>
      ) : (
        <>
          {!writable && (
            <p className="exo-settings-warning" role="status">
              This workspace is read-only. Raw exo.json editing is disabled.
            </p>
          )}

          {config.status === 'idle' || config.status === 'loading' ? (
            <p className="exo-settings-hint" role="status">
              Loading exo.json…
            </p>
          ) : null}

          {config.status === 'absent' && (
            <p className="exo-settings-hint">
              No exo.json is present. Open Extensions to install the first plugin.
            </p>
          )}

          {config.status === 'invalid' && <IssueList issues={config.issues} />}

          {config.status === 'valid' && (
            <ul className="exo-plugin-list" aria-label="Plugin runtime status">
              {config.entries.map((entry) => (
                <li className="exo-plugin-entry" key={`${entry.index}:${entry.manifest}`}>
                  <code className="exo-plugin-manifest">{entry.manifest}</code>
                  <p className="exo-settings-hint">{entry.enabled ? 'Enabled' : 'Disabled'}</p>
                  <RuntimeRow record={statusRecord(host.records, entry.manifest)} />
                </li>
              ))}
            </ul>
          )}

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

export { PluginLog, RuntimeRow } from '../components/PluginUi'
