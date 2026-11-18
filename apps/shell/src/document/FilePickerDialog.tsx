import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useModalDialog } from '../components/useModalDialog'
import type { FileStat, WorkspacePath } from '../workspace/contract'
import { basename, dirname, isReservedPath, normalizePath } from '../workspace/paths'
import type { FilePickerView } from '../plugins/file-picker'

const MAX_SELECTED = 32

interface PickerRow {
  kind: 'parent' | 'entry'
  path: WorkspacePath
  entry?: FileStat
}

function startDirectory(
  request: FilePickerView,
  caseSensitive: boolean,
): { path: WorkspacePath; hinted: boolean } {
  const handlerDir = dirname(request.path)
  if (!request.directory) return { path: handlerDir, hinted: false }
  try {
    const path = normalizePath(request.directory)
    if (isReservedPath(path, caseSensitive)) return { path: handlerDir, hinted: false }
    return { path, hinted: true }
  } catch {
    return { path: handlerDir, hinted: false }
  }
}

function sortEntries(entries: FileStat[], caseSensitive: boolean): FileStat[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return caseSensitive
      ? left.path.localeCompare(right.path)
      : left.path.toLowerCase().localeCompare(right.path.toLowerCase())
  })
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

/**
 * Shell-owned workspace file picker. The plugin supplies only the request
 * metadata; every visible string, the tree and the disclosure are shell-owned.
 */
export function FilePickerDialog({
  request,
  onCancel,
  onSelect,
}: {
  request: FilePickerView
  onCancel: () => void
  onSelect: (paths: WorkspacePath[]) => void
}) {
  const caseSensitive = request.session.capabilities().caseSensitive
  const handlerDir = dirname(request.path)
  const initial = useMemo(() => startDirectory(request, caseSensitive), [request, caseSensitive])
  const [current, setCurrent] = useState<WorkspacePath>(initial.path)
  const [entries, setEntries] = useState<FileStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<WorkspacePath>>(() => new Set())
  const [activeIndex, setActiveIndex] = useState(0)
  const didFallback = useRef(!initial.hinted)
  const shouldFocusRows = useRef(true)
  const rootCrumb = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const dialogRef = useModalDialog({
    open: true,
    onClose: onCancel,
    initialFocus: () => rootCrumb.current,
  })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setActiveIndex(0)
    const facade = request.session.forPlugin(request.pluginId)
    facade
      .list(current)
      .then((result) => {
        if (cancelled) return
        const visible = result.filter((entry) => !isReservedPath(entry.path, caseSensitive))
        setEntries(sortEntries(visible, caseSensitive))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        if (!didFallback.current && current !== handlerDir) {
          didFallback.current = true
          setCurrent(handlerDir)
          return
        }
        setEntries([])
        setLoading(false)
        setError('This folder could not be listed. Choose another folder.')
      })
    return () => {
      cancelled = true
    }
  }, [caseSensitive, current, handlerDir, request])

  const rows = useMemo<PickerRow[]>(() => {
    const result: PickerRow[] = []
    if (current !== '/') result.push({ kind: 'parent', path: dirname(current) })
    for (const entry of entries) result.push({ kind: 'entry', path: entry.path, entry })
    return result
  }, [current, entries])

  const crumbs = useMemo(() => breadcrumbs(current), [current])

  const focusRow = useCallback((index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-picker-row]')
    const next = buttons?.[index]
    if (!next) return
    setActiveIndex(index)
    next.focus()
  }, [])

  useEffect(() => {
    if (loading || !shouldFocusRows.current) return
    shouldFocusRows.current = false
    focusRow(0)
  }, [focusRow, loading, rows.length])

  const navigate = (path: WorkspacePath) => {
    shouldFocusRows.current = true
    setCurrent(path)
  }

  const toggle = (path: WorkspacePath) => {
    const next = new Set(selected)
    if (request.multiple) {
      if (next.has(path)) {
        next.delete(path)
      } else if (next.size < MAX_SELECTED) {
        next.add(path)
      }
    } else {
      next.clear()
      next.add(path)
    }
    setSelected(next)
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (rows.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(Math.min(activeIndex + 1, rows.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(Math.max(activeIndex - 1, 0))
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(rows.length - 1)
    }
  }

  const choose = () => {
    if (selected.size === 0) return
    onSelect([...selected])
  }

  return (
    <div
      className="exo-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="exo-dialog exo-file-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exo-file-picker-title"
        aria-describedby="exo-file-picker-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="exo-file-picker-title">Select workspace files</h2>
        <p id="exo-file-picker-description">
          <strong>
            <bdi>{request.pluginName}</bdi>
          </strong>{' '}
          (
          <code>
            <bdi>{request.pluginId}</bdi>
          </code>
          ) is asking you to choose {request.multiple ? 'workspace files' : 'a workspace file'}. It
          will be able to read the selected {request.multiple ? 'files' : 'file'}.
        </p>

        <nav className="exo-file-picker-crumbs" aria-label="Folder path">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path}>
              {index > 0 && <span aria-hidden="true"> / </span>}
              <button
                ref={index === 0 ? rootCrumb : undefined}
                type="button"
                onClick={() => navigate(crumb.path)}
                aria-current={crumb.path === current ? 'location' : undefined}
              >
                <bdi>{crumb.name}</bdi>
              </button>
            </span>
          ))}
        </nav>

        <div className="exo-file-picker-body">
          {loading && (
            <p className="exo-file-picker-status" role="status">
              Loading folder…
            </p>
          )}
          {error && (
            <p className="exo-file-picker-status exo-dialog-error" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="exo-file-picker-status" role="status">
              This folder is empty.
            </p>
          )}
          {!error && rows.length > 0 && (
            <ul
              ref={listRef}
              className="exo-file-picker-list"
              aria-label="Workspace files"
              onKeyDown={onListKeyDown}
            >
              {rows.map((row, index) => {
                const isDirectory = row.entry?.kind === 'directory'
                const isSelected = row.entry?.kind === 'file' && selected.has(row.path)
                return (
                  <li key={`${row.kind}:${row.path}`}>
                    <button
                      type="button"
                      data-picker-row=""
                      className={`exo-file-picker-row${isSelected ? ' is-selected' : ''}`}
                      tabIndex={index === activeIndex ? 0 : -1}
                      onFocus={() => setActiveIndex(index)}
                      aria-pressed={row.entry?.kind === 'file' ? isSelected : undefined}
                      onClick={() => {
                        if (row.kind === 'parent' || isDirectory) navigate(row.path)
                        else toggle(row.path)
                      }}
                    >
                      <span aria-hidden="true">
                        {row.kind === 'parent'
                          ? '↰ '
                          : isDirectory
                            ? '▸ '
                            : isSelected
                              ? '✓ '
                              : '· '}
                      </span>
                      <bdi>{row.kind === 'parent' ? '..' : basename(row.path)}</bdi>
                      {isDirectory ? '/' : ''}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <p className="exo-file-picker-status" role="status">
          {selected.size} selected
          {request.multiple ? ` (maximum ${MAX_SELECTED})` : ''}
        </p>

        <div className="exo-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={choose} disabled={selected.size === 0 || loading}>
            Select
          </button>
        </div>
      </div>
    </div>
  )
}
