import {
  WorkspaceError,
  type Disposable,
  type FileStat,
  type ListOptions,
  type ReadOptions,
  type WorkspaceCapabilities,
  type WorkspaceChange,
  type WorkspaceDescriptor,
  type WorkspaceHandle,
  type WorkspacePath,
  type WorkspaceProvider,
  type WriteOptions,
} from '../contract'
import { dirname, normalizePath, pathIsUnder } from '../paths'

interface MemoryNode {
  kind: 'file' | 'directory'
  content: Uint8Array
  mtime: number
  version: number
}

interface WatchRegistration {
  paths: WorkspacePath[]
  onChange: (change: WorkspaceChange) => void
}

export interface MemoryProviderOptions {
  name?: string
  now?: () => number
  initialFiles?: Record<string, string | Uint8Array>
  initialDirectories?: string[]
  writable?: boolean
  watchable?: boolean
  caseSensitive?: boolean
}

const encoder = new TextEncoder()

function copyBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data)
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : copyBytes(value)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new WorkspaceError('aborted', 'The workspace operation was cancelled.')
  }
}

export class MemoryWorkspaceProvider implements WorkspaceProvider {
  readonly kind = 'memory'
  readonly label = 'Memory workspace'

  private readonly name: string
  private readonly now: () => number
  private readonly writable: boolean
  private readonly watchable: boolean
  private readonly caseSensitive: boolean
  private readonly nodes = new Map<WorkspacePath, MemoryNode>()
  private readonly watches = new Set<WatchRegistration>()
  private disposed = false

  constructor(options: MemoryProviderOptions = {}) {
    this.name = options.name ?? 'memory-workspace'
    this.now = options.now ?? (() => Date.now())
    this.writable = options.writable ?? true
    this.watchable = options.watchable ?? true
    this.caseSensitive = options.caseSensitive ?? true
    this.nodes.set('/', {
      kind: 'directory',
      content: new Uint8Array(),
      mtime: this.now(),
      version: 1,
    })
    for (const directory of options.initialDirectories ?? []) {
      const path = normalizePath(directory)
      this.mkdirSync(path, true)
    }
    for (const [path, content] of Object.entries(options.initialFiles ?? {})) {
      this.writeSync(path, toBytes(content), true)
    }
  }

  capabilities(): WorkspaceCapabilities {
    return {
      writable: this.writable,
      watchable: this.watchable,
      persistent: false,
      caseSensitive: this.caseSensitive,
    }
  }

  async open(): Promise<WorkspaceHandle> {
    this.assertUsable()
    return new MemoryWorkspaceHandle(this, {
      id: `${this.kind}:${this.name}`,
      name: this.name,
      providerKind: this.kind,
      capabilities: this.capabilities(),
    })
  }

  dispose(): void {
    this.disposed = true
    this.watches.clear()
    this.nodes.clear()
  }

  /** Test oracle helper: seed or replace a file after construction. */
  seed(path: WorkspacePath, content: string | Uint8Array): void {
    this.assertUsable()
    this.writeSync(path, toBytes(content), true)
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new WorkspaceError('io', 'The provider has been disposed.')
    }
  }

  private writeSync(path: WorkspacePath, data: Uint8Array, create: boolean): FileStat {
    const target = normalizePath(path)
    if (target === '/') {
      throw new WorkspaceError('not-a-file', 'The root is a directory.', { path: target })
    }
    const existing = this.nodes.get(target)
    if (existing?.kind === 'directory') {
      throw new WorkspaceError('not-a-file', 'The path is a directory.', { path: target })
    }
    if (!existing && !create) {
      throw new WorkspaceError('not-found', 'The file does not exist.', { path: target })
    }
    const parent = dirname(target)
    if (create) this.mkdirSync(parent, true)
    this.requireDirectory(parent)

    const node: MemoryNode = existing ?? {
      kind: 'file',
      content: new Uint8Array(),
      mtime: this.now(),
      version: 0,
    }
    node.content = copyBytes(data)
    node.mtime = this.now()
    node.version += 1
    this.nodes.set(target, node)
    this.emit(
      existing
        ? { kind: 'changed', path: target, stat: this.statSync(target) }
        : { kind: 'created', path: target, stat: this.statSync(target) },
    )
    return this.statSync(target)
  }

  private mkdirSync(path: WorkspacePath, recursive: boolean): void {
    const target = normalizePath(path)
    if (target === '/') return
    const existing = this.nodes.get(target)
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new WorkspaceError('not-a-directory', 'A file is in the way.', {
          path: target,
        })
      }
      return
    }
    const parent = dirname(target)
    if (!this.nodes.has(parent)) {
      if (!recursive) {
        throw new WorkspaceError('not-found', 'The parent directory is missing.', {
          path: target,
        })
      }
      this.mkdirSync(parent, true)
    }
    this.requireDirectory(parent)
    this.nodes.set(target, {
      kind: 'directory',
      content: new Uint8Array(),
      mtime: this.now(),
      version: 1,
    })
    this.emit({ kind: 'created', path: target, stat: this.statSync(target) })
  }

  private requireDirectory(path: WorkspacePath): MemoryNode {
    const node = this.nodes.get(path)
    if (!node) {
      throw new WorkspaceError('not-found', 'The directory does not exist.', { path })
    }
    if (node.kind !== 'directory') {
      throw new WorkspaceError('not-a-directory', 'The path is a file.', { path })
    }
    return node
  }

  private statSync(path: WorkspacePath): FileStat {
    const node = this.nodes.get(path)
    if (!node) {
      throw new WorkspaceError('not-found', 'The path does not exist.', { path })
    }
    return {
      path,
      kind: node.kind,
      size: node.kind === 'file' ? node.content.byteLength : 0,
      mtime: node.mtime,
      version: node.kind === 'file' ? `m${node.version}` : `d${node.version}`,
    }
  }

  private assertUsableOperation(signal?: AbortSignal): void {
    this.assertUsable()
    throwIfAborted(signal)
  }

  list(path: WorkspacePath, options: ListOptions = {}): Promise<FileStat[]> {
    try {
      this.assertUsableOperation(options.signal)
      const target = normalizePath(path)
      this.requireDirectory(target)
      const entries = [...this.nodes.keys()]
        .filter((candidate) => candidate !== target)
        .filter((candidate) => pathIsUnder(candidate, target))
        .filter((candidate) => {
          if (options.depth === 'recursive') return true
          return dirname(candidate) === target
        })
        .sort()
        .map((candidate) => this.statSync(candidate))
      return Promise.resolve(entries)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  stat(path: WorkspacePath, options: { signal?: AbortSignal } = {}): Promise<FileStat> {
    try {
      this.assertUsableOperation(options.signal)
      return Promise.resolve(this.statSync(normalizePath(path)))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  read(path: WorkspacePath, options: ReadOptions = {}): Promise<Uint8Array> {
    try {
      this.assertUsableOperation(options.signal)
      const target = normalizePath(path)
      const node = this.nodes.get(target)
      if (!node) {
        throw new WorkspaceError('not-found', 'The file does not exist.', { path: target })
      }
      if (node.kind !== 'file') {
        throw new WorkspaceError('not-a-file', 'The path is a directory.', { path: target })
      }
      if (options.maxBytes !== undefined && node.content.byteLength > options.maxBytes) {
        throw new WorkspaceError('too-large', 'The file is too large.', { path: target })
      }
      return Promise.resolve(copyBytes(node.content))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  write(path: WorkspacePath, data: Uint8Array, options: WriteOptions = {}): Promise<FileStat> {
    try {
      this.assertUsableOperation(options.signal)
      const target = normalizePath(path)
      const existing = this.nodes.get(target)
      if (options.ifVersion !== undefined) {
        if (!existing) {
          throw new WorkspaceError('not-found', 'The file does not exist.', {
            path: target,
          })
        }
        if (existing.kind !== 'file') {
          throw new WorkspaceError('not-a-file', 'The path is a directory.', {
            path: target,
          })
        }
        if (this.statSync(target).version !== options.ifVersion) {
          throw new WorkspaceError('conflict', 'The file changed on disk.', {
            path: target,
          })
        }
      }
      if (!this.writable) {
        throw new WorkspaceError('unsupported', 'The workspace is read-only.', {
          path: target,
        })
      }
      return Promise.resolve(this.writeSync(target, data, options.create ?? false))
    } catch (error) {
      return Promise.reject(error)
    }
  }

  mkdir(
    path: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    try {
      this.assertUsableOperation(options.signal)
      const target = normalizePath(path)
      if (!this.writable) {
        throw new WorkspaceError('unsupported', 'The workspace is read-only.', {
          path: target,
        })
      }
      if (target === '/' || this.nodes.has(target)) {
        throw new WorkspaceError('already-exists', 'The directory already exists.', {
          path: target,
        })
      }
      this.mkdirSync(target, options.recursive ?? false)
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  remove(
    path: WorkspacePath,
    options: { recursive?: boolean; signal?: AbortSignal } = {},
  ): Promise<void> {
    try {
      this.assertUsableOperation(options.signal)
      const target = normalizePath(path)
      if (target === '/') {
        throw new WorkspaceError('permission-denied', 'The workspace root cannot be removed.', {
          path: target,
        })
      }
      if (!this.writable) {
        throw new WorkspaceError('unsupported', 'The workspace is read-only.', {
          path: target,
        })
      }
      const node = this.nodes.get(target)
      if (!node) {
        throw new WorkspaceError('not-found', 'The path does not exist.', { path: target })
      }
      const descendants = [...this.nodes.keys()]
        .filter((candidate) => pathIsUnder(candidate, target))
        .sort((a, b) => b.length - a.length)
      if (node.kind === 'directory' && descendants.length > 1 && !options.recursive) {
        throw new WorkspaceError('io', 'The directory is not empty.', { path: target })
      }
      for (const candidate of descendants) {
        this.nodes.delete(candidate)
        this.emit({ kind: 'deleted', path: candidate })
      }
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(error)
    }
  }

  move(
    from: WorkspacePath,
    to: WorkspacePath,
    options: { overwrite?: boolean; signal?: AbortSignal } = {},
  ): Promise<FileStat> {
    try {
      this.assertUsableOperation(options.signal)
      const source = normalizePath(from)
      const target = normalizePath(to)
      if (source === '/' || target === '/') {
        throw new WorkspaceError('permission-denied', 'The workspace root cannot be moved.', {
          path: source,
        })
      }
      if (!this.writable) {
        throw new WorkspaceError('unsupported', 'The workspace is read-only.', {
          path: source,
        })
      }
      const node = this.nodes.get(source)
      if (!node) {
        throw new WorkspaceError('not-found', 'The source does not exist.', { path: source })
      }
      if (pathIsUnder(target, source)) {
        throw new WorkspaceError('io', 'A directory cannot move inside itself.', {
          path: target,
        })
      }
      this.requireDirectory(dirname(target))
      const existing = this.nodes.get(target)
      if (existing && !options.overwrite) {
        throw new WorkspaceError('already-exists', 'The target already exists.', {
          path: target,
        })
      }
      if (existing) {
        const removed = [...this.nodes.keys()]
          .filter((candidate) => pathIsUnder(candidate, target))
          .sort((a, b) => b.length - a.length)
        for (const candidate of removed) {
          this.nodes.delete(candidate)
          this.emit({ kind: 'deleted', path: candidate })
        }
      }
      const moved = [...this.nodes.entries()]
        .filter(([candidate]) => pathIsUnder(candidate, source))
        .sort(([a], [b]) => a.localeCompare(b))
      for (const [candidate, value] of moved) {
        const next = `${target}${candidate.slice(source.length)}`
        this.nodes.delete(candidate)
        if (value.kind === 'file') value.version += 1
        value.mtime = this.now()
        this.nodes.set(next, value)
      }
      const result = this.statSync(target)
      this.emit({ kind: 'renamed', path: target, previousPath: source, stat: result })
      return Promise.resolve(result)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  watch(paths: WorkspacePath[], onChange: (change: WorkspaceChange) => void): Disposable {
    this.assertUsable()
    const registration: WatchRegistration = {
      paths: paths.map(normalizePath),
      onChange,
    }
    this.watches.add(registration)
    return {
      dispose: () => {
        this.watches.delete(registration)
      },
    }
  }

  private emit(change: WorkspaceChange): void {
    for (const registration of [...this.watches]) {
      if (
        registration.paths.length > 0 &&
        !registration.paths.some((path) => pathIsUnder(change.path, path))
      ) {
        continue
      }
      try {
        registration.onChange(change)
      } catch {
        // Watch callbacks must never break a mutation.
      }
    }
  }
}

class MemoryWorkspaceHandle implements WorkspaceHandle {
  readonly descriptor: WorkspaceDescriptor
  private readonly provider: MemoryWorkspaceProvider

  constructor(provider: MemoryWorkspaceProvider, descriptor: WorkspaceDescriptor) {
    this.provider = provider
    this.descriptor = descriptor
  }

  list(path: WorkspacePath, options?: ListOptions): Promise<FileStat[]> {
    return this.provider.list(path, options)
  }

  stat(path: WorkspacePath, options?: { signal?: AbortSignal }): Promise<FileStat> {
    return this.provider.stat(path, options)
  }

  read(path: WorkspacePath, options?: ReadOptions): Promise<Uint8Array> {
    return this.provider.read(path, options)
  }

  write(path: WorkspacePath, data: Uint8Array, options?: WriteOptions): Promise<FileStat> {
    return this.provider.write(path, data, options)
  }

  mkdir(
    path: WorkspacePath,
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    return this.provider.mkdir(path, options)
  }

  remove(
    path: WorkspacePath,
    options?: { recursive?: boolean; signal?: AbortSignal },
  ): Promise<void> {
    return this.provider.remove(path, options)
  }

  move(
    from: WorkspacePath,
    to: WorkspacePath,
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<FileStat> {
    return this.provider.move(from, to, options)
  }

  watch(paths: WorkspacePath[], onChange: (change: WorkspaceChange) => void): Disposable {
    return this.provider.watch(paths, onChange)
  }
}
