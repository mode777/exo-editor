import type { MovableHandle, PermissionMode } from './fsa'

type FakeKind = 'file' | 'directory'

interface FakeNode {
  kind: FakeKind
  name: string
  content: Uint8Array
  lastModified: number
  children: Map<string, FakeNode>
  permissions: Record<PermissionMode, PermissionState>
  requestResult: Record<PermissionMode, PermissionState>
  parent: FakeNode | null
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function domException(name: string, message = name): DOMException {
  return new DOMException(message, name)
}

function makeNode(kind: FakeKind, name: string, parent: FakeNode | null, content = ''): FakeNode {
  return {
    kind,
    name,
    content: encoder.encode(content),
    lastModified: 1000,
    children: new Map(),
    permissions: { read: 'granted', readwrite: 'granted' },
    requestResult: { read: 'granted', readwrite: 'granted' },
    parent,
  }
}

export class FakeDirectoryHandle implements FileSystemDirectoryHandle {
  readonly kind = 'directory' as const
  private readonly node: FakeNode

  constructor(node: FakeNode) {
    this.node = node
  }

  get name(): string {
    return this.node.name
  }

  isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return Promise.resolve(
      other instanceof FakeDirectoryHandle &&
        (other as unknown as { node: FakeNode }).node === this.node,
    )
  }

  async getDirectoryHandle(
    name: string,
    options: FileSystemGetDirectoryOptions = {},
  ): Promise<FileSystemDirectoryHandle> {
    const child = this.node.children.get(name)
    if (child) {
      if (child.kind !== 'directory') throw domException('TypeMismatchError')
      return new FakeDirectoryHandle(child)
    }
    if (!options.create) throw domException('NotFoundError')
    const created = makeNode('directory', name, this.node)
    this.node.children.set(name, created)
    return new FakeDirectoryHandle(created)
  }

  async getFileHandle(
    name: string,
    options: FileSystemGetFileOptions = {},
  ): Promise<FileSystemFileHandle> {
    const child = this.node.children.get(name)
    if (child) {
      if (child.kind !== 'file') throw domException('TypeMismatchError')
      return new FakeFileHandle(child)
    }
    if (!options.create) throw domException('NotFoundError')
    const created = makeNode('file', name, this.node)
    this.node.children.set(name, created)
    return new FakeFileHandle(created)
  }

  async removeEntry(name: string, options: FileSystemRemoveOptions = {}): Promise<void> {
    const child = this.node.children.get(name)
    if (!child) throw domException('NotFoundError')
    if (child.kind === 'directory' && child.children.size > 0 && !options.recursive) {
      throw domException('InvalidModificationError')
    }
    this.node.children.delete(name)
  }

  async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    if (!(possibleDescendant instanceof FakeDirectoryHandle)) return null
    const target = (possibleDescendant as unknown as { node: FakeNode }).node
    const segments: string[] = []
    let current: FakeNode | null = target
    while (current && current !== this.node) {
      segments.unshift(current.name)
      current = current.parent
    }
    return current === this.node ? segments : null
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, child] of this.node.children) {
      yield [
        name,
        child.kind === 'directory' ? new FakeDirectoryHandle(child) : new FakeFileHandle(child),
      ]
    }
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for await (const [, handle] of this.entries()) yield handle
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.node.children.keys()) yield name
  }

  queryPermission(descriptor: { mode?: PermissionMode } = {}): Promise<PermissionState> {
    return Promise.resolve(this.node.permissions[descriptor.mode ?? 'read'])
  }

  requestPermission(descriptor: { mode?: PermissionMode } = {}): Promise<PermissionState> {
    const mode = descriptor.mode ?? 'read'
    this.node.permissions[mode] = this.node.requestResult[mode]
    return Promise.resolve(this.node.permissions[mode])
  }

  setPermission(mode: PermissionMode, state: PermissionState): void {
    this.node.permissions[mode] = state
  }

  setRequestResult(mode: PermissionMode, state: PermissionState): void {
    this.node.requestResult[mode] = state
  }

  seedFile(path: string, content: string | Uint8Array): FakeFileHandle {
    const segments = path.split('/').filter(Boolean)
    let directory: FakeNode = this.node
    for (const segment of segments.slice(0, -1)) {
      const child = directory.children.get(segment)
      if (child) {
        if (child.kind !== 'directory') throw new Error(`not a directory: ${segment}`)
        directory = child
      } else {
        const created = makeNode('directory', segment, directory)
        directory.children.set(segment, created)
        directory = created
      }
    }
    const name = segments.at(-1) ?? 'file'
    const file = makeNode(
      'file',
      name,
      directory,
      typeof content === 'string' ? content : decoder.decode(content),
    )
    if (typeof content !== 'string') file.content = new Uint8Array(content)
    directory.children.set(name, file)
    return new FakeFileHandle(file)
  }

  seedDirectory(path: string): FakeDirectoryHandle {
    const segments = path.split('/').filter(Boolean)
    let directory: FakeNode = this.node
    for (const segment of segments) {
      const child = directory.children.get(segment)
      if (child) {
        if (child.kind !== 'directory') throw new Error(`not a directory: ${segment}`)
        directory = child
      } else {
        const created = makeNode('directory', segment, directory)
        directory.children.set(segment, created)
        directory = created
      }
    }
    return new FakeDirectoryHandle(directory)
  }

  readFile(path: string): string {
    const segments = path.split('/').filter(Boolean)
    let directory: FakeNode = this.node
    for (const segment of segments.slice(0, -1)) {
      const child = directory.children.get(segment)
      if (!child || child.kind !== 'directory') throw new Error(`missing ${path}`)
      directory = child
    }
    const child = directory.children.get(segments.at(-1) ?? '')
    if (!child || child.kind !== 'file') throw new Error(`missing ${path}`)
    return decoder.decode(child.content)
  }

  tree(): Record<string, string> {
    const output: Record<string, string> = {}
    const walk = (node: FakeNode, prefix: string) => {
      for (const [name, child] of node.children) {
        const path = prefix ? `${prefix}/${name}` : name
        if (child.kind === 'file') output[`/${path}`] = decoder.decode(child.content)
        else walk(child, path)
      }
    }
    walk(this.node, '')
    return output
  }
}

class FakeFileHandle implements FileSystemFileHandle, MovableHandle {
  readonly kind = 'file' as const
  private readonly node: FakeNode

  constructor(node: FakeNode) {
    this.node = node
  }

  get name(): string {
    return this.node.name
  }

  isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return Promise.resolve(
      other instanceof FakeFileHandle &&
        (other as unknown as { node: FakeNode }).node === this.node,
    )
  }

  getFile(): Promise<File> {
    const snapshot = new Uint8Array(this.node.content)
    const file = {
      name: this.node.name,
      size: snapshot.byteLength,
      lastModified: this.node.lastModified,
      type: 'text/plain',
      webkitRelativePath: '',
      arrayBuffer: () =>
        Promise.resolve(
          snapshot.buffer.slice(
            snapshot.byteOffset,
            snapshot.byteOffset + snapshot.byteLength,
          ) as ArrayBuffer,
        ),
      bytes: () => Promise.resolve(new Uint8Array(snapshot)),
      text: () => Promise.resolve(decoder.decode(snapshot)),
      slice: () => file,
      stream: () => new ReadableStream(),
    }
    return Promise.resolve(file as unknown as File)
  }

  createWritable(): Promise<FileSystemWritableFileStream> {
    const chunks: Uint8Array[] = []
    const stream = {
      write: async (data: BufferSource | Blob | string) => {
        if (typeof data === 'string') chunks.push(encoder.encode(data))
        else if (data instanceof Blob) chunks.push(new Uint8Array(await data.arrayBuffer()))
        else if (data instanceof ArrayBuffer) chunks.push(new Uint8Array(data.slice(0)))
        else {
          const view = data as ArrayBufferView
          const copy = new Uint8Array(view.byteLength)
          copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
          chunks.push(copy)
        }
      },
      close: async () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
        const merged = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) {
          merged.set(chunk, offset)
          offset += chunk.byteLength
        }
        this.node.content = merged
        this.node.lastModified += 1
      },
      abort: async () => undefined,
      seek: async () => undefined,
      truncate: async () => undefined,
      getWriter: () => {
        throw new Error('not implemented')
      },
      locked: false,
    }
    return Promise.resolve(stream as unknown as FileSystemWritableFileStream)
  }

  async move(destination: FileSystemDirectoryHandle | string, newName?: string): Promise<void> {
    const sourceParent = this.node.parent
    if (!sourceParent) throw domException('InvalidModificationError')
    let targetParent = sourceParent
    let targetName: string
    if (typeof destination === 'string') {
      targetName = destination
    } else {
      targetParent = (destination as unknown as { node: FakeNode }).node
      targetName = newName ?? this.node.name
    }
    if (targetParent.children.has(targetName)) throw domException('InvalidModificationError')
    sourceParent.children.delete(this.node.name)
    this.node.name = targetName
    this.node.parent = targetParent
    targetParent.children.set(targetName, this.node)
  }
}

export function createFakeWorkspace(name = 'workspace'): FakeDirectoryHandle {
  return new FakeDirectoryHandle(makeNode('directory', name, null))
}
