import {
  WorkspaceError,
  type FileStat,
  type WorkspacePath,
  type WorkspaceErrorCode,
} from './contract'

/**
 * Paths are absolute, '/'-rooted and POSIX-style. Normalization rejects rather
 * than repairs so a separator or traversal bug is visible instead of silent.
 */
const MAX_SEGMENT_BYTES = 255
const MAX_PATH_BYTES = 4096
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/ // eslint-disable-line no-control-regex

function invalid(path: string, message: string): WorkspaceError {
  return new WorkspaceError('permission-denied', message, { path })
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function normalizePath(value: unknown): WorkspacePath {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid('', 'A workspace path must be a non-empty string.')
  }
  if (!value.startsWith('/')) {
    throw invalid(value, 'A workspace path must be absolute and start with "/".')
  }
  if (value.includes('\\')) {
    throw invalid(value, 'Workspace paths cannot contain backslashes.')
  }
  if (value.includes('\0') || CONTROL_CHARACTER.test(value)) {
    throw invalid(value, 'Workspace paths cannot contain control characters.')
  }
  if (value.length > 1 && value.endsWith('/')) {
    throw invalid(value, 'Workspace paths cannot end with a slash.')
  }
  if (byteLength(value) > MAX_PATH_BYTES) {
    throw invalid(value, 'The workspace path is too long.')
  }
  if (value === '/') return '/'

  const segments = value.slice(1).split('/')
  for (const segment of segments) {
    if (segment.length === 0) {
      throw invalid(value, 'Workspace paths cannot contain empty segments.')
    }
    if (segment === '.' || segment === '..') {
      throw invalid(value, 'Workspace paths cannot contain "." or "..".')
    }
    if (byteLength(segment) > MAX_SEGMENT_BYTES) {
      throw invalid(value, 'A workspace path segment is too long.')
    }
  }
  return value
}

export function validateEntryName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid('', 'A name is required.')
  }
  if (
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    CONTROL_CHARACTER.test(value)
  ) {
    throw invalid(value, 'The name contains characters that are not allowed.')
  }
  if (value.length > MAX_SEGMENT_BYTES || byteLength(value) > MAX_SEGMENT_BYTES) {
    throw invalid(value, 'The name is too long.')
  }
  return value
}

export function joinPath(parent: WorkspacePath, name: string): WorkspacePath {
  const root = normalizePath(parent)
  const entry = validateEntryName(name)
  return root === '/' ? `/${entry}` : `${root}/${entry}`
}

export function dirname(path: WorkspacePath): WorkspacePath {
  const value = normalizePath(path)
  if (value === '/') return '/'
  const index = value.lastIndexOf('/')
  return index <= 0 ? '/' : value.slice(0, index)
}

export function basename(path: WorkspacePath): string {
  const value = normalizePath(path)
  if (value === '/') return ''
  return value.slice(value.lastIndexOf('/') + 1)
}

export function pathIsUnder(path: WorkspacePath, prefix: WorkspacePath): boolean {
  if (path === prefix) return true
  return prefix === '/' ? path.startsWith('/') : path.startsWith(`${prefix}/`)
}

export function isReservedName(name: string, caseSensitive = true): boolean {
  const compared = caseSensitive ? name : name.toLowerCase()
  return compared === 'exo.json' || compared === '.exo'
}

export function isReservedPath(path: WorkspacePath, caseSensitive = true): boolean {
  const compared = caseSensitive ? path : path.toLowerCase()
  return compared === '/exo.json' || compared === '/.exo' || compared.startsWith('/.exo/')
}

export function filterReserved(entries: FileStat[], caseSensitive: boolean): FileStat[] {
  return entries.filter((entry) => !isReservedPath(entry.path, caseSensitive))
}

export function isWorkspaceRoot(path: WorkspacePath): boolean {
  return path === '/'
}

export function pathErrorCode(error: unknown): WorkspaceErrorCode | undefined {
  return error instanceof WorkspaceError ? error.code : undefined
}
