import { useEffect } from 'react'
import type { WorkbenchTab } from 'vscode-workbench'
import { workspaceErrorMessage, type WorkspacePath } from '../workspace/contract'
import { useDocument, useWorkspaceRuntime, useWorkspaceSnapshot } from '../workspace/context'

export function DocumentArea({ tab }: { tab: WorkbenchTab }) {
  if (!tab.path || tab.kind !== 'file') {
    return <div className="exo-document-placeholder">No editor is available for {tab.title}.</div>
  }
  return <DocumentSurface key={tab.path} path={tab.path} />
}

function DocumentSurface({ path }: { path: WorkspacePath }) {
  const runtime = useWorkspaceRuntime()
  const snapshot = useWorkspaceSnapshot()
  const document = useDocument(path)

  useEffect(() => {
    if (!document) void runtime.documents.open(path)
  }, [document, path, runtime])

  if (!document || document.status === 'loading') {
    return (
      <div className="exo-document">
        <div className="exo-document-header">
          <span className="exo-document-title">{path}</span>
        </div>
        <p className="exo-document-state">Loading…</p>
      </div>
    )
  }

  const readOnly =
    snapshot.writable === false || document.readOnly || document.external === 'deleted'

  return (
    <div className="exo-document">
      <div className="exo-document-header">
        <span className="exo-document-title" title={path}>
          {document.title}
        </span>
        <span className="exo-document-meta">
          {document.status === 'ready' ? formatBytes(document.size) : ''}
        </span>
        {document.status === 'ready' && !readOnly && (
          <button
            type="button"
            className="exo-document-save"
            disabled={!document.dirty}
            onClick={() => void runtime.documents.save(path)}
          >
            Save
          </button>
        )}
        {snapshot.writable === false && <span className="exo-document-readonly">Read-only</span>}
      </div>

      {document.external === 'deleted' && (
        <div className="exo-document-banner is-error" role="alert">
          This file was deleted on disk. The open tab is no longer saved.
        </div>
      )}

      {document.external === 'changed' && (
        <div className="exo-document-banner" role="status">
          <span>
            {document.dirty
              ? 'This file changed on disk. Saving will conflict with the newer content.'
              : 'This file changed on disk.'}
          </span>
          <button
            type="button"
            className="exo-document-action"
            onClick={() => void runtime.documents.reload(path)}
          >
            {document.dirty ? 'Reload and discard edits' : 'Reload'}
          </button>
        </div>
      )}

      {document.error && document.status === 'error' && (
        <div className="exo-document-banner is-error" role="alert">
          <span>{workspaceErrorMessage(document.error, path)}</span>
          <button
            type="button"
            className="exo-document-action"
            onClick={() => void runtime.documents.retry(path)}
          >
            Retry
          </button>
        </div>
      )}

      {document.error && document.status === 'ready' && document.error !== 'conflict' && (
        <div className="exo-document-banner is-error" role="alert">
          {workspaceErrorMessage(document.error, path)}
        </div>
      )}

      {document.status === 'error' && (
        <div className="exo-document-state">
          {workspaceErrorMessage(document.error ?? 'io', path)}
        </div>
      )}

      {document.status === 'no-editor' && (
        <div className="exo-document-state">
          <h2>No editor for this file</h2>
          <p>{noEditorText(document.noEditorReason, document.size)}</p>
        </div>
      )}

      {document.status === 'ready' && (
        <textarea
          key={document.loadId}
          className="exo-document-editor"
          aria-label={`Editor for ${document.title}`}
          defaultValue={document.text}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(event) => runtime.documents.updateText(path, event.target.value)}
        />
      )}
    </div>
  )
}

function noEditorText(
  reason: 'binary' | 'too-large' | 'undecodable' | undefined,
  size: number,
): string {
  switch (reason) {
    case 'binary':
      return 'This looks like a binary file. The shell text editor does not open it.'
    case 'too-large':
      return `This file is ${formatBytes(size)} and is larger than the 10 MiB text limit.`
    case 'undecodable':
      return 'This file is not valid UTF-8, so it cannot be edited as text.'
    default:
      return 'The shell text editor cannot open this file.'
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}
