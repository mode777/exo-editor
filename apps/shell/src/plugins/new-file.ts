import {
  WorkspaceError,
  workspaceErrorMessage,
  type WorkspacePath,
  type WorkspaceSession,
} from '../workspace/contract'
import {
  isReservedName,
  isReservedPath,
  joinPath,
  normalizePath,
  validateEntryName,
} from '../workspace/paths'
import type { ShellErrorCode } from './protocol'

/** Bounded text preview shown in the Save As dialog. */
export const MAX_NEW_FILE_PREVIEW = 2000

export interface NewFileContent {
  bytes: Uint8Array
  /** Present for text content; absent for binary. */
  text?: string
}

interface NewFileBase {
  identity: string
  pluginId: string
  pluginName: string
  content: NewFileContent
  /** Default directory when the request has no usable hint. */
  fallbackDirectory: WorkspacePath
  session: WorkspaceSession
}

export interface NewFileRequest extends NewFileBase {
  kind: 'request'
  suggestedName?: string
  /** Optional hint; validated by the controller and otherwise ignored. */
  directory?: WorkspacePath
  signal: AbortSignal
}

export interface NewFileTemplateRequest extends NewFileBase {
  kind: 'template'
  templateId: string
  fileName: string
  directory: WorkspacePath
}

export type NewFileOutcome =
  | { ok: true; path: WorkspacePath; version: string }
  | { ok: false; code: ShellErrorCode; message?: string }
  | { ok: false; cancelled: true }
  | { ok: false; silent: true }

/** The modal snapshot. It never carries the raw request signal or dialog text. */
export interface NewFileView {
  kind: 'request' | 'template'
  identity: string
  pluginId: string
  pluginName: string
  directory: WorkspacePath
  name: string
  size: number
  /** Bounded preview for text content; absent for binary. */
  preview?: string
  binary: boolean
  error?: string
  session: WorkspaceSession
}

export interface NewFileLogEvent {
  identity: string
  phase: string
  code?: string
  message?: string
}

export type NewFileCreatedHandler = (path: WorkspacePath, kind: 'request' | 'template') => void

interface PendingNewFile {
  view: NewFileView
  request: NewFileRequest | NewFileTemplateRequest
  signal?: AbortSignal
  abort?: () => void
  resolve?: (outcome: NewFileOutcome) => void
}

function fallbackDirectoryOf(request: NewFileRequest): WorkspacePath {
  if (request.directory === undefined) return request.fallbackDirectory
  try {
    const path = normalizePath(request.directory)
    return isReservedPath(path, request.session.capabilities().caseSensitive)
      ? request.fallbackDirectory
      : path
  } catch {
    return request.fallbackDirectory
  }
}

function suggestedNameOf(request: NewFileRequest): string {
  if (request.suggestedName === undefined) return ''
  try {
    const name = validateEntryName(request.suggestedName)
    return isReservedName(name, request.session.capabilities().caseSensitive) ? '' : name
  } catch {
    return ''
  }
}

function previewOf(content: NewFileContent): string | undefined {
  if (content.text === undefined) return undefined
  return content.text.slice(0, MAX_NEW_FILE_PREVIEW)
}

/**
 * One workspace's shell-owned new-file flow. It owns the single pending dialog,
 * the target directory and name, the create-only write and the outcome. Runtime
 * requests resolve to the frame; template requests open the created tab. A
 * workspace switch, plugin removal or frame disposal settles without a write.
 */
export class NewFileController {
  private pending: PendingNewFile | null = null
  private snapshot: NewFileView | null = null
  private submitting = false
  private readonly listeners = new Set<() => void>()
  private readonly created: NewFileCreatedHandler | undefined
  private readonly onLog: ((event: NewFileLogEvent) => void) | undefined

  constructor(
    options: {
      onCreated?: NewFileCreatedHandler
      onLog?: (event: NewFileLogEvent) => void
    } = {},
  ) {
    this.created = options.onCreated
    this.onLog = options.onLog
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): NewFileView | null => this.snapshot

  /** Start a runtime request from an active frame. */
  request(request: NewFileRequest): Promise<NewFileOutcome> {
    if (this.pending) return Promise.resolve({ ok: false, code: 'rate-limited' })
    if (request.signal.aborted) return Promise.resolve({ ok: false, silent: true })
    return new Promise<NewFileOutcome>((resolve) => {
      const abort = () => {
        if (this.pending?.request !== request) return
        this.finish(this.pending, { ok: false, silent: true })
      }
      request.signal.addEventListener('abort', abort, { once: true })
      this.pending = {
        view: {
          kind: 'request',
          identity: request.identity,
          pluginId: request.pluginId,
          pluginName: request.pluginName,
          directory: fallbackDirectoryOf(request),
          name: suggestedNameOf(request),
          size: request.content.bytes.byteLength,
          ...(previewOf(request.content) === undefined
            ? {}
            : { preview: previewOf(request.content) }),
          binary: request.content.text === undefined,
          session: request.session,
        },
        request,
        signal: request.signal,
        abort,
        resolve,
      }
      this.snapshot = this.pending.view
      this.log(request.identity, 'new-file', 'open')
      this.notify()
    })
  }

  /** Start a manifest-template flow from shell chrome. */
  beginTemplate(request: NewFileTemplateRequest): void {
    if (this.pending) return
    this.pending = {
      view: {
        kind: 'template',
        identity: request.identity,
        pluginId: request.pluginId,
        pluginName: request.pluginName,
        directory: request.directory,
        name: request.fileName,
        size: request.content.bytes.byteLength,
        ...(previewOf(request.content) === undefined
          ? {}
          : { preview: previewOf(request.content) }),
        binary: request.content.text === undefined,
        session: request.session,
      },
      request,
    }
    this.snapshot = this.pending.view
    this.log(request.identity, 'new-file', 'template', request.templateId)
    this.notify()
  }

  /** The user confirmed a directory and name. Collisions keep the dialog open. */
  async submit(directory: WorkspacePath, name: string): Promise<void> {
    const pending = this.pending
    if (!pending || this.submitting) return
    this.submitting = true
    try {
      await this.submitPending(pending, directory, name)
    } finally {
      this.submitting = false
    }
  }

  private async submitPending(
    pending: PendingNewFile,
    directory: WorkspacePath,
    name: string,
  ): Promise<void> {
    const caseSensitive = pending.view.session.capabilities().caseSensitive
    let path: WorkspacePath
    try {
      const target = normalizePath(directory)
      if (isReservedPath(target, caseSensitive)) {
        throw new Error('reserved')
      }
      const entry = validateEntryName(name.trim())
      if (isReservedName(entry, caseSensitive)) {
        throw new Error('reserved')
      }
      path = joinPath(target, entry)
    } catch {
      this.fail(pending, 'permission-denied', 'That name or folder is not allowed.')
      return
    }

    if (!pending.view.session.capabilities().writable) {
      this.fail(pending, 'internal', 'This workspace is read-only.')
      return
    }

    const request = pending.request
    try {
      const stat = await pending.view.session
        .forPlugin(pending.view.pluginId)
        .write(path, request.content.bytes, { create: true, createOnly: true })
      if (this.pending !== pending) return
      this.log(pending.view.identity, 'new-file', 'created', path)
      if (pending.view.kind === 'template') this.created?.(path, 'template')
      this.finish(pending, { ok: true, path, version: stat.version })
    } catch (error) {
      if (this.pending !== pending) return
      const workspaceCode = error instanceof WorkspaceError ? error.code : 'io'
      const code: ShellErrorCode =
        workspaceCode === 'already-exists'
          ? 'already-exists'
          : workspaceCode === 'not-found'
            ? 'not-found'
            : workspaceCode === 'not-a-file' || workspaceCode === 'not-a-directory'
              ? 'not-a-file'
              : workspaceCode === 'conflict'
                ? 'conflict'
                : workspaceCode === 'too-large'
                  ? 'too-large'
                  : workspaceCode === 'permission-denied'
                    ? 'permission-denied'
                    : workspaceCode === 'unsupported'
                      ? 'internal'
                      : 'internal'
      this.log(pending.view.identity, 'new-file', code, path)
      this.fail(pending, code, workspaceErrorMessage(workspaceCode, path))
    }
  }

  /** The user cancelled or closed the dialog. */
  cancel(): void {
    const pending = this.pending
    if (!pending) return
    this.log(pending.view.identity, 'new-file', 'cancelled')
    this.finish(
      pending,
      pending.view.kind === 'request'
        ? { ok: false, cancelled: true }
        : { ok: false, silent: true },
    )
  }

  /** A plugin frame was disposed or removed while its dialog was open. */
  closeFor(identity: string, reason: 'plugin-removed' | 'workspace-switch' | 'error'): void {
    const pending = this.pending
    if (!pending || pending.view.identity !== identity) return
    this.log(identity, 'new-file', reason)
    this.finish(pending, { ok: false, silent: true })
  }

  /** Workspace teardown: close silently so no write reaches the old session. */
  reset(): void {
    const pending = this.pending
    if (!pending) return
    this.finish(pending, { ok: false, silent: true })
  }

  private fail(pending: PendingNewFile, code: ShellErrorCode, message: string): void {
    pending.view = { ...pending.view, error: message }
    this.snapshot = pending.view
    this.log(pending.view.identity, 'new-file', code)
    this.notify()
  }

  private finish(pending: PendingNewFile, outcome: NewFileOutcome): void {
    if (this.pending !== pending) return
    this.pending = null
    this.snapshot = null
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener('abort', pending.abort)
    }
    this.notify()
    pending.resolve?.(outcome)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private log(identity: string, phase: string, code?: string, message?: string): void {
    this.onLog?.({ identity, phase, code, message })
  }
}
