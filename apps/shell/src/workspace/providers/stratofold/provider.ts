import { StratofoldClient, StratofoldError } from '@stratofold/client'
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
import { dirname, joinPath, normalizePath, pathIsUnder } from '../../paths'
import { type StratofoldConnection } from './connection'
import { abortable, mapStratofoldError, rejectionOf } from './errors'

export interface StratofoldProviderOptions {
  connection: StratofoldConnection
  client: StratofoldClient
  /** True when the connection was written to the recent-workspaces store. */
  persistent?: boolean
  /** Called when the server rejects the credential, never for other failures. */
  onCredentialRejected?: (status: 'unauthorized' | 'forbidden') => void
}

/** `https://files.example.com` + `vdir-1` -> `stratofold:https://files.example.com:vdir-1`. */
export function stratofoldWorkspaceId(connection: StratofoldConnection): string {
  return `stratofold:${new URL(connection.server).origin}:${connection.vdir}`
}

export class StratofoldWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'stratofold'
  readonly label = 'Stratofold'
  readonly connection: StratofoldConnection

  private readonly client: StratofoldClient
  private readonly persistent: boolean
  private readonly onCredentialRejected?: (status: 'unauthorized' | 'forbidden') => void
  private disposed = false

  constructor(options: StratofoldProviderOptions) {
    this.connection = options.connection
    this.client = options.client
    this.persistent = options.persistent ?? false
    this.onCredentialRejected = options.onCredentialRejected
  }

  capabilities(): WorkspaceCapabilities {
    return {
      writable: this.connection.role === 'editor',
      watchable: false,
      persistent: this.persistent,
      caseSensitive: false,
    }
  }

  async open(options: { signal?: AbortSignal } = {}): Promise<WorkspaceHandle> {
    this.assertUsable()
    if (options.signal?.aborted) throw new WorkspaceError('aborted', 'The connect was cancelled.')
    return this.handle()
  }

  async restore(
    id: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<WorkspaceHandle | null> {
    this.assertUsable()
    if (options.signal?.aborted) throw new WorkspaceError('aborted', 'The restore was cancelled.')
    return id === this.descriptor().id ? this.handle() : null
  }

  dispose(): void {
    this.disposed = true
  }

  private descriptor(): WorkspaceDescriptor {
    return {
      id: stratofoldWorkspaceId(this.connection),
      name: this.connection.name,
      providerKind: this.kind,
      capabilities: this.capabilities(),
    }
  }

  private handle(): StratofoldHandle {
    return new StratofoldHandle(
      this.client,
      this.descriptor(),
      this.onCredentialRejected,
      () => this.disposed,
    )
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new WorkspaceError('io', 'The provider has been disposed.')
    }
  }
}

class StratofoldHandle implements WorkspaceHandle {
  descriptor: WorkspaceDescriptor

  private readonly client: StratofoldClient
  private readonly onCredentialRejected?: (status: 'unauthorized' | 'forbidden') => void
  private readonly isProviderDisposed: () => boolean
  private credentialRejected = false

  constructor(
    client: StratofoldClient,
    descriptor: WorkspaceDescriptor,
    onCredentialRejected: ((status: 'unauthorized' | 'forbidden') => void) | undefined,
    isProviderDisposed: () => boolean,
  ) {
    this.client = client
    this.descriptor = descriptor
    this.onCredentialRejected = onCredentialRejected
    this.isProviderDisposed = isProviderDisposed
  }

  async list(path: WorkspacePath, options: ListOptions = {}): Promise<FileStat[]> {
    this.assertUsable()
    const target = normalizePath(path)
    try {
      return await this.listInside(target, options, options.signal)
    } catch (error) {
      throw this.map(error, target, options.signal)
    }
  }

  async stat(path: WorkspacePath, options: { signal?: AbortSignal } = {}): Promise<FileStat> {
    this.assertUsable()
    const target = normalizePath(path)
    try {
      return await this.statInside(target, options.signal)
    } catch (error) {
      throw this.map(error, target, options.signal)
    }
  }

  async read(path: WorkspacePath, options: ReadOptions = {}): Promise<Uint8Array> {
    this.assertUsable()
    const target = normalizePath(path)
    try {
      if (target === '/') {
        throw new WorkspaceError('not-a-file', 'The root is a folder.', { path: target })
      }
      const stat = await this.statInside(target, options.signal)
      if (stat.kind !== 'file') {
        throw new WorkspaceError('not-a-file', 'The path is not a file.', { path: target })
      }
      if (options.maxBytes !== undefined && stat.size > options.maxBytes) {
        throw new WorkspaceError('too-large', 'The file is too large.', { path: target })
      }
      const response = await this.client.read(this.remote(target), {
        signal: options.signal,
        // The server does not always send a cache policy, and a cached body
        // after a save or an external change is a wrong read.
        headers: { 'cache-control': 'no-cache' },
      })
      if (options.maxBytes !== undefined) {
        const declared = Number(response.headers.get('content-length') ?? Number.NaN)
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          throw new WorkspaceError('too-large', 'The file is too large.', { path: target })
        }
      }
      const buffer = await response.arrayBuffer()
      if (options.maxBytes !== undefined && buffer.byteLength > options.maxBytes) {
        throw new WorkspaceError('too-large', 'The file is too large.', { path: target })
      }
      if (options.signal?.aborted) {
        throw new WorkspaceError('aborted', 'The workspace operation was cancelled.', {
          path: target,
        })
      }
      return new Uint8Array(buffer)
    } catch (error) {
      throw this.map(error, target, options.signal)
    }
  }

  async write(
    path: WorkspacePath,
    data: Uint8Array,
    options: WriteOptions = {},
  ): Promise<FileStat> {
    this.assertUsable()
    const target = normalizePath(path)
    try {
      this.assertWritable(target)
      if (target === '/') {
        throw new WorkspaceError('not-a-file', 'The root is a folder.', { path: target })
      }
      const existing = await this.tryStat(target, options.signal)
      if (existing?.kind === 'directory') {
        throw new WorkspaceError('not-a-file', 'The path is not a file.', { path: target })
      }
      if (options.createOnly) {
        // The published client's only conditional upload is `If-Match`, and
        // `"*"` requires the target to exist, so it cannot express create-only.
        // Pre-check and document the residual check-to-write race.
        if (existing) {
          throw new WorkspaceError('already-exists', 'The file already exists.', {
            path: target,
          })
        }
      }
      if (!existing) {
        if (!options.create) {
          throw new WorkspaceError('not-found', 'The path does not exist.', { path: target })
        }
        await this.ensureParent(dirname(target), options.signal)
      }
      const body = data.slice().buffer as ArrayBuffer
      await this.client.upload(this.remote(target), body, {
        signal: options.signal,
        ifVersion: options.createOnly ? undefined : options.ifVersion,
      })
      if (options.signal?.aborted) {
        throw new WorkspaceError('aborted', 'The workspace operation was cancelled.', {
          path: target,
        })
      }
      return await this.statInside(target, options.signal)
    } catch (error) {
      throw this.map(error, target, options.signal)
    }
  }

  async mkdir(
    path: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertUsable()
    const target = normalizePath(path)
    try {
      this.assertWritable(target)
      if (target === '/') {
        throw new WorkspaceError('already-exists', 'The root folder exists.', { path: target })
      }
      if (await this.tryStat(target, options.signal)) {
        throw new WorkspaceError('already-exists', 'The folder already exists.', { path: target })
      }
      const parentPath = dirname(target)
      if (parentPath !== '/') {
        const parent = await this.tryStat(parentPath, options.signal)
        if (!parent) {
          if (!options.recursive) {
            throw new WorkspaceError('not-found', 'The parent folder does not exist.', {
              path: target,
            })
          }
        } else if (parent.kind !== 'directory') {
          throw new WorkspaceError('not-a-directory', 'The parent is not a folder.', {
            path: target,
          })
        }
      }
      await abortable(this.client.mkdir(this.remote(target)), options.signal, target)
    } catch (error) {
      throw this.map(error, target, options.signal)
    }
  }

  async remove(
    path: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    this.assertUsable()
    const target = normalizePath(path)
    try {
      this.assertWritable(target)
      if (target === '/') {
        throw new WorkspaceError('permission-denied', 'The root cannot be removed.', {
          path: target,
        })
      }
      const existing = await this.tryStat(target, options.signal)
      if (!existing) {
        throw new WorkspaceError('not-found', 'The path does not exist.', { path: target })
      }
      if (existing.kind === 'directory' && !options.recursive) {
        const children = await abortable(
          this.client.list(this.remote(target)),
          options.signal,
          target,
        )
        if (children.length > 0) {
          throw new WorkspaceError('io', 'The folder is not empty.', { path: target })
        }
      }
      await abortable(this.client.remove(this.remote(target)), options.signal, target)
    } catch (error) {
      throw this.map(error, target, options.signal)
    }
  }

  async move(
    from: WorkspacePath,
    to: WorkspacePath,
    options: { overwrite?: boolean; signal?: AbortSignal } = {},
  ): Promise<FileStat> {
    this.assertUsable()
    const source = normalizePath(from)
    const target = normalizePath(to)
    try {
      this.assertWritable(source)
      if (source === '/' || target === '/') {
        throw new WorkspaceError('permission-denied', 'The root cannot be moved.', { path: source })
      }
      if (pathIsUnder(target, source)) {
        throw new WorkspaceError('io', 'A folder cannot move inside itself.', { path: target })
      }
      if (!(await this.tryStat(source, options.signal))) {
        throw new WorkspaceError('not-found', 'The source does not exist.', { path: source })
      }
      const existing = await this.tryStat(target, options.signal)
      if (existing) {
        if (!options.overwrite) {
          throw new WorkspaceError('already-exists', 'The target already exists.', {
            path: target,
          })
        }
        await abortable(this.client.remove(this.remote(target)), options.signal, target)
      }
      await abortable(
        this.client.move(this.remote(source), this.remote(target)),
        options.signal,
        source,
      )
      return await this.statInside(target, options.signal)
    } catch (error) {
      throw this.map(error, source, options.signal)
    }
  }

  private async listInside(
    path: WorkspacePath,
    options: ListOptions,
    signal?: AbortSignal,
  ): Promise<FileStat[]> {
    let entries: { name: string; dir: boolean; size: number; modtime: string; version: string }[]
    try {
      entries = await abortable(this.client.list(this.remote(path)), signal, path)
    } catch (error) {
      if (error instanceof StratofoldError && error.kind === 'notfound') {
        const stat = await this.statInside(path, signal)
        if (stat.kind === 'directory') return []
        throw new WorkspaceError('not-a-directory', 'The path is not a folder.', { path })
      }
      throw error
    }

    const stats: FileStat[] = entries.map((entry) => ({
      path: joinPath(path, entry.name),
      kind: entry.dir ? 'directory' : 'file',
      size: entry.dir ? 0 : entry.size,
      mtime: parseTime(entry.modtime),
      version: entry.version,
    }))

    if (options.depth === 'recursive') {
      for (const stat of stats.filter((entry) => entry.kind === 'directory')) {
        stats.push(...(await this.listInside(stat.path, options, signal)))
      }
    }
    return stats.sort((a, b) => comparePaths(a.path, b.path))
  }

  private async statInside(path: WorkspacePath, signal?: AbortSignal): Promise<FileStat> {
    try {
      const entry = await abortable(this.client.stat(this.remote(path)), signal, path)
      return {
        path,
        kind: entry.kind,
        size: entry.kind === 'file' ? entry.size : 0,
        mtime: parseTime(entry.mtime),
        version: entry.version,
      }
    } catch (error) {
      throw this.map(error, path, signal)
    }
  }

  private async tryStat(path: WorkspacePath, signal?: AbortSignal): Promise<FileStat | null> {
    try {
      return await this.statInside(path, signal)
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'not-found') return null
      throw error
    }
  }

  private async ensureParent(path: WorkspacePath, signal?: AbortSignal): Promise<void> {
    if (path === '/') return
    const existing = await this.tryStat(path, signal)
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new WorkspaceError('not-a-directory', 'The parent is not a folder.', { path })
      }
      return
    }
    await abortable(this.client.mkdir(this.remote(path)), signal, path)
  }

  private remote(path: WorkspacePath): string {
    return path === '/' ? '' : path.slice(1)
  }

  private assertWritable(path: WorkspacePath): void {
    if (!this.descriptor.capabilities.writable) {
      throw new WorkspaceError('unsupported', 'The remote workspace is read-only.', { path })
    }
  }

  private assertUsable(): void {
    if (this.isProviderDisposed()) {
      throw new WorkspaceError('io', 'The provider has been disposed.')
    }
    if (this.credentialRejected) {
      throw new WorkspaceError(
        'permission-denied',
        'The remote credential was rejected. Reconnect to continue.',
      )
    }
  }

  private map(error: unknown, path: WorkspacePath, signal?: AbortSignal): WorkspaceError {
    const rejection = rejectionOf(error)
    if (rejection) {
      this.credentialRejected = true
      this.onCredentialRejected?.(rejection)
    }
    return mapStratofoldError(error, path, signal)
  }
}

function parseTime(value: string): number {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
