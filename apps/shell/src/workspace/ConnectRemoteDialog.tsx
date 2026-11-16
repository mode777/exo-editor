import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectRequestFromConnectionString,
  type ConnectRequest,
} from './providers/stratofold/connection'
import { useModalDialog } from '../components/useModalDialog'
import { useWorkspaceRuntime, useWorkspaceSnapshot } from './context'
import type { RemoteWorkspaceSummary } from './runtime'

interface ConnectRemoteDialogProps {
  open: boolean
  onClose: () => void
}

const ROLE_LABEL: Record<RemoteWorkspaceSummary['role'], string> = {
  editor: 'Editor',
  viewer: 'Read only',
  public: 'Public',
}

/**
 * Connects a Stratofold workspace and lists the recent ones. The token is never
 * prefilled or rendered - the shell keeps it out of the snapshot - and every
 * stored entry can be removed from this dialog.
 */
export function ConnectRemoteDialog({ open, onClose }: ConnectRemoteDialogProps) {
  const runtime = useWorkspaceRuntime()
  const snapshot = useWorkspaceSnapshot()
  const [server, setServer] = useState('')
  const [token, setToken] = useState('')
  const [vdir, setVdir] = useState('')
  const [connectionString, setConnectionString] = useState('')
  const [connectionStringError, setConnectionStringError] = useState<string | null>(null)
  const [recents, setRecents] = useState<RemoteWorkspaceSummary[]>([])
  const [recentsError, setRecentsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serverInput = useRef<HTMLInputElement>(null)
  const dialogRef = useModalDialog({
    open,
    onClose,
    initialFocus: () => serverInput.current,
  })

  const loadRecents = useCallback(async () => {
    try {
      setRecents(await runtime.listRemoteConnections())
      setRecentsError(null)
    } catch (caught) {
      setRecentsError(
        caught instanceof Error ? caught.message : 'The recent workspaces could not be read.',
      )
    }
  }, [runtime])

  useEffect(() => {
    if (!open) return
    setServer(snapshot.remote?.server ?? '')
    setToken('')
    setVdir(snapshot.remote?.vdir ?? '')
    setConnectionString('')
    setConnectionStringError(null)
    setError(null)
    setBusy(false)
  }, [open, snapshot.remote?.server, snapshot.remote?.vdir])

  useEffect(() => {
    if (!open) return
    void loadRecents()
  }, [open, loadRecents])

  if (!open) return null

  const canSubmit =
    connectionString.trim() !== '' ||
    (server.trim() !== '' && (token.trim() !== '' || vdir.trim() !== ''))

  const applyConnectionString = (value: string): boolean => {
    const trimmed = value.trim()
    if (trimmed === '') return false
    try {
      const parsed = connectRequestFromConnectionString(trimmed)
      setServer(parsed.server)
      setVdir(parsed.vdir ?? '')
      setToken(parsed.token ?? '')
      setConnectionString('')
      setConnectionStringError(null)
      return true
    } catch {
      return false
    }
  }

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    setConnectionStringError(null)

    let request: ConnectRequest = {
      server: server.trim(),
      token: token.trim() === '' ? undefined : token.trim(),
      vdir: vdir.trim() === '' ? undefined : vdir.trim(),
    }
    if (connectionString.trim() !== '') {
      try {
        request = connectRequestFromConnectionString(connectionString.trim(), {
          server: server.trim() === '' ? undefined : server.trim(),
        })
        setConnectionString('')
      } catch (caught) {
        setBusy(false)
        setConnectionStringError(
          caught instanceof Error ? caught.message : 'The connection string is not valid.',
        )
        return
      }
    }

    const connected = await runtime.connectRemote(request)
    setBusy(false)
    if (!connected) {
      setError(
        runtime.getSnapshot().remoteError?.message ?? 'The connection could not be established.',
      )
      // Do not keep a rejected credential in the form.
      setToken('')
      return
    }
    setConnectionString('')
    setToken('')
    onClose()
  }

  const openRecent = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const connected = await runtime.openRemoteRecent(id)
    setBusy(false)
    if (!connected) {
      setError(
        runtime.getSnapshot().remoteError?.message ?? 'The recent workspace could not be opened.',
      )
      return
    }
    setConnectionString('')
    setToken('')
    onClose()
  }

  const removeRecent = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const removed = await runtime.removeRemoteConnection(id)
    if (!removed) {
      setError(
        runtime.getSnapshot().remoteError?.message ?? 'The recent workspace could not be removed.',
      )
    }
    await loadRecents()
    setBusy(false)
  }

  return (
    <div className="exo-dialog-backdrop">
      <div
        ref={dialogRef}
        className="exo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exo-connect-title"
      >
        <h2 id="exo-connect-title">Connect Remote Workspace</h2>
        {recents.length > 0 && (
          <section className="exo-recents" aria-labelledby="exo-recents-title">
            <h3 id="exo-recents-title">Recent workspaces</h3>
            <ul className="exo-recent-list">
              {recents.map((recent) => (
                <li key={recent.id} className="exo-recent-row">
                  <span className="exo-recent-details">
                    <span className="exo-recent-name">{recent.name}</span>
                    <span className="exo-recent-meta">
                      {recent.server} · {recent.vdir} · {ROLE_LABEL[recent.role]}
                    </span>
                  </span>
                  <span className="exo-recent-actions">
                    <button
                      type="button"
                      aria-label={`Open ${recent.name}`}
                      disabled={busy}
                      onClick={() => void openRecent(recent.id)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${recent.name}`}
                      disabled={busy}
                      onClick={() => void removeRecent(recent.id)}
                    >
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="exo-dialog-hint">
          The browser talks to the server directly. The token is sent only in a request header and
          is never placed in a URL or shown to a plugin.
        </p>
        <p className="exo-dialog-hint">
          Connections and their tokens are stored in this browser so you can reopen them. Remove a
          workspace from the list to delete its token.
        </p>
        {snapshot.remote?.stored === false && (
          <p className="exo-dialog-hint">
            This connection could not be stored. It works for this session only.
          </p>
        )}
        <label className="exo-dialog-field">
          <span>Connection string</span>
          <input
            id="exo-connect-connection-string"
            type="password"
            value={connectionString}
            placeholder="sfconn_v1_…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value
              setConnectionString(value)
              setConnectionStringError(null)
              applyConnectionString(value)
            }}
          />
        </label>
        <p className="exo-dialog-hint">
          Paste a connection string to fill the server, directory and token. It is read locally and
          discarded.
        </p>
        <label className="exo-dialog-field">
          <span>Server URL</span>
          <input
            ref={serverInput}
            id="exo-connect-server"
            type="url"
            value={server}
            placeholder="https://files.example.com"
            autoComplete="off"
            onChange={(event) => setServer(event.target.value)}
          />
        </label>
        <label className="exo-dialog-field">
          <span>Access token</span>
          <input
            id="exo-connect-token"
            type="password"
            value={token}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <label className="exo-dialog-field">
          <span>
            {token.trim() === '' ? 'Directory id (public)' : 'Directory id (checked if given)'}
          </span>
          <input
            id="exo-connect-vdir"
            type="text"
            value={vdir}
            autoComplete="off"
            onChange={(event) => setVdir(event.target.value)}
          />
        </label>
        {(connectionStringError ?? error ?? recentsError ?? snapshot.remoteError?.message) && (
          <p className="exo-dialog-error" role="alert">
            {connectionStringError ?? error ?? recentsError ?? snapshot.remoteError?.message}
          </p>
        )}
        <div className="exo-dialog-actions">
          <button type="button" onClick={() => void submit()} disabled={!canSubmit || busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
