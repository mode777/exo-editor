import {
  WorkspaceError,
  asWorkspaceError,
  type FileStat,
  type WorkspaceChange,
  type WorkspaceErrorCode,
  type WorkspacePath,
  type WorkspaceSession,
} from './contract'
import { basename, pathIsUnder } from './paths'
import { hasWorkspaceWrite } from '../plugins/manifest'
import type { ShellErrorCode } from '../plugins/protocol'
import type { EditorCandidate } from '../plugins/registry'
import type { HandlerSaveCompletion, HandlerSaveRequest } from '../plugins/handler'

export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024
export const BINARY_SNIFF_BYTES = 8 * 1024

const encoder = new TextEncoder()

export type NoEditorReason = 'binary' | 'too-large' | 'undecodable'
export type DocumentStatus = 'loading' | 'ready' | 'error' | 'no-editor' | 'plugin'
export type DocumentSurface = 'text' | 'plugin'
export type PluginPhase = 'mounting' | 'active' | 'failed'
export type ExternalChange = 'changed' | 'deleted'

export interface DocumentEditor {
  identity: string
  pluginId: string
  pluginName: string
  label: string
  entryUrl: string
  /** `workspace:write` declared and the workspace session is writable. */
  canWrite: boolean
}

export interface PluginError {
  code: ShellErrorCode
  message?: string
}

export type PluginOpenResult =
  { ok: true } | { ok: false; reason: 'cap' | 'failed'; message?: string }

export interface PluginCallbacks {
  onActive: () => void
  onDirty: (dirty: boolean) => void
  onFailure: (failure: {
    code: ShellErrorCode
    phase: 'ready' | 'editor'
    message?: string
  }) => void
  onVersion: (version: string) => void
}

/** The per-workspace handler pool, seen from the document store. */
export interface DocumentEditorHost {
  candidates(path: WorkspacePath): EditorCandidate[]
  open(
    input: { path: WorkspacePath; file: FileStat; candidate: EditorCandidate },
    callbacks: PluginCallbacks,
  ): PluginOpenResult
  close(path: WorkspacePath): void
  save(path: WorkspacePath): Promise<HandlerSaveRequest>
  completeSave(path: WorkspacePath, result: HandlerSaveCompletion): void
  notifyChange(change: WorkspaceChange): void
  rename(previousPath: WorkspacePath, nextPath: WorkspacePath): void
  dirtySequence(path: WorkspacePath): number
}

export interface DocumentState {
  path: WorkspacePath
  title: string
  status: DocumentStatus
  surface: DocumentSurface
  text: string
  savedText: string
  version: string
  size: number
  dirty: boolean
  readOnly: boolean
  external: ExternalChange | null
  noEditorReason?: NoEditorReason
  error?: WorkspaceErrorCode
  editor?: DocumentEditor
  pluginPhase?: PluginPhase
  pluginNotice?: string
  pluginError?: PluginError
  loadId: number
}

export interface DocumentStoreOptions {
  getSession: () => WorkspaceSession | null
  onDirtyChange?: (path: WorkspacePath, dirty: boolean) => void
  /** A successful write from either surface; the event bus publishes it. */
  onSaved?: (change: WorkspaceChange) => void
  editors?: DocumentEditorHost
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
  private readonly preferredEditors = new Map<WorkspacePath, EditorCandidate>()
  private readonly textOnly = new Set<WorkspacePath>()
  private readonly openNotices = new Map<WorkspacePath, string>()
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
      surface: 'text',
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
      this.openNotices.delete(path)
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
    if (!document) return false
    if (document.surface === 'plugin') return this.savePlugin(path, document)
    if (document.status !== 'ready' || document.readOnly) {
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
        this.options.onSaved?.({ kind: 'changed', path, stat })
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

  private savePlugin(path: WorkspacePath, document: DocumentState): Promise<boolean> {
    const editors = this.options.editors
    const session = this.options.getSession()
    if (!editors || !session) return Promise.resolve(false)
    if (document.pluginPhase !== 'active') {
      this.setPluginError(path, { code: 'internal', message: 'The plugin editor is not running.' })
      return Promise.resolve(false)
    }
    if (document.external === 'deleted') return Promise.resolve(false)
    if (!document.editor?.canWrite) {
      this.setPluginError(path, { code: 'permission-denied' })
      return Promise.resolve(false)
    }

    const generation = this.generation
    const dirtyBefore = editors.dirtySequence(path)
    const controller = new AbortController()
    this.saveControllers.set(path, controller)

    const promise = (async () => {
      try {
        const request = await editors.save(path)
        if (generation !== this.generation) return false
        if (!request.ok) {
          this.setPluginError(path, {
            code: request.code,
            message: request.code === 'timeout' ? 'The plugin did not respond in time.' : undefined,
          })
          return false
        }
        const bytes =
          'text' in request.content
            ? encoder.encode(request.content.text)
            : new Uint8Array(request.content.bytes)
        let stat
        try {
          stat = await session.write(path, bytes, {
            ifVersion: request.baseVersion,
            signal: controller.signal,
          })
        } catch (error) {
          if (generation !== this.generation) return false
          const mapped = asWorkspaceError(error, path)
          if (mapped.code === 'aborted') return false
          editors.completeSave(path, { ok: false, code: shellCodeFor(mapped.code) })
          this.setPluginError(path, {
            code: shellCodeFor(mapped.code),
            external: mapped.code === 'conflict' ? 'changed' : undefined,
          })
          return false
        }
        if (generation !== this.generation) return false
        const current = this.documents.get(path)
        if (!current) return false
        const dirty = editors.dirtySequence(path) !== dirtyBefore
        this.documents.set(path, {
          ...current,
          version: stat.version,
          size: stat.size,
          dirty,
          external: null,
          pluginError: undefined,
        })
        editors.completeSave(path, { ok: true, version: stat.version })
        this.syncOpenDocuments()
        this.emit(path)
        this.options.onDirtyChange?.(path, dirty)
        this.options.onSaved?.({ kind: 'changed', path, stat })
        return true
      } finally {
        this.saveControllers.delete(path)
        this.pendingSaves.delete(path)
      }
    })()
    this.pendingSaves.set(path, promise)
    return promise
  }

  private setPluginError(
    path: WorkspacePath,
    error: { code: ShellErrorCode; message?: string; external?: ExternalChange },
  ): void {
    const document = this.documents.get(path)
    if (!document) return
    this.documents.set(path, {
      ...document,
      pluginError: { code: error.code, message: error.message },
      external: error.external ?? document.external,
    })
    this.emit(path)
  }

  async reload(path: WorkspacePath): Promise<DocumentState | undefined> {
    this.abortSave(path)
    const document = this.documents.get(path)
    if (document?.surface === 'plugin') {
      this.options.editors?.close(path)
    }
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
    this.options.editors?.rename(previousPath, nextPath)
    const preferred = this.preferredEditors.get(previousPath)
    if (preferred) {
      this.preferredEditors.delete(previousPath)
      this.preferredEditors.set(nextPath, preferred)
    }
    if (this.textOnly.delete(previousPath)) this.textOnly.add(nextPath)
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
    const document = this.documents.get(path)
    if (document?.surface === 'plugin') this.options.editors?.close(path)
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
      if (this.documents.get(candidate)?.surface === 'plugin') {
        this.options.editors?.close(candidate)
      }
      this.documents.delete(candidate)
      this.emit(candidate)
      this.options.onDirtyChange?.(candidate, false)
      changed = true
    }
    if (changed) this.syncOpenDocuments()
  }

  applyExternal(change: WorkspaceChange): void {
    this.options.editors?.notifyChange(change)
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
    for (const document of this.documents.values()) {
      if (document.surface === 'plugin') this.options.editors?.close(document.path)
    }
    const paths = [...this.documents.keys()]
    this.documents.clear()
    this.preferredEditors.clear()
    this.textOnly.clear()
    this.openNotices.clear()
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
      if (this.options.editors && !this.textOnly.has(path)) {
        const candidates = this.options.editors.candidates(path)
        if (candidates.length > 0) {
          const candidate = this.preferredEditors.get(path) ?? candidates[0]
          const canWrite =
            session.capabilities().writable && hasWorkspaceWrite(candidate.permissions)
          const result = this.options.editors.open(
            { path, file: stat, candidate },
            {
              onActive: () => this.pluginActive(path),
              onDirty: (dirty) => this.pluginDirty(path, dirty),
              onFailure: (failure) => this.pluginFailure(path, failure),
              onVersion: (version) => this.pluginVersion(path, version),
            },
          )
          if (result.ok) {
            this.documents.set(path, {
              path,
              title: titleFor(path),
              status: 'plugin',
              surface: 'plugin',
              text: '',
              savedText: '',
              version: stat.version,
              size: stat.size,
              dirty: false,
              readOnly: !canWrite,
              external: null,
              editor: {
                identity: candidate.identity,
                pluginId: candidate.pluginId,
                pluginName: candidate.pluginName,
                label: candidate.label,
                entryUrl: candidate.entryUrl,
                canWrite,
              },
              pluginPhase: 'mounting',
              loadId: ++this.loadSequence,
            })
            this.syncOpenDocuments()
            this.emit(path)
            this.options.onDirtyChange?.(path, false)
            return this.documents.get(path)
          }
          this.openNotices.set(
            path,
            result.reason === 'cap'
              ? 'This plugin already has 20 open editors. Using the text editor.'
              : 'The plugin editor could not start. Using the text editor.',
          )
        }
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
        surface: 'text',
        pluginNotice: this.openNotices.get(path),
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
      surface: 'text',
      pluginNotice: this.openNotices.get(path),
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
      surface: 'text',
      pluginNotice: this.openNotices.get(path),
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

  private pluginActive(path: WorkspacePath): void {
    const document = this.documents.get(path)
    if (!document || document.surface !== 'plugin') return
    this.documents.set(path, { ...document, pluginPhase: 'active', pluginError: undefined })
    this.emit(path)
  }

  private pluginDirty(path: WorkspacePath, dirty: boolean): void {
    const document = this.documents.get(path)
    if (!document || document.surface !== 'plugin') return
    if (document.dirty === dirty) return
    this.documents.set(path, { ...document, dirty })
    this.emit(path)
    this.options.onDirtyChange?.(path, dirty)
  }

  private pluginFailure(
    path: WorkspacePath,
    failure: { code: ShellErrorCode; phase: 'ready' | 'editor'; message?: string },
  ): void {
    const document = this.documents.get(path)
    if (!document || document.surface !== 'plugin') return
    if (failure.phase === 'ready') {
      this.openNotices.set(path, 'The plugin editor did not start. Using the text editor.')
      void this.openInText(path)
      return
    }
    this.documents.set(path, {
      ...document,
      pluginPhase: 'failed',
      readOnly: true,
      pluginError: { code: failure.code, message: failure.message },
    })
    this.emit(path)
  }

  private pluginVersion(path: WorkspacePath, version: string): void {
    const document = this.documents.get(path)
    if (!document || document.surface !== 'plugin') return
    if (document.version === version) return
    this.documents.set(path, { ...document, version })
    this.syncOpenDocuments()
    this.emit(path)
  }

  candidatesFor(path: WorkspacePath): EditorCandidate[] {
    return this.options.editors?.candidates(path) ?? []
  }

  /** Re-mount a document with another matching editor. */
  async chooseEditor(
    path: WorkspacePath,
    candidate: EditorCandidate,
  ): Promise<DocumentState | undefined> {
    this.preferredEditors.set(path, candidate)
    this.textOnly.delete(path)
    const document = this.documents.get(path)
    if (document?.surface === 'plugin') {
      this.abortSave(path)
      this.options.editors?.close(path)
      this.documents.delete(path)
      this.emit(path)
    }
    return this.open(path)
  }

  /** Open the shell text surface for a path, ignoring plugin candidates. */
  async openInText(path: WorkspacePath): Promise<DocumentState | undefined> {
    this.textOnly.add(path)
    const document = this.documents.get(path)
    if (document?.surface === 'plugin') {
      this.abortSave(path)
      this.options.editors?.close(path)
      this.documents.delete(path)
      this.emit(path)
    }
    return this.open(path)
  }

  /** Fall back to text when the owning plugin is removed while the tab is clean. */
  handleHandlerClosed(path: WorkspacePath): void {
    const document = this.documents.get(path)
    if (!document || document.surface !== 'plugin') return
    if (document.dirty) {
      this.documents.set(path, {
        ...document,
        pluginPhase: 'failed',
        readOnly: true,
        pluginError: {
          code: 'internal',
          message: 'The plugin was removed. Unsaved changes lived in its frame and were lost.',
        },
      })
      this.emit(path)
      return
    }
    void this.openInText(path)
  }

  dirtyPathsFor(identity: string): WorkspacePath[] {
    return [...this.documents.values()]
      .filter(
        (document) =>
          document.surface === 'plugin' && document.dirty && document.editor?.identity === identity,
      )
      .map((document) => document.path)
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

function shellCodeFor(code: WorkspaceErrorCode): ShellErrorCode {
  switch (code) {
    case 'conflict':
      return 'conflict'
    case 'permission-denied':
      return 'permission-denied'
    case 'not-found':
      return 'not-found'
    case 'not-a-file':
    case 'not-a-directory':
      return 'not-a-file'
    case 'too-large':
      return 'too-large'
    default:
      return 'internal'
  }
}
