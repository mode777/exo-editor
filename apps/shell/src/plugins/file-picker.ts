import type { WorkspacePath, WorkspaceSession } from '../workspace/contract'
import type { ShellErrorCode } from './protocol'

export interface FilePickerOpenRequest {
  /** The handler document; the shell starts in its directory by default. */
  path: WorkspacePath
  pluginId: string
  pluginName: string
  multiple: boolean
  /** Optional plugin hint. It is not a grant and falls back silently. */
  directory?: WorkspacePath
  session: WorkspaceSession
  signal: AbortSignal
}

export type FilePickerOutcome =
  | { ok: true; paths: WorkspacePath[] }
  | { ok: false; code: ShellErrorCode }
  | { ok: false; silent: true }

export type FilePickerView = Omit<FilePickerOpenRequest, 'signal'>

interface PendingPicker {
  request: FilePickerOpenRequest
  resolve: (outcome: FilePickerOutcome) => void
  abort: () => void
}

/**
 * One workspace's shell-owned file picker. The controller owns the single
 * pending request; it never queues a second modal. A request is resolved by the
 * dialog's select/cancel action, by the handler's AbortSignal on disposal, or by
 * reset() when the workspace is released.
 */
export class FilePickerController {
  private pending: PendingPicker | null = null
  private snapshot: FilePickerView | null = null
  private readonly listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): FilePickerView | null => this.snapshot

  request(request: FilePickerOpenRequest): Promise<FilePickerOutcome> {
    if (this.pending) return Promise.resolve({ ok: false, code: 'rate-limited' })
    if (request.signal.aborted) return Promise.resolve({ ok: false, silent: true })
    return new Promise<FilePickerOutcome>((resolve) => {
      const abort = () => {
        const pending = this.pending
        if (!pending || pending.request !== request) return
        this.finish(pending, { ok: false, silent: true })
      }
      request.signal.addEventListener('abort', abort, { once: true })
      this.pending = { request, resolve, abort }
      this.snapshot = {
        path: request.path,
        pluginId: request.pluginId,
        pluginName: request.pluginName,
        multiple: request.multiple,
        ...(request.directory === undefined ? {} : { directory: request.directory }),
        session: request.session,
      }
      this.notify()
    })
  }

  /** The user clicked Select. The handler re-checks paths before replying. */
  select(paths: WorkspacePath[]): void {
    const pending = this.pending
    if (!pending) return
    this.finish(pending, { ok: true, paths })
  }

  /** The user cancelled or closed the dialog: a successful empty selection. */
  cancel(): void {
    const pending = this.pending
    if (!pending) return
    this.finish(pending, { ok: true, paths: [] })
  }

  /** Workspace teardown: close silently so no reply crosses a released session. */
  reset(): void {
    const pending = this.pending
    if (!pending) return
    this.finish(pending, { ok: false, silent: true })
  }

  private finish(pending: PendingPicker, outcome: FilePickerOutcome): void {
    if (this.pending !== pending) return
    this.pending = null
    this.snapshot = null
    pending.request.signal.removeEventListener('abort', pending.abort)
    this.notify()
    pending.resolve(outcome)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
