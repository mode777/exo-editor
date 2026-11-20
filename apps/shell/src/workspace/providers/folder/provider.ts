import {
  WorkspaceError,
  type FileStat,
  type ListOptions,
  type ReadOptions,
  type WorkspaceCapabilities,
  type WorkspaceDescriptor,
  type WorkspaceHandle,
  type WorkspacePath,
  type WorkspaceProvider,
  type WriteOptions,
} from '../../contract'
import { basename, dirname, joinPath, normalizePath, pathIsUnder } from '../../paths'
import {
  canMove,
  mapFsaError,
  moveHandle,
  pickDirectory,
  queryPermission,
  requestPermission as requestHandlePermission,
  type DirectoryPickerOptions,
} from './fsa'
import { IndexedDbHandleStore, type HandleStore, type StoredWorkspaceRecord } from './handle-store'

export interface FolderProviderOptions {
  picker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  handleStore?: HandleStore
  platform?: string
  now?: () => number
}

function platformName(): string {
  if (typeof navigator === 'undefined') return ''
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return data?.platform ?? navigator.platform ?? ''
}

function isCaseSensitive(platform: string): boolean {
  const value = platform.toLowerCase()
  return !(value.includes('win') || value.includes('mac'))
}

function throwIfAborted(signal?: AbortSignal, path?: WorkspacePath): void {
  if (signal?.aborted) {
    throw new WorkspaceError('aborted', 'The workspace operation was cancelled.', {
      path,
    })
  }
}

function directoryStat(path: WorkspacePath, mtime: number): FileStat {
  return {
    path,
    kind: 'directory',
    size: 0,
    mtime,
    version: 'directory',
  }
}

function sameVersion(file: File): string {
  return `${file.lastModified}:${file.size}`
}

export class FolderWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'folder'
  readonly label = 'Folder'

  private readonly picker: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>
  private readonly handleStore: HandleStore
  private readonly caseSensitive: boolean
  private readonly now: () => number
  private disposed = false
  private persistenceAvailable = true

  constructor(options: FolderProviderOptions = {}) {
    this.picker = options.picker ?? pickDirectory
    this.handleStore = options.handleStore ?? new IndexedDbHandleStore()
    this.caseSensitive = isCaseSensitive(options.platform ?? platformName())
    this.now = options.now ?? (() => Date.now())
  }

  capabilities(): WorkspaceCapabilities {
    return {
      writable: true,
      watchable: false,
      persistent: this.persistenceAvailable,
      caseSensitive: this.caseSensitive,
    }
  }

  async open(options: { signal?: AbortSignal } = {}): Promise<WorkspaceHandle> {
    this.assertUsable()
    throwIfAborted(options.signal)
    let root: FileSystemDirectoryHandle
    try {
      root = await this.picker({ mode: 'readwrite', id: 'exo-workspace' })
    } catch (error) {
      throw mapFsaError(error)
    }
    if (!root || root.kind !== 'directory') {
      throw new WorkspaceError('unsupported', 'The picker did not return a folder.')
    }

    const record: StoredWorkspaceRecord = {
      id: `folder:${root.name}`,
      name: root.name,
      handle: root,
    }
    try {
      await this.handleStore.put(record)
    } catch {
      this.persistenceAvailable = false
    }
    const capabilities = this.capabilities()
    return new FolderHandle(
      root,
      {
        id: record.id,
        name: record.name,
        providerKind: this.kind,
        capabilities,
      },
      this.caseSensitive,
      this.now,
      () => this.disposed,
    )
  }

  async restore(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkspaceHandle | null> {
    this.assertUsable()
    throwIfAborted(options.signal)
    let record: StoredWorkspaceRecord | null
    try {
      record = await this.handleStore.get()
    } catch (error) {
      throw mapFsaError(error)
    }
    if (!record || record.id !== id) return null
    if (!record.handle || record.handle.kind !== 'directory') {
      await this.handleStore.clear()
      return null
    }

    let writable: boolean
    try {
      const readwrite = await queryPermission(record.handle, 'readwrite')
      const readable = await queryPermission(record.handle, 'read')
      writable = readwrite === 'granted' && readable !== 'denied'
    } catch (error) {
      throw mapFsaError(error)
    }

    const capabilities: WorkspaceCapabilities = {
      ...this.capabilities(),
      writable,
    }
    return new FolderHandle(
      record.handle,
      {
        id: record.id,
        name: record.name,
        providerKind: this.kind,
        capabilities,
      },
      this.caseSensitive,
      this.now,
      () => this.disposed,
    )
  }

  dispose(): void {
    this.disposed = true
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new WorkspaceError('io', 'The provider has been disposed.')
    }
  }
}

class FolderHandle implements WorkspaceHandle {
  descriptor: WorkspaceDescriptor
  private readonly root: FileSystemDirectoryHandle
  private readonly caseSensitive: boolean
  private readonly now: () => number
  private readonly isProviderDisposed: () => boolean

  constructor(
    root: FileSystemDirectoryHandle,
    descriptor: WorkspaceDescriptor,
    caseSensitive: boolean,
    now: () => number,
    isProviderDisposed: () => boolean,
  ) {
    this.root = root
    this.descriptor = descriptor
    this.caseSensitive = caseSensitive
    this.now = now
    this.isProviderDisposed = isProviderDisposed
  }

  async requestPermission(
    options: {
      signal?: AbortSignal
    } = {},
  ): Promise<WorkspaceCapabilities> {
    this.assertUsable()
    throwIfAborted(options.signal)
    const state = await requestHandlePermission(this.root, 'readwrite')
    if (state !== 'granted') throwIfAborted(options.signal)
    const capabilities = {
      ...this.descriptor.capabilities,
      writable: state === 'granted',
    }
    this.descriptor = { ...this.descriptor, capabilities }
    return capabilities
  }

  async list(path: WorkspacePath, options: ListOptions = {}): Promise<FileStat[]> {
    this.assertUsable()
    throwIfAborted(options.signal, path)
    const target = normalizePath(path)
    try {
      return await this.listInside(target, options, options.signal)
    } catch (error) {
      throw this.map(error, target)
    }
  }

  async stat(path: WorkspacePath, options: { signal?: AbortSignal } = {}): Promise<FileStat> {
    this.assertUsable()
    throwIfAborted(options.signal, path)
    const target = normalizePath(path)
    try {
      return await this.statInside(target, options.signal)
    } catch (error) {
      throw this.map(error, target)
    }
  }

  async read(path: WorkspacePath, options: ReadOptions = {}): Promise<Uint8Array> {
    this.assertUsable()
    throwIfAborted(options.signal, path)
    const target = normalizePath(path)
    try {
      if (target === '/') {
        throw new WorkspaceError('not-a-file', 'The root is a folder.', {
          path: target,
        })
      }
      const fileHandle = await this.getFileHandle(target)
      const file = await fileHandle.getFile()
      if (options.maxBytes !== undefined && file.size > options.maxBytes) {
        throw new WorkspaceError('too-large', 'The file is too large.', {
          path: target,
        })
      }
      throwIfAborted(options.signal, target)
      const buffer = await file.arrayBuffer()
      throwIfAborted(options.signal, target)
      return new Uint8Array(buffer)
    } catch (error) {
      throw this.map(error, target)
    }
  }

  async write(
    path: WorkspacePath,
    data: Uint8Array,
    options: WriteOptions = {},
  ): Promise<FileStat> {
    this.assertUsable()
    throwIfAborted(options.signal, path)
    const target = normalizePath(path)
    try {
      if (target === '/') {
        throw new WorkspaceError('not-a-file', 'The root is a folder.', {
          path: target,
        })
      }
      const parentPath = dirname(target)
      const parent = options.create
        ? await this.ensureDirectory(parentPath, options.signal)
        : await this.getDirectory(parentPath)
      const name = basename(target)

      if (options.createOnly) {
        // The File System Access API has no atomic create. Check, then create:
        // a concurrent external writer can still win the last instant, and the
        // provider note records that residual race.
        const existing = await this.tryStatInside(target, options.signal)
        if (existing?.kind === 'directory') {
          throw new WorkspaceError('not-a-file', 'The path is a directory.', {
            path: target,
          })
        }
        if (existing) {
          throw new WorkspaceError('already-exists', 'The file already exists.', {
            path: target,
          })
        }
      }

      let fileHandle: FileSystemFileHandle
      try {
        fileHandle = await parent.getFileHandle(name)
      } catch (error) {
        if (!options.create || mapFsaError(error, target).code !== 'not-found') {
          throw error
        }
        fileHandle = await parent.getFileHandle(name, { create: true })
      }

      if (options.ifVersion !== undefined) {
        const current = await fileHandle.getFile()
        if (sameVersion(current) !== options.ifVersion) {
          throw new WorkspaceError('conflict', 'The file changed on disk.', {
            path: target,
          })
        }
      }
      throwIfAborted(options.signal, target)
      const writable = await fileHandle.createWritable()
      try {
        const chunk = new Uint8Array(data.byteLength)
        chunk.set(data)
        await writable.write(chunk)
      } finally {
        await writable.close()
      }
      throwIfAborted(options.signal, target)
      return await this.statInside(target)
    } catch (error) {
      throw this.map(error, target)
    }
  }

  async mkdir(
    path: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertUsable()
    throwIfAborted(options.signal, path)
    const target = normalizePath(path)
    try {
      if (target === '/') {
        throw new WorkspaceError('already-exists', 'The root folder exists.', {
          path: target,
        })
      }
      if (await this.exists(target, options.signal)) {
        throw new WorkspaceError('already-exists', 'The folder already exists.', {
          path: target,
        })
      }
      if (options.recursive) {
        await this.ensureDirectory(target, options.signal)
        return
      }
      const parent = await this.getDirectory(dirname(target))
      throwIfAborted(options.signal, target)
      await parent.getDirectoryHandle(basename(target), { create: true })
    } catch (error) {
      throw this.map(error, target)
    }
  }

  async remove(
    path: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertUsable()
    throwIfAborted(options.signal, path)
    const target = normalizePath(path)
    try {
      if (target === '/') {
        throw new WorkspaceError('permission-denied', 'The root cannot be removed.', {
          path: target,
        })
      }
      const parent = await this.getDirectory(dirname(target))
      throwIfAborted(options.signal, target)
      await parent.removeEntry(basename(target), {
        recursive: options.recursive ?? false,
      })
    } catch (error) {
      throw this.map(error, target)
    }
  }

  async move(
    from: WorkspacePath,
    to: WorkspacePath,
    options: { overwrite?: boolean; signal?: AbortSignal } = {},
  ): Promise<FileStat> {
    this.assertUsable()
    throwIfAborted(options.signal, from)
    const source = normalizePath(from)
    const target = normalizePath(to)
    try {
      if (source === '/' || target === '/') {
        throw new WorkspaceError('permission-denied', 'The root cannot be moved.', {
          path: source,
        })
      }
      if (pathIsUnder(target, source)) {
        throw new WorkspaceError('io', 'A folder cannot move inside itself.', {
          path: target,
        })
      }
      const sourceHandle = await this.getAnyHandle(dirname(source), basename(source))
      if (!canMove(sourceHandle)) {
        throw new WorkspaceError(
          'unsupported',
          'Moving entries is not supported by this browser.',
          { path: source },
        )
      }
      const targetParent = await this.getDirectory(dirname(target))
      if ((await this.exists(target, options.signal)) && !options.overwrite) {
        throw new WorkspaceError('already-exists', 'The target already exists.', {
          path: target,
        })
      }
      if (options.overwrite && (await this.exists(target, options.signal))) {
        await targetParent.removeEntry(basename(target), { recursive: true })
      }
      throwIfAborted(options.signal, source)
      if (dirname(source) === dirname(target)) {
        await moveHandle(sourceHandle, basename(target))
      } else {
        await moveHandle(sourceHandle, targetParent, basename(target))
      }
      throwIfAborted(options.signal, target)
      return await this.statInside(target)
    } catch (error) {
      throw this.map(error, source)
    }
  }

  private async listInside(
    path: WorkspacePath,
    options: ListOptions,
    signal?: AbortSignal,
  ): Promise<FileStat[]> {
    const directory = await this.getDirectory(path)
    const entries: FileStat[] = []
    for await (const [name, handle] of directory.entries()) {
      throwIfAborted(signal, path)
      const childPath = joinPath(path, name)
      entries.push(await this.statHandle(childPath, handle))
      if (options.depth === 'recursive' && handle.kind === 'directory') {
        entries.push(...(await this.listInside(childPath, options, signal)))
      }
    }
    return entries.sort((a, b) =>
      this.caseSensitive
        ? a.path.localeCompare(b.path)
        : a.path.toLowerCase().localeCompare(b.path.toLowerCase()),
    )
  }

  private async statInside(path: WorkspacePath, signal?: AbortSignal): Promise<FileStat> {
    throwIfAborted(signal, path)
    if (path === '/') return directoryStat(path, this.now())
    const parent = await this.getDirectory(dirname(path))
    const name = basename(path)

    try {
      const fileHandle = await parent.getFileHandle(name)
      return await this.statHandle(path, fileHandle)
    } catch (error) {
      const mapped = mapFsaError(error, path)
      if (mapped.code !== 'not-found' && mapped.code !== 'io') throw error
    }
    try {
      await parent.getDirectoryHandle(name)
      return directoryStat(path, this.now())
    } catch (error) {
      const mapped = mapFsaError(error, path)
      if (mapped.code === 'io') {
        throw new WorkspaceError('not-found', 'The path does not exist.', {
          path,
        })
      }
      throw error
    }
  }

  private async statHandle(path: WorkspacePath, handle: FileSystemHandle): Promise<FileStat> {
    if (handle.kind === 'directory') return directoryStat(path, this.now())
    const file = await (handle as FileSystemFileHandle).getFile()
    return {
      path,
      kind: 'file',
      size: file.size,
      mtime: file.lastModified,
      version: sameVersion(file),
    }
  }

  private async getFileHandle(path: WorkspacePath): Promise<FileSystemFileHandle> {
    if (path === '/') {
      throw new WorkspaceError('not-a-file', 'The root is a folder.', { path })
    }
    const parent = await this.getDirectory(dirname(path))
    try {
      return await parent.getFileHandle(basename(path))
    } catch (error) {
      const mapped = mapFsaError(error, path)
      if (mapped.code === 'io') {
        throw new WorkspaceError('not-a-file', 'The path is not a file.', { path })
      }
      throw error
    }
  }

  private async getAnyHandle(parentPath: WorkspacePath, name: string): Promise<FileSystemHandle> {
    const parent = await this.getDirectory(parentPath)
    try {
      return await parent.getFileHandle(name)
    } catch {
      return parent.getDirectoryHandle(name)
    }
  }

  private async getDirectory(path: WorkspacePath): Promise<FileSystemDirectoryHandle> {
    const target = normalizePath(path)
    if (target === '/') return this.root
    let current = this.root
    for (const segment of target.slice(1).split('/')) {
      try {
        current = await current.getDirectoryHandle(segment)
      } catch (error) {
        const mapped = mapFsaError(error, target)
        if (mapped.code === 'io') {
          throw new WorkspaceError('not-a-directory', 'The path is not a folder.', {
            path: target,
          })
        }
        throw error
      }
    }
    return current
  }

  private async ensureDirectory(
    path: WorkspacePath,
    signal?: AbortSignal,
  ): Promise<FileSystemDirectoryHandle> {
    const target = normalizePath(path)
    throwIfAborted(signal, target)
    if (target === '/') return this.root
    let current = this.root
    for (const segment of target.slice(1).split('/')) {
      throwIfAborted(signal, target)
      try {
        current = await current.getDirectoryHandle(segment)
      } catch (error) {
        const mapped = mapFsaError(error, target)
        if (mapped.code !== 'not-found' && mapped.code !== 'io') throw error
        try {
          current = await current.getDirectoryHandle(segment, { create: true })
        } catch (createError) {
          throw mapFsaError(createError, target)
        }
      }
    }
    return current
  }

  private async exists(path: WorkspacePath, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.statInside(path, signal)
      return true
    } catch (error) {
      const mapped = mapFsaError(error, path)
      if (mapped.code === 'not-found') return false
      throw error
    }
  }

  private async tryStatInside(path: WorkspacePath, signal?: AbortSignal): Promise<FileStat | null> {
    try {
      return await this.statInside(path, signal)
    } catch (error) {
      const mapped = mapFsaError(error, path)
      if (mapped.code === 'not-found') return null
      throw error
    }
  }

  private assertUsable(): void {
    if (this.isProviderDisposed()) {
      throw new WorkspaceError('io', 'The provider has been disposed.')
    }
  }

  private map(error: unknown, path: WorkspacePath): WorkspaceError {
    return mapFsaError(error, path)
  }
}
