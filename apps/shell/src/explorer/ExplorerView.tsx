import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  workspaceErrorMessage,
  WorkspaceError,
  type FileStat,
  type WorkspaceErrorCode,
} from '../workspace/contract'
import {
  basename,
  dirname,
  isReservedName,
  isReservedPath,
  joinPath,
  pathIsUnder,
  validateEntryName,
} from '../workspace/paths'
import { useWorkspaceRuntime, useWorkspaceSnapshot } from '../workspace/context'
import { onExplorerCommand } from './bus'

interface Row {
  entry: FileStat
  depth: number
}

interface NameDialog {
  kind: 'new-file' | 'new-folder'
  directory: string
  name: string
  error?: string
}

interface DeleteDialog {
  kind: 'delete'
  path: string
  name: string
  directory: boolean
  dirty: boolean
}

type DialogState = NameDialog | DeleteDialog

interface RenameState {
  path: string
  value: string
  directory: boolean
}

const ROOT = '/'

function sortEntries(entries: FileStat[], caseSensitive: boolean): FileStat[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return caseSensitive
      ? left.path.localeCompare(right.path)
      : left.path.toLowerCase().localeCompare(right.path.toLowerCase())
  })
}

export function ExplorerView() {
  const snapshot = useWorkspaceSnapshot()
  return <Explorer key={snapshot.generation} />
}

function Explorer() {
  const runtime = useWorkspaceRuntime()
  const snapshot = useWorkspaceSnapshot()
  const session = runtime.getSession()
  const caseSensitive = snapshot.capabilities?.caseSensitive ?? true
  const writable = snapshot.writable

  const [children, setChildren] = useState<Map<string, FileStat[]>>(() => new Map([[ROOT, []]]))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<Map<string, WorkspaceErrorCode>>(new Map())
  const [rename, setRename] = useState<RenameState | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [context, setContext] = useState<{
    x: number
    y: number
    path: string
  } | null>(null)

  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const shouldFocus = useRef(false)
  const expandedRef = useRef(expanded)
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    expandedRef.current = expanded
  }, [expanded])

  const visible = useMemo(() => {
    const rows: Row[] = []
    const walk = (directory: string, depth: number) => {
      for (const entry of children.get(directory) ?? []) {
        rows.push({ entry, depth })
        if (entry.kind === 'directory' && expanded.has(entry.path)) {
          walk(entry.path, depth + 1)
        }
      }
    }
    walk(ROOT, 0)
    return rows
  }, [children, expanded])

  const load = useMemo(() => {
    return async (path: string) => {
      if (!session || inFlight.current.has(path)) return
      inFlight.current.add(path)
      setLoading((current) => new Set(current).add(path))
      try {
        const entries = await session.list(path)
        const visibleEntries = entries.filter((entry) => !isReservedPath(entry.path, caseSensitive))
        setChildren((current) =>
          new Map(current).set(path, sortEntries(visibleEntries, caseSensitive)),
        )
        setErrors((current) => {
          if (!current.has(path)) return current
          const next = new Map(current)
          next.delete(path)
          return next
        })
      } catch (error) {
        if (error instanceof WorkspaceError && error.code === 'aborted') return
        const code = error instanceof WorkspaceError ? error.code : ('io' as const)
        setErrors((current) => new Map(current).set(path, code))
      } finally {
        inFlight.current.delete(path)
        setLoading((current) => {
          const next = new Set(current)
          next.delete(path)
          return next
        })
      }
    }
  }, [session, caseSensitive])

  useEffect(() => {
    if (snapshot.phase !== 'ready') return
    void load(ROOT)
    for (const path of expandedRef.current) void load(path)
  }, [snapshot.phase, snapshot.explorerRevision, load])

  useEffect(() => {
    if (snapshot.phase !== 'ready') return
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      void load(ROOT)
      for (const path of expandedRef.current) void load(path)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [snapshot.phase, load])

  useEffect(() => {
    runtime.setSelection(selected)
  }, [runtime, selected])

  useEffect(() => {
    if (!shouldFocus.current || !selected) return
    shouldFocus.current = false
    rowRefs.current.get(selected)?.focus()
  }, [selected, visible])

  useEffect(() => {
    if (!context) return
    const close = () => setContext(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [context])

  const focusRow = (path: string) => {
    shouldFocus.current = true
    setSelected(path)
  }

  const toggle = (entry: FileStat) => {
    if (entry.kind !== 'directory') {
      runtime.openDocument(entry.path)
      return
    }
    if (expanded.has(entry.path)) {
      setExpanded((current) => {
        const next = new Set(current)
        next.delete(entry.path)
        return next
      })
      return
    }
    setExpanded((current) => new Set(current).add(entry.path))
    if (!children.has(entry.path)) void load(entry.path)
  }

  const targetDirectory = useMemo(() => {
    if (!selected) return ROOT
    const row = visible.find((candidate) => candidate.entry.path === selected)
    if (!row) return ROOT
    return row.entry.kind === 'directory' ? row.entry.path : dirname(row.entry.path)
  }, [selected, visible])

  const beginCreate = (kind: NameDialog['kind'], directory = targetDirectory) => {
    if (!writable) return
    setDialog({ kind, directory, name: '' })
  }

  const beginRename = (entry?: FileStat) => {
    if (!writable) return
    const target = entry ?? visible.find((candidate) => candidate.entry.path === selected)?.entry
    if (!target) return
    setRename({
      path: target.path,
      value: basename(target.path),
      directory: target.kind === 'directory',
    })
  }

  const requestDelete = (entry?: FileStat) => {
    if (!writable) return
    const target = entry ?? visible.find((candidate) => candidate.entry.path === selected)?.entry
    if (!target) return
    const dirty =
      target.kind === 'directory'
        ? runtime.documents.hasDirtyUnder(target.path)
        : Boolean(runtime.documents.get(target.path)?.dirty)
    setDialog({
      kind: 'delete',
      path: target.path,
      name: basename(target.path),
      directory: target.kind === 'directory',
      dirty,
    })
  }

  const commitRename = async () => {
    if (!rename || !session) return
    const parent = dirname(rename.path)
    try {
      const name = validateEntryName(rename.value.trim())
      if (isReservedName(name, caseSensitive)) {
        throw new WorkspaceError('permission-denied', 'That name is reserved.', {
          path: rename.path,
        })
      }
      const next = joinPath(parent, name)
      if (next === rename.path) {
        setRename(null)
        return
      }
      const stat = await session.move(rename.path, next)
      runtime.renameOpenPath(rename.path, next, stat)
      setChildren((current) => {
        const remapped = new Map<string, FileStat[]>()
        for (const [key, entries] of current) {
          if (pathIsUnder(key, rename.path)) continue
          remapped.set(
            key,
            entries.map((entry) => (entry.path === rename.path ? { ...entry, path: next } : entry)),
          )
        }
        return remapped
      })
      setExpanded((current) => {
        const nextExpanded = new Set<string>()
        for (const path of current) {
          if (!pathIsUnder(path, rename.path)) nextExpanded.add(path)
        }
        return nextExpanded
      })
      setErrors((current) => {
        const nextErrors = new Map(current)
        nextErrors.delete(rename.path)
        return nextErrors
      })
      setRename(null)
      await load(parent)
      focusRow(next)
    } catch (error) {
      const code = error instanceof WorkspaceError ? error.code : 'io'
      setErrors((current) => new Map(current).set(rename.path, code))
    }
  }

  const confirmDelete = async () => {
    if (!dialog || dialog.kind !== 'delete' || !session) return
    const target = dialog
    setDialog(null)
    const parent = dirname(target.path)
    try {
      runtime.deletePath(target.path)
      await session.remove(target.path, { recursive: true })
      setChildren((current) => {
        const next = new Map<string, FileStat[]>()
        for (const [key, entries] of current) {
          if (pathIsUnder(key, target.path)) continue
          next.set(
            key,
            entries.filter((entry) => !pathIsUnder(entry.path, target.path)),
          )
        }
        return next
      })
      setExpanded((current) => {
        const next = new Set<string>()
        for (const path of current) {
          if (!pathIsUnder(path, target.path)) next.add(path)
        }
        return next
      })
      setSelected(parent === ROOT ? null : parent)
      await load(parent)
    } catch (error) {
      const code = error instanceof WorkspaceError ? error.code : 'io'
      setErrors((current) => new Map(current).set(target.path, code))
    }
  }

  const submitNameDialog = async () => {
    if (!dialog || dialog.kind === 'delete' || !session) return
    const target = dialog
    try {
      const name = validateEntryName(target.name.trim())
      if (isReservedName(name, caseSensitive)) {
        throw new WorkspaceError('permission-denied', 'That name is reserved.')
      }
      const path = joinPath(target.directory, name)
      if (target.kind === 'new-file') {
        await session.write(path, new Uint8Array(), { create: true })
      } else {
        await session.mkdir(path)
      }
      setDialog(null)
      await load(target.directory)
      focusRow(path)
    } catch (error) {
      const code = error instanceof WorkspaceError ? error.code : 'io'
      const message =
        error instanceof WorkspaceError && error.code === 'permission-denied'
          ? 'That name is not allowed.'
          : workspaceErrorMessage(code)
      setDialog({ ...target, error: message })
    }
  }

  const runContext = (action: 'file' | 'folder' | 'rename' | 'delete') => {
    if (!context) return
    const entry = visible.find((row) => row.entry.path === context.path)?.entry
    setContext(null)
    if (!entry) return
    setSelected(entry.path)
    if (action === 'file') {
      beginCreate('new-file', entry.kind === 'directory' ? entry.path : dirname(entry.path))
    } else if (action === 'folder') {
      beginCreate('new-folder', entry.kind === 'directory' ? entry.path : dirname(entry.path))
    } else if (action === 'rename') {
      beginRename(entry)
    } else {
      requestDelete(entry)
    }
  }

  useEffect(() => {
    return onExplorerCommand((command) => {
      if (command === 'new-file') beginCreate('new-file')
      if (command === 'new-folder') beginCreate('new-folder')
      if (command === 'rename') beginRename()
      if (command === 'delete') requestDelete()
    })
  })

  if (snapshot.phase !== 'ready') {
    return (
      <div className="exo-explorer" role="region" aria-label="Explorer">
        <p className="exo-explorer-empty">No workspace is open.</p>
        <p className="exo-explorer-hint">
          {snapshot.phase === 'unsupported'
            ? 'This browser does not support opening a local folder. Use Chromium.'
            : snapshot.restoreAvailable
              ? 'The previous workspace could not be reopened. Open it again to continue.'
              : 'Open a folder to browse and edit its files.'}
        </p>
        {snapshot.phase !== 'unsupported' && (
          <button
            type="button"
            className="exo-explorer-action"
            onClick={() => void runtime.openFolder()}
          >
            Open Folder…
          </button>
        )}
        {snapshot.error && (
          <p className="exo-explorer-error" role="alert">
            {workspaceErrorMessage(snapshot.error.code, snapshot.error.path)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="exo-explorer" role="region" aria-label="Explorer">
      <div className="exo-explorer-toolbar">
        <button
          type="button"
          className="exo-explorer-action"
          aria-label="New File"
          disabled={!writable}
          onClick={() => beginCreate('new-file')}
        >
          New File
        </button>
        <button
          type="button"
          className="exo-explorer-action"
          aria-label="New Folder"
          disabled={!writable}
          onClick={() => beginCreate('new-folder')}
        >
          New Folder
        </button>
        <button
          type="button"
          className="exo-explorer-action"
          aria-label="Refresh Explorer"
          onClick={() => runtime.refreshExplorer()}
        >
          Refresh
        </button>
      </div>

      {!writable && (
        <div className="exo-workspace-banner" role="status">
          <span>Read-only workspace.</span>
          <button
            type="button"
            className="exo-explorer-action"
            onClick={() => void runtime.requestPermission()}
          >
            Restore access
          </button>
        </div>
      )}

      {snapshot.error && (
        <div className="exo-workspace-banner" role="alert">
          <span>{workspaceErrorMessage(snapshot.error.code, snapshot.error.path)}</span>
          <button
            type="button"
            className="exo-explorer-action"
            onClick={() => runtime.refreshExplorer()}
          >
            Retry
          </button>
        </div>
      )}

      <div className="exo-tree" role="tree" aria-label="Workspace files">
        {visible.map(({ entry, depth }) => {
          const isExpanded = expanded.has(entry.path)
          const isEditing = rename?.path === entry.path
          const error = errors.get(entry.path)
          return (
            <div key={entry.path}>
              <div
                ref={(element) => {
                  if (element) rowRefs.current.set(entry.path, element)
                  else rowRefs.current.delete(entry.path)
                }}
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={entry.kind === 'directory' ? isExpanded : undefined}
                aria-selected={selected === entry.path}
                className={`exo-tree-row ${selected === entry.path ? 'is-selected' : ''}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                tabIndex={
                  selected === entry.path || (!selected && visible[0]?.entry.path === entry.path)
                    ? 0
                    : -1
                }
                onClick={() => setSelected(entry.path)}
                onFocus={() => setSelected(entry.path)}
                onDoubleClick={() => toggle(entry)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setSelected(entry.path)
                  setContext({ x: event.clientX, y: event.clientY, path: entry.path })
                }}
                onKeyDown={(event) => handleKeyDown(event, entry)}
              >
                <span className="exo-tree-twisty" aria-hidden="true">
                  {entry.kind === 'directory' ? (isExpanded ? '▾' : '▸') : '·'}
                </span>
                {isEditing ? (
                  <input
                    className="exo-tree-rename"
                    aria-label={`Rename ${basename(entry.path)}`}
                    autoFocus
                    value={rename.value}
                    onChange={(event) => setRename({ ...rename, value: event.target.value })}
                    onBlur={() => setRename(null)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void commitRename()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setRename(null)
                      }
                    }}
                  />
                ) : (
                  <span className="exo-tree-name">{basename(entry.path)}</span>
                )}
                {entry.kind === 'directory' && loading.has(entry.path) && (
                  <span className="exo-tree-loading">…</span>
                )}
              </div>
              {error && (
                <div className="exo-explorer-error" role="alert">
                  <span>{workspaceErrorMessage(error, entry.path)}</span>
                  {entry.kind === 'directory' && (
                    <button
                      type="button"
                      className="exo-explorer-action"
                      onClick={() => void load(entry.path)}
                    >
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {loading.has(ROOT) && visible.length === 0 && <p className="exo-explorer-hint">Loading…</p>}
      {!loading.has(ROOT) && visible.length === 0 && (
        <p className="exo-explorer-hint">This folder is empty.</p>
      )}
      {errors.has(ROOT) && (
        <div className="exo-explorer-error" role="alert">
          <span>{workspaceErrorMessage(errors.get(ROOT) as WorkspaceErrorCode, ROOT)}</span>
          <button type="button" className="exo-explorer-action" onClick={() => void load(ROOT)}>
            Retry
          </button>
        </div>
      )}

      {context && (
        <div className="exo-context-menu" role="menu" style={{ left: context.x, top: context.y }}>
          <button type="button" role="menuitem" onClick={() => runContext('file')}>
            New File…
          </button>
          <button type="button" role="menuitem" onClick={() => runContext('folder')}>
            New Folder…
          </button>
          <button type="button" role="menuitem" onClick={() => runContext('rename')}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => runContext('delete')}>
            Delete
          </button>
        </div>
      )}

      {dialog && dialog.kind !== 'delete' && (
        <div className="exo-dialog-backdrop">
          <form
            className="exo-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.kind === 'new-file' ? 'New File' : 'New Folder'}
            onSubmit={(event) => {
              event.preventDefault()
              void submitNameDialog()
            }}
          >
            <h2>{dialog.kind === 'new-file' ? 'New File' : 'New Folder'}</h2>
            <p className="exo-dialog-hint">In {dialog.directory}</p>
            <input
              autoFocus
              aria-label="Name"
              value={dialog.name}
              onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
            />
            {dialog.error && <p className="exo-dialog-error">{dialog.error}</p>}
            <div className="exo-dialog-actions">
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="submit">Create</button>
            </div>
          </form>
        </div>
      )}

      {dialog && dialog.kind === 'delete' && (
        <div className="exo-dialog-backdrop">
          <div className="exo-dialog" role="dialog" aria-modal="true" aria-label="Delete">
            <h2>Delete {dialog.name}?</h2>
            <p>
              {dialog.directory
                ? 'The folder and everything inside it will be deleted.'
                : 'The file will be deleted.'}
            </p>
            {dialog.dirty && (
              <p className="exo-dialog-error">
                The open document has unsaved changes. They will be lost.
              </p>
            )}
            <div className="exo-dialog-actions">
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" onClick={() => void confirmDelete()}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, entry: FileStat): void {
    if (rename?.path === entry.path) return
    const index = visible.findIndex((row) => row.entry.path === entry.path)
    const row = visible[index]
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        const next = visible[Math.min(index + 1, visible.length - 1)]
        if (next) focusRow(next.entry.path)
        break
      }
      case 'ArrowUp': {
        event.preventDefault()
        const next = visible[Math.max(index - 1, 0)]
        if (next) focusRow(next.entry.path)
        break
      }
      case 'ArrowRight': {
        event.preventDefault()
        if (!row) break
        if (entry.kind === 'directory' && !expanded.has(entry.path)) {
          toggle(entry)
        } else if (entry.kind === 'directory') {
          const child = visible[index + 1]
          if (child && child.depth > row.depth) focusRow(child.entry.path)
        }
        break
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (entry.kind === 'directory' && expanded.has(entry.path)) {
          toggle(entry)
        } else {
          const parent = dirname(entry.path)
          if (parent !== ROOT) focusRow(parent)
        }
        break
      }
      case 'Enter': {
        event.preventDefault()
        toggle(entry)
        break
      }
      case 'F2': {
        event.preventDefault()
        beginRename(entry)
        break
      }
      case 'Delete': {
        event.preventDefault()
        requestDelete(entry)
        break
      }
      case 'Home': {
        event.preventDefault()
        if (visible[0]) focusRow(visible[0].entry.path)
        break
      }
      case 'End': {
        event.preventDefault()
        const last = visible.at(-1)
        if (last) focusRow(last.entry.path)
        break
      }
      case 'Escape': {
        event.preventDefault()
        setRename(null)
        setContext(null)
        break
      }
      case 'ContextMenu': {
        event.preventDefault()
        const element = rowRefs.current.get(entry.path)
        const rect = element?.getBoundingClientRect()
        setSelected(entry.path)
        setContext({
          x: rect?.left ?? 0,
          y: rect?.bottom ?? 0,
          path: entry.path,
        })
        break
      }
      default:
        break
    }
  }
}
