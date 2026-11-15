import { useWorkspaceSnapshot } from '../workspace/context'
import { workspaceErrorMessage } from '../workspace/contract'

interface WorkspaceSettingsProps {
  onOpenFolder: () => void
  onConnectRemote: () => void
  onDisconnect: () => void
  onRemoveRemote: (id: string) => void
}

/** Workspace section of the shell settings: provider, connection and actions. */
export function WorkspaceSettings({
  onOpenFolder,
  onConnectRemote,
  onDisconnect,
  onRemoveRemote,
}: WorkspaceSettingsProps) {
  const snapshot = useWorkspaceSnapshot()
  const remote = snapshot.remote
  const ready = snapshot.phase === 'ready'

  return (
    <section className="exo-settings-section" aria-labelledby="exo-settings-workspace">
      <h3 id="exo-settings-workspace">Workspace</h3>
      {ready ? (
        <>
          <p className="exo-settings-value">
            {remote ? `Stratofold: ${remote.name}` : `Folder: ${snapshot.descriptor?.name ?? ''}`}
          </p>
          {remote && (
            <dl className="exo-settings-details">
              <dt>Server</dt>
              <dd>{remote.server}</dd>
              <dt>Directory</dt>
              <dd>{remote.vdir}</dd>
              <dt>Access</dt>
              <dd>
                {remote.role === 'editor' ? 'Editor (read and write)' : 'Read only'}
                {remote.stored ? ' · stored in this browser' : ' · this session only'}
              </dd>
            </dl>
          )}
          {snapshot.writable === false && (
            <p className="exo-dialog-hint">
              This workspace is read-only. Editing and save actions are disabled.
            </p>
          )}
          {remote?.rejected && (
            <p className="exo-dialog-error" role="alert">
              The remote credential was rejected. Reconnect to continue.
            </p>
          )}
          <div className="exo-settings-actions">
            <button type="button" onClick={onConnectRemote}>
              Connect Remote Workspace…
            </button>
            {remote && (
              <>
                <button type="button" onClick={onDisconnect}>
                  Disconnect
                </button>
                <button type="button" onClick={() => onRemoveRemote(remote.id)}>
                  Remove from Recent Workspaces
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="exo-settings-value">No workspace is open.</p>
          {snapshot.unsupportedReason && (
            <p className="exo-dialog-hint">{snapshot.unsupportedReason}</p>
          )}
          <div className="exo-settings-actions">
            <button type="button" onClick={onOpenFolder}>
              Open Folder…
            </button>
            <button type="button" onClick={onConnectRemote}>
              Connect Remote Workspace…
            </button>
          </div>
        </>
      )}
      {snapshot.error && (
        <p className="exo-dialog-error" role="alert">
          {workspaceErrorMessage(snapshot.error.code, snapshot.error.path)}
        </p>
      )}
      {snapshot.remoteError && (
        <p className="exo-dialog-error" role="alert">
          {snapshot.remoteError.message}
        </p>
      )}
      <p className="exo-dialog-hint">
        Remote workspaces are optional. Connections and their tokens are stored in this browser
        until you remove them. A folder workspace stays local to this browser.
      </p>
    </section>
  )
}
