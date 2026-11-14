import {
  WorkspaceError,
  asWorkspaceError,
  type WorkspaceChange,
  type WorkspaceErrorCode,
  type WorkspacePath,
  type WorkspaceSession,
} from './contract'
import { basename, pathIsUnder } from './paths'

export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024
export const BINARY_SNIFF_BYTES = 8 * 1024

const encoder = new TextEncoder()

export type NoEditorReason = 'binary' | 'too-large' | 'undecodable'
export type DocumentStatus = 'loading' | 'ready' | 'error' | 'no-editor'
export type ExternalChange = 'changed' | 'deleted'

export interface DocumentState {
  path: WorkspacePath
  title: string
  status: DocumentStatus
  text: string
  savedText: string
  version: string
  size: number
  dirty: boolean
  readOnly: boolean
  external: ExternalChange | null
  noEditorReason?: NoEditorReason
  error?: WorkspaceErrorCode
  loadId: number
}

export interface DocumentStoreOptions {
  getSession: () => WorkspaceSession | null
  onDirtyChange?: (path: WorkspacePath, dirty: boolean) => void
}

function titleFor(path: WorkspacePath): string {
  return basename(path)
}

function isBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength, BINARY_SNIFF_BYTES)
  for (let index = 0; index < end; index += 1) {
    if (bytes[index] === 0) return true
  }
  return false
}

/**
 * Document buffers live here, not in the preset: the preset renders only the
 * active tab and recreates the body on every tab switch. Dirty state is owned by
 * this surface and mirrored onto the tab.
 */
export class DocumentStore {
  private readonly options: DocumentStoreOptions
  private readonly documents = new Map<WorkspacePath, DocumentState>()
  private readonly listeners = new Map<WorkspacePath, Set<() => void>>()
  private readonly anyListeners = new Set<() => void>()
  private readonly pendingOpens = new Map<WorkspacePath, Promise<DocumentState | undefined>>()
  private readonly pendingSaves = new Map<WorkspacePath, Promise<boolean>>()
  private readonly saveControllers = new Map<WorkspacePath, AbortController>()
  private generation = 0
  private loadSequence = 0

  constructor(options: DocumentStoreOptions) {
    this.options = options
  }

  subscribe(path: WorkspacePath, listener: () => void): () => void {
    let set = this.listeners.get(path)
    if (!set) {
      set = new Set()
      this.listeners.set(path, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set?.size === 0) this.listeners.delete(path)
    }
  }

  subscribeAny(listener: () => void): () => void {
    this.anyListeners.add(listener)
    return () => this.anyListeners.delete(listener)
  }

  get(path: WorkspacePath): DocumentState | undefined {
    return this.documents.get(path)
  }

  paths(): WorkspacePath[] {
    return [...this.documents.keys()]
  }

  hasDirty(): boolean {
    return [...this.documents.values()].some((document) => document.dirty)
  }

  dirtyPaths(): WorkspacePath[] {
    return [...this.documents.values()]
      .filter((document) => document.dirty)
      .map((document) => document.path)
  }

  hasDirtyUnder(path: WorkspacePath): boolean {
    return [...this.documents.values()].some(
      (document) => document.dirty && pathIsUnder(document.path, path),
    )
  }

  async open(path: WorkspacePath): Promise<DocumentState | undefined> {
    const pending = this.pendingOpens.get(path)
    if (pending) return pending
    const existing = this.documents.get(path)
    if (existing && existing.status !== 'error' && existing.status !== 'loading') {
      return existing
    }

    const generation = this.generation
    this.setDocument(path, {
      path,
      title: titleFor(path),
      status: 'loading',
      text: '',
      savedText: '',
      version: '',
      size: 0,
      dirty: false,
      readOnly: false,
      external: null,
      loadId: 0,
    })

    const promise = this.load(path, generation).finally(() => {
      this.pendingOpens.delete(path)
    })
    this.pendingOpens.set(path, promise)
    return promise
  }

  async retry(path: WorkspacePath): Promise<DocumentState | undefined> {
    this.documents.delete(path)
    this.emit(path)
    return this.open(path)
  }

  updateText(path: WorkspacePath, text: string): void {
    const document = this.documents.get(path)
    if (!document || document.status !== 'ready' || document.readOnly) return
    const dirty = text !== document.savedText
    const changed = document.text !== text || document.dirty !== dirty
    this.documents.set(path, { ...document, text, dirty })
    if (changed) {
      this.emit(path)
      if (document.dirty !== dirty) this.options.onDirtyChange?.(path, dirty)
    }
  }

  async save(path: WorkspacePath): Promise<boolean> {
    const existingSave = this.pendingSaves.get(path)
    if (existingSave) return existingSave
    const document = this.documents.get(path)
    if (!document || document.status !== 'ready' || document.readOnly) {
      return false
    }
    if (document.external === 'deleted') return false

    const session = this.options.getSession()
    if (!session) return false

    const generation = this.generation
    const snapshotText = document.text
    const version = document.version
    const controller = new AbortController()
    this.saveControllers.set(path, controller)

    const promise = (async () => {
      try {
        const stat = await session.write(path, encoder.encode(snapshotText), {
          ifVersion: version,
          signal: controller.signal,
        })
        if (generation !== this.generation) return false
        const current = this.documents.get(path)
        if (!current) return false
        const dirty = current.text !== snapshotText
        this.documents.set(path, {
          ...current,
          version: stat.version,
          size: stat.size,
          savedText: snapshotText,
          dirty,
          external: null,
          error: undefined,
        })
        this.syncOpenDocuments()
        this.emit(path)
        this.options.onDirtyChange?.(path, dirty)
        return true
      } catch (error) {
        if (generation !== this.generation) return false
        const current = this.documents.get(path)
        if (!current) return false
        const mapped = asWorkspaceError(error, path)
        if (mapped.code === 'aborted') return false
        this.documents.set(path, {
          ...current,
          error: mapped.code,
          external: mapped.code === 'conflict' ? 'changed' : current.external,
        })
        this.emit(path)
        return false
      } finally {
        this.saveControllers.delete(path)
        this.pendingSaves.delete(path)
      }
    })()
    this.pendingSaves.set(path, promise)
    return promise
  }

  async reload(path: WorkspacePath): Promise<DocumentState | undefined> {
    this.abortSave(path)
    this.documents.delete(path)
    this.emit(path)
    return this.open(path)
  }

  rename(
    previousPath: WorkspacePath,
    nextPath: WorkspacePath,
    stat: {
      version: string
      size: number
    },
  ): void {
    const document = this.documents.get(previousPath)
    if (!document) return
    this.abortSave(previousPath)
    this.documents.delete(previousPath)
    const next: DocumentState = {
      ...document,
      path: nextPath,
      title: titleFor(nextPath),
      version: stat.version,
      size: stat.size,
    }
    this.documents.set(nextPath, next)
    this.emit(previousPath)
    this.emit(nextPath)
    this.syncOpenDocuments()
  }

  close(path: WorkspacePath): void {
    this.abortSave(path)
    if (!this.documents.delete(path)) return
    this.emit(path)
    this.syncOpenDocuments()
    this.options.onDirtyChange?.(path, false)
  }

  deleteUnder(path: WorkspacePath): void {
    let changed = false
    for (const candidate of [...this.documents.keys()]) {
      if (!pathIsUnder(candidate, path)) continue
      this.abortSave(candidate)
      this.documents.delete(candidate)
      this.emit(candidate)
      this.options.onDirtyChange?.(candidate, false)
      changed = true
    }
    if (changed) this.syncOpenDocuments()
  }

  applyExternal(change: WorkspaceChange): void {
    if (change.kind === 'renamed') {
      const document = this.documents.get(change.previousPath)
      if (document) this.rename(change.previousPath, change.path, change.stat)
      return
    }
    const document = this.documents.get(change.path)
    if (!document) return
    if (change.kind === 'deleted') {
      this.documents.set(change.path, { ...document, external: 'deleted' })
    } else {
      this.documents.set(change.path, { ...document, external: 'changed' })
    }
    this.emit(change.path)
  }

  clear(): void {
    this.generation += 1
    for (const controller of this.saveControllers.values()) controller.abort()
    this.saveControllers.clear()
    this.pendingSaves.clear()
    this.pendingOpens.clear()
    const paths = [...this.documents.keys()]
    this.documents.clear()
    for (const path of paths) this.emit(path)
    this.notifyAny()
  }

  syncOpenDocuments(): void {
    const session = this.options.getSession()
    if (!session) return
    session.setOpenDocuments(
      [...this.documents.values()]
        .filter((document) => document.version.length > 0)
        .map((document) => ({ path: document.path, version: document.version })),
    )
  }

  private async load(path: WorkspacePath, generation: number): Promise<DocumentState | undefined> {
    const session = this.options.getSession()
    if (!session) {
      this.setError(path, 'unsupported')
      return undefined
    }
    try {
      const stat = await session.stat(path)
      if (generation !== this.generation) return undefined
      if (stat.kind !== 'file') {
        throw new WorkspaceError('not-a-file', 'The path is not a file.', {
          path,
        })
      }
      if (stat.size > MAX_TEXT_FILE_BYTES) {
        this.setNoEditor(path, stat, 'too-large')
        return this.documents.get(path)
      }
      const bytes = await session.read(path, { maxBytes: MAX_TEXT_FILE_BYTES })
      if (generation !== this.generation) return undefined
      if (isBinary(bytes)) {
        this.setNoEditor(path, stat, 'binary')
        return this.documents.get(path)
      }
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        this.setNoEditor(path, stat, 'undecodable')
        return this.documents.get(path)
      }
      const next: DocumentState = {
        path,
        title: titleFor(path),
        status: 'ready',
        text,
        savedText: text,
        version: stat.version,
        size: stat.size,
        dirty: false,
        readOnly: false,
        external: null,
        loadId: ++this.loadSequence,
      }
      this.documents.set(path, next)
      this.syncOpenDocuments()
      this.emit(path)
      this.options.onDirtyChange?.(path, false)
      return next
    } catch (error) {
      if (generation !== this.generation) return undefined
      const mapped = asWorkspaceError(error, path)
      this.setError(path, mapped.code)
      return this.documents.get(path)
    }
  }

  private setNoEditor(
    path: WorkspacePath,
    stat: { version: string; size: number },
    reason: NoEditorReason,
  ): void {
    this.documents.set(path, {
      path,
      title: titleFor(path),
      status: 'no-editor',
      text: '',
      savedText: '',
      version: stat.version,
      size: stat.size,
      dirty: false,
      readOnly: true,
      external: null,
      noEditorReason: reason,
      loadId: ++this.loadSequence,
    })
    this.syncOpenDocuments()
    this.emit(path)
    this.options.onDirtyChange?.(path, false)
  }

  private setError(path: WorkspacePath, code: WorkspaceErrorCode): void {
    this.documents.set(path, {
      path,
      title: titleFor(path),
      status: 'error',
      text: '',
      savedText: '',
      version: '',
      size: 0,
      dirty: false,
      readOnly: true,
      external: null,
      error: code,
      loadId: 0,
    })
    this.emit(path)
    this.options.onDirtyChange?.(path, false)
  }

  private setDocument(path: WorkspacePath, document: DocumentState): void {
    this.documents.set(path, document)
    this.emit(path)
  }

  private abortSave(path: WorkspacePath): void {
    this.saveControllers.get(path)?.abort()
    this.saveControllers.delete(path)
  }

  private emit(path: WorkspacePath): void {
    for (const listener of this.listeners.get(path) ?? []) listener()
    this.notifyAny()
  }

  private notifyAny(): void {
    for (const listener of this.anyListeners) listener()
  }
}
