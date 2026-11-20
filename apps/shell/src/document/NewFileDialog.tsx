import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalDialog } from '../components/useModalDialog'
import type { FileStat, WorkspacePath } from '../workspace/contract'
import { dirname, isReservedPath, joinPath } from '../workspace/paths'
import type { NewFileView } from '../plugins/new-file'

function sortDirectories(entries: FileStat[], caseSensitive: boolean): FileStat[] {
  return entries
    .filter((entry) => entry.kind === 'directory')
    .sort((left, right) =>
      caseSensitive
        ? left.path.localeCompare(right.path)
        : left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
    )
}

function breadcrumbs(path: WorkspacePath): Array<{ name: string; path: WorkspacePath }> {
  const crumbs = [{ name: 'Workspace', path: '/' }]
  if (path === '/') return crumbs
  let next = ''
  for (const segment of path.slice(1).split('/')) {
    next += `/${segment}`
    crumbs.push({ name: segment, path: next })
  }
  return crumbs
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} bytes`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

/**
 * Shell-owned Save As dialog for a manifest template or a runtime request. The
 * plugin supplies only a validated name hint and content; every visible string,
 * the folder browser and the final path are shell-owned.
 */
export function NewFileDialog({
  request,
  onCancel,
  onSubmit,
}: {
  request: NewFileView
  onCancel: () => void
  onSubmit: (directory: WorkspacePath, name: string) => void
}) {
  const caseSensitive = request.session.capabilities().caseSensitive
  const [current, setCurrent] = useState<WorkspacePath>(request.directory)
  const [name, setName] = useState(request.name)
  const [entries, setEntries] = useState<FileStat[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const dialogRef = useModalDialog({
    open: true,
    onClose: onCancel,
    initialFocus: () => nameRef.current,
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setListError(null)
    request.session
      .forPlugin(request.pluginId)
      .list(current)
      .then((result) => {
        if (cancelled) return
        setEntries(
          sortDirectories(
            result.filter((entry) => !isReservedPath(entry.path, caseSensitive)),
            caseSensitive,
          ),
        )
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        if (current !== request.directory) {
          setCurrent(request.directory)
          return
        }
        setEntries([])
        setLoading(false)
        setListError('This folder could not be listed. Choose another folder.')
      })
    return () => {
      cancelled = true
    }
  }, [caseSensitive, current, request])

  const crumbs = useMemo(() => breadcrumbs(current), [current])
  const finalPath = useMemo(() => {
    try {
      return joinPath(current, name.trim())
    } catch {
      return null
    }
  }, [current, name])

  return (
    <div
      className="exo-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="exo-dialog exo-new-file"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exo-new-file-title"
        aria-describedby="exo-new-file-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="exo-new-file-title">New File</h2>
        <p id="exo-new-file-description">
          <strong>
            <bdi>{request.pluginName}</bdi>
          </strong>{' '}
          will create the file you name here. It cannot overwrite an existing file.
        </p>

        <nav className="exo-file-picker-crumbs" aria-label="Folder path">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path}>
              {index > 0 && <span aria-hidden="true"> / </span>}
              <button
                type="button"
                onClick={() => setCurrent(crumb.path)}
                aria-current={crumb.path === current ? 'location' : undefined}
              >
                <bdi>{crumb.name}</bdi>
              </button>
            </span>
          ))}
        </nav>

        <div className="exo-new-file-folders">
          {loading && (
            <p className="exo-file-picker-status" role="status">
              Loading folder…
            </p>
          )}
          {listError && (
            <p className="exo-file-picker-status exo-dialog-error" role="alert">
              {listError}
            </p>
          )}
          {!loading && !listError && (
            <ul aria-label="Folders">
              {current !== '/' && (
                <li>
                  <button type="button" onClick={() => setCurrent(dirname(current))}>
                    <span aria-hidden="true">↰ </span>..
                  </button>
                </li>
              )}
              {entries.map((entry) => (
                <li key={entry.path}>
                  <button type="button" onClick={() => setCurrent(entry.path)}>
                    <span aria-hidden="true">▸ </span>
                    <bdi>{entry.path.slice(entry.path.lastIndexOf('/') + 1)}</bdi>/
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <label className="exo-new-file-name">
          <span>File name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && finalPath) onSubmit(current, name)
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="exo-file-picker-status" role="status">
          {finalPath ? (
            <>
              Creates <code>{finalPath}</code> — {formatBytes(request.size)}
            </>
          ) : (
            'Enter a file name.'
          )}
        </p>

        <div className="exo-new-file-content">
          <p className="exo-settings-hint">
            {request.binary ? 'Binary content' : 'Text content'} · {formatBytes(request.size)}
          </p>
          {request.binary ? (
            <p className="exo-new-file-binary">Binary file: no preview is shown.</p>
          ) : (
            <pre className="exo-new-file-preview" aria-label="Content preview">
              {request.preview}
            </pre>
          )}
        </div>

        {request.error && (
          <p className="exo-dialog-error" role="alert">
            {request.error}
          </p>
        )}

        <div className="exo-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(current, name)}
            disabled={!finalPath || name.trim().length === 0}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
