import { WorkspaceError, type WorkspacePath } from '../../contract'

export interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
}

export type PermissionMode = 'read' | 'readwrite'

export interface PermissionCapableHandle {
  queryPermission?(descriptor?: { mode?: PermissionMode }): Promise<PermissionState>
  requestPermission?(descriptor?: { mode?: PermissionMode }): Promise<PermissionState>
}

export type MovableHandle = FileSystemHandle & {
  move?:
    | ((newName: string) => Promise<void>)
    | ((destinationDirectory: FileSystemDirectoryHandle, newName: string) => Promise<void>)
}

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    values(): AsyncIterableIterator<FileSystemHandle>
    keys(): AsyncIterableIterator<string>
  }

  interface Window {
    showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
}

export function supportsFolderWorkspaces(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function pickDirectory(
  options: DirectoryPickerOptions = {},
): Promise<FileSystemDirectoryHandle> {
  if (!supportsFolderWorkspaces()) {
    throw new WorkspaceError('unsupported', 'This browser does not support opening a local folder.')
  }
  return window.showDirectoryPicker!(options)
}

export async function queryPermission(
  handle: FileSystemHandle,
  mode: PermissionMode,
): Promise<PermissionState> {
  const capable = handle as PermissionCapableHandle
  if (!capable.queryPermission) return 'granted'
  return capable.queryPermission({ mode })
}

export async function requestPermission(
  handle: FileSystemHandle,
  mode: PermissionMode,
): Promise<PermissionState> {
  const capable = handle as PermissionCapableHandle
  if (!capable.requestPermission) {
    throw new WorkspaceError('unsupported', 'The provider cannot request additional permission.')
  }
  return capable.requestPermission({ mode })
}

export function canMove(handle: FileSystemHandle): boolean {
  return typeof (handle as MovableHandle).move === 'function'
}

export async function moveHandle(
  handle: FileSystemHandle,
  destination: FileSystemDirectoryHandle | string,
  name?: string,
): Promise<void> {
  const movable = handle as MovableHandle
  if (!movable.move) {
    throw new WorkspaceError('unsupported', 'Moving entries is not supported by this browser.')
  }
  if (typeof destination === 'string') {
    await (movable.move as (newName: string) => Promise<void>)(destination)
    return
  }
  await (movable.move as (directory: FileSystemDirectoryHandle, newName: string) => Promise<void>)(
    destination,
    name ?? handle.name,
  )
}

/** Map a File System Access failure to the contract's stable codes. */
export function mapFsaError(error: unknown, path?: WorkspacePath): WorkspaceError {
  if (error instanceof WorkspaceError) return error
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : ''
  const message = error instanceof Error ? error.message : 'The filesystem operation failed.'
  switch (name) {
    case 'NotFoundError':
      return new WorkspaceError('not-found', message, { path, cause: error })
    case 'NotAllowedError':
    case 'SecurityError':
    case 'NoModificationAllowedError':
      return new WorkspaceError('permission-denied', message, { path, cause: error })
    case 'QuotaExceededError':
      return new WorkspaceError('quota-exceeded', message, { path, cause: error })
    case 'AbortError':
      return new WorkspaceError('aborted', message, { path, cause: error })
    case 'TypeMismatchError':
    case 'InvalidModificationError':
    case 'InvalidStateError':
    case 'SyntaxError':
      return new WorkspaceError('io', message, { path, cause: error })
    default:
      return new WorkspaceError('io', message, { path, cause: error })
  }
}
