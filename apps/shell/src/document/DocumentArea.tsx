import { useCallback, useEffect } from 'react'
import type { WorkbenchTab } from 'vscode-workbench'
import { workspaceErrorMessage, type WorkspacePath } from '../workspace/contract'
import {
  useDocument,
  usePluginHost,
  useWorkspaceRuntime,
  useWorkspaceSnapshot,
} from '../workspace/context'
import { contentViewOf } from '../workbench/tabs'
import { ContentViewSurface } from './ContentViewSurface'

export function DocumentArea({ tab }: { tab: WorkbenchTab }) {
  const content = contentViewOf(tab)
  if (content) return <ContentViewSurface content={content} />
  if (!tab.path || tab.kind !== 'file') {
    return <div className="exo-document-placeholder">No editor is available for {tab.title}.</div>
  }
  return <DocumentSurface key={tab.path} path={tab.path} />
}

function DocumentSurface({ path }: { path: WorkspacePath }) {
  const runtime = useWorkspaceRuntime()
  const snapshot = useWorkspaceSnapshot()
  const host = usePluginHost()
  const document = useDocument(path)

  const bindSurface = useCallback(
    (element: HTMLDivElement | null) => {
      runtime.handlers.attachSurface(path, element)
    },
    [path, runtime],
  )

  useEffect(() => {
    if (!document) void runtime.documents.open(path)
  }, [document, path, runtime])

  if (!document || document.status === 'loading') {
    return (
      <div className="exo-document">
        <p className="exo-document-state">Loading…</p>
      </div>
    )
  }

  const plugin = document.surface === 'plugin'
  const pluginFailed = plugin && document.pluginPhase === 'failed'
  const identity = document.editor?.identity
  const activePlugin = identity
    ? host.records.find(
        (record) => record.identity === identity && record.phase === 'active' && record.manifest,
      )
    : undefined
  const editorActions =
    plugin && document.pluginPhase === 'active' && identity && activePlugin
      ? activePlugin.commands.filter(
          (command) => command.target === 'activeEditor' && command.menus.includes('editor/title'),
        )
      : []
  const readOnly =
    snapshot.writable === false ||
    document.readOnly ||
    document.external === 'deleted' ||
    (plugin && !pluginFailed && document.editor?.canWrite === false)

  return (
    <div className="exo-document">
      {editorActions.length > 0 && identity && activePlugin?.manifest && (
        <div
          className="exo-document-actions-bar"
          role="toolbar"
          aria-label={`Actions from ${activePlugin.manifest.name}`}
        >
          {editorActions.map((command) => (
            <button
              type="button"
              key={command.id}
              className="exo-document-action"
              aria-label={`${command.title} (${activePlugin.manifest?.name})`}
              onClick={() => {
                void runtime.commands.invoke(identity, command.id, 'editorTitle')
              }}
            >
              {command.title}
            </button>
          ))}
        </div>
      )}

      {plugin &&
        snapshot.writable !== false &&
        document.editor?.canWrite === false &&
        document.pluginPhase !== 'failed' && (
          <div className="exo-document-banner" role="status">
            Read-only editor
          </div>
        )}

      {document.pluginNotice && (
        <div className="exo-document-banner" role="status">
          {document.pluginNotice}
        </div>
      )}

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

      {document.pluginError && document.pluginPhase !== 'failed' && (
        <div className="exo-document-banner is-error" role="alert">
          {pluginErrorMessage(document.pluginError)}
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

      {plugin && document.editor?.rendering === 'frame' && document.pluginPhase !== 'failed' && (
        <div
          ref={bindSurface}
          className="exo-plugin-surface"
          aria-label={`Plugin editor for ${document.title}`}
        />
      )}

      {plugin && document.pluginPhase === 'mounting' && (
        <div className="exo-document-state">
          <h2>Starting plugin editor</h2>
          <p>{document.editor?.pluginName} is opening this file.</p>
        </div>
      )}

      {pluginFailed && (
        <div className="exo-document-state">
          <h2>The plugin editor could not start</h2>
          <p>
            {document.pluginError ? pluginErrorMessage(document.pluginError) : 'The editor failed.'}
          </p>
          {document.dirty && (
            <p>
              This editor reported unsaved changes. They live only inside the plugin frame and
              cannot be recovered after it closes.
            </p>
          )}
          <div className="exo-document-actions">
            <button type="button" onClick={() => void runtime.documents.reload(path)}>
              Retry editor
            </button>
            <button type="button" onClick={() => void runtime.documents.openInText(path)}>
              Open in text editor
            </button>
          </div>
        </div>
      )}

      {plugin &&
        document.editor?.rendering !== 'frame' &&
        document.pluginPhase === 'active' &&
        !document.dirty && (
          <p className="exo-document-plugin-idle" role="status">
            Opened with {document.editor?.label}. Edits are reported by the plugin.
          </p>
        )}
    </div>
  )
}

function pluginErrorMessage(error: { code: string; message?: string }): string {
  switch (error.code) {
    case 'permission-denied':
      return 'The plugin is not allowed to save this file.'
    case 'timeout':
      return 'The plugin did not answer the save request in time. Your changes are still in the editor and the tab stays dirty.'
    case 'conflict':
      return 'The file changed on disk. The newer content was kept and the tab stays dirty.'
    case 'not-found':
      return 'The file no longer exists. Saving will not recreate it.'
    case 'rate-limited':
      return 'The plugin sent messages too quickly. Try again.'
    case 'protocol-violation':
      return 'The plugin broke the editor protocol and was stopped.'
    default:
      return error.message ?? 'The plugin editor failed.'
  }
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
