/**
 * Mirror of the normative workspace contract in `docs/contracts/workspace-api.md`.
 *
 * This module is the single type source for the shell implementation. The
 * contract document and `openspec/specs/workspace-access/spec.md` are normative;
 * keep this file, the document and the spec in step when a message, field or
 * provider method changes.
 */

export type WorkspacePath = string

export const WORKSPACE_ERROR_CODES = [
  'not-found',
  'not-a-file',
  'not-a-directory',
  'already-exists',
  'permission-denied',
  'conflict',
  'quota-exceeded',
  'unsupported',
  'too-large',
  'aborted',
  'io',
] as const

export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number]

export interface WorkspaceCapabilities {
  /** Provider can create, write, move and delete. */
  writable: boolean
  /** Provider can report external changes. When false the shell polls on focus. */
  watchable: boolean
  /** Handle or identity survives a page reload. */
  persistent: boolean
  /** Paths are compared case-sensitively. */
  caseSensitive: boolean
  /** Maximum bytes accepted by one read or write. */
  maxFileSize?: number
}

export interface FileStat {
  path: WorkspacePath
  kind: 'file' | 'directory'
  /** Bytes for files, 0 for directories. */
  size: number
  /** Epoch milliseconds. */
  mtime: number
  /**
   * Opaque content version. Changes whenever content or mtime changes and is
   * stable for unchanged content. Used as the write precondition.
   */
  version: string
}

export type WorkspaceChange =
  | { kind: 'created'; path: WorkspacePath; stat: FileStat }
  | { kind: 'changed'; path: WorkspacePath; stat: FileStat }
  | { kind: 'deleted'; path: WorkspacePath }
  | { kind: 'renamed'; path: WorkspacePath; previousPath: WorkspacePath; stat: FileStat }

export interface WorkspaceDescriptor {
  /** Stable within one provider. Not a secret: derived from name and provider. */
  id: string
  /** Display name, usually the folder name. */
  name: string
  providerKind: string
  capabilities: WorkspaceCapabilities
}

export interface ReadOptions {
  signal?: AbortSignal
  /** Reject with 'too-large' instead of reading beyond this many bytes. */
  maxBytes?: number
}

export interface WriteOptions {
  signal?: AbortSignal
  /** Reject with 'conflict' when the current version differs. */
  ifVersion?: string
  /** Create parent directories. Default false. */
  create?: boolean
  /**
   * Reject with 'already-exists' when the target exists. A create-only write
   * never truncates or replaces an existing target observed at check time.
   */
  createOnly?: boolean
}

export interface ListOptions {
  signal?: AbortSignal
  /** 'one' for direct children only; 'recursive' for a full subtree. Default 'one'. */
  depth?: 'one' | 'recursive'
}

export interface Disposable {
  dispose(): void
}

export interface WorkspaceAccess {
  list(path: WorkspacePath, options?: ListOptions): Promise<FileStat[]>
  stat(path: WorkspacePath, options?: { signal?: AbortSignal }): Promise<FileStat>
  read(path: WorkspacePath, options?: ReadOptions): Promise<Uint8Array>
  write(path: WorkspacePath, data: Uint8Array, options?: WriteOptions): Promise<FileStat>
  mkdir(path: WorkspacePath, options?: { recursive?: boolean; signal?: AbortSignal }): Promise<void>
  remove(
    path: WorkspacePath,
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): Promise<void>
  move(
    from: WorkspacePath,
    to: WorkspacePath,
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<FileStat>
}

export interface WorkspaceHandle extends WorkspaceAccess {
  descriptor: WorkspaceDescriptor

  /** Optional. Absent when the provider cannot escalate permission. */
  requestPermission?(options?: { signal?: AbortSignal }): Promise<WorkspaceCapabilities>

  /** Optional. Absent when capabilities().watchable is false. */
  watch?(paths: WorkspacePath[], onChange: (change: WorkspaceChange) => void): Disposable
}

export interface WorkspaceProvider {
  readonly kind: string
  readonly label: string

  capabilities(): WorkspaceCapabilities

  /** Show the backend's picker or otherwise establish a new workspace. */
  open(options?: { signal?: AbortSignal }): Promise<WorkspaceHandle>

  /** Re-open a previously persisted workspace. Return null when unavailable. */
  restore?(id: string, options?: { signal?: AbortSignal }): Promise<WorkspaceHandle | null>

  /** Release provider resources. No operation may be served afterwards. */
  dispose(): void
}

export interface OpenDocumentSnapshot {
  path: WorkspacePath
  /** The version the shell loaded; refresh compares against this. */
  version: string
}

export interface WorkspaceSession extends WorkspaceAccess {
  /** Snapshot taken when the session was created; capabilities() is authoritative. */
  readonly descriptor: WorkspaceDescriptor

  capabilities(): WorkspaceCapabilities

  /** Plugin-scoped facade. Applies the reserved-path guard and logs denials. */
  forPlugin(pluginId: string): WorkspaceAccess

  /** Gesture-bound permission escalation. Returns the updated capabilities. */
  requestPermission(options?: { signal?: AbortSignal }): Promise<WorkspaceCapabilities>

  /** Replace the tracked open-document set used by the refresh fallback. */
  setOpenDocuments(documents: OpenDocumentSnapshot[]): void

  /** Re-stat tracked documents and return only the changes. */
  refreshOpenDocuments(): Promise<WorkspaceChange[]>

  onExternalChange(listener: (change: WorkspaceChange) => void): Disposable

  dispose(): Promise<void>
}

export type WorkspaceOperation =
  'list' | 'stat' | 'read' | 'write' | 'mkdir' | 'remove' | 'move' | 'permission'

export interface WorkspaceLogEntry {
  at: number
  operation: WorkspaceOperation
  pluginId?: string
  path?: WorkspacePath
  code?: WorkspaceErrorCode
}

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode
  readonly path?: WorkspacePath

  constructor(
    code: WorkspaceErrorCode,
    message: string,
    options: { path?: WorkspacePath; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'WorkspaceError'
    this.code = code
    this.path = options.path
  }
}

export function isWorkspaceError(error: unknown): error is WorkspaceError {
  return error instanceof WorkspaceError
}

/** Convert an unknown backend failure into a sanitized workspace error. */
export function asWorkspaceError(error: unknown, path?: WorkspacePath): WorkspaceError {
  if (isWorkspaceError(error)) {
    if (error.path === undefined && path !== undefined) {
      return new WorkspaceError(error.code, error.message, { path, cause: error })
    }
    return error
  }
  return new WorkspaceError('io', 'The workspace operation failed.', { path, cause: error })
}

export function isAborted(error: unknown): boolean {
  return isWorkspaceError(error) && error.code === 'aborted'
}

export function workspaceErrorMessage(code: WorkspaceErrorCode, path?: WorkspacePath): string {
  const target = path && path !== '/' ? path : 'this workspace'
  switch (code) {
    case 'not-found':
      return `${target} was not found.`
    case 'not-a-file':
      return `${target} is not a file.`
    case 'not-a-directory':
      return `${target} is not a folder.`
    case 'already-exists':
      return `${target} already exists.`
    case 'permission-denied':
      return `Access to ${target} was denied.`
    case 'conflict':
      return `${target} changed on disk. Reload it before saving.`
    case 'quota-exceeded':
      return `There is not enough space to write ${target}.`
    case 'unsupported':
      return `This workspace cannot perform that operation on ${target}.`
    case 'too-large':
      return `${target} is too large to open in the text editor.`
    case 'aborted':
      return 'The workspace operation was cancelled.'
    case 'io':
      return `The workspace operation on ${target} failed.`
  }
}
