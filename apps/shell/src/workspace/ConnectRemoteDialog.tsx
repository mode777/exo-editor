import { useEffect, useRef, useState } from 'react'
import {
  connectRequestFromConnectionString,
  type ConnectRequest,
} from './providers/stratofold/connection'
import { useWorkspaceRuntime, useWorkspaceSnapshot } from './context'

interface ConnectRemoteDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * Connects a Stratofold workspace. The token is never prefilled - the shell
 * keeps it out of the snapshot - and the remember choice is off by default.
 */
export function ConnectRemoteDialog({ open, onClose }: ConnectRemoteDialogProps) {
  const runtime = useWorkspaceRuntime()
  const snapshot = useWorkspaceSnapshot()
  const [server, setServer] = useState('')
  const [token, setToken] = useState('')
  const [vdir, setVdir] = useState('')
  const [connectionString, setConnectionString] = useState('')
  const [connectionStringError, setConnectionStringError] = useState<string | null>(null)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serverInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setServer(snapshot.remote?.server ?? '')
    setToken('')
    setVdir(snapshot.remote?.vdir ?? '')
    setConnectionString('')
    setConnectionStringError(null)
    setRemember(snapshot.remote?.remembered ?? false)
    setError(null)
    setBusy(false)
    serverInput.current?.focus()
  }, [open, snapshot.remote?.server, snapshot.remote?.vdir, snapshot.remote?.remembered])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

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

    const connected = await runtime.connectRemote(request, { remember })
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

  return (
    <div className="exo-dialog-backdrop">
      <div
        className="exo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exo-connect-title"
      >
        <h2 id="exo-connect-title">Connect Remote Workspace</h2>
        <p className="exo-dialog-hint">
          The browser talks to the server directly. The token is sent only in a request header and
          is never placed in a URL or shown to a plugin.
        </p>
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
        <label className="exo-settings-option">
          <input
            id="exo-connect-remember"
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember this connection in this browser
        </label>
        <p className="exo-dialog-hint">
          Remembering stores the token in this browser so the workspace can reopen after a reload.
          Forget it by disconnecting.
        </p>
        {(connectionStringError ?? error ?? snapshot.remoteError?.message) && (
          <p className="exo-dialog-error" role="alert">
            {connectionStringError ?? error ?? snapshot.remoteError?.message}
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
