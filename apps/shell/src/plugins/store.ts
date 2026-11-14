import { asWorkspaceError, type WorkspaceSession } from '../workspace/contract'
import {
  EXO_CONFIG_MAX_BYTES,
  EXO_CONFIG_PATH,
  addPluginEntry,
  emptyExoConfig,
  parseExoConfig,
  removePluginEntry,
  serializeExoConfig,
  setPluginEnabled,
  toPluginConfigEntries,
  validateExoConfig,
  type ExoConfig,
  type PluginConfigEntry,
  type PluginConfigErrorCode,
  type PluginConfigIssue,
} from './config'

export type PluginConfigStatus = 'idle' | 'loading' | 'absent' | 'valid' | 'invalid'

export interface PluginConfigSnapshot {
  status: PluginConfigStatus
  path: typeof EXO_CONFIG_PATH
  /** Stat version used as the write precondition. */
  version: string | null
  /** Exact current file text for the raw view. */
  text: string | null
  /** Empty unless the declaration is valid. */
  entries: PluginConfigEntry[]
  issues: PluginConfigIssue[]
  busy: boolean
  revision: number
}

export type PluginConfigMutationResult = { ok: true } | { ok: false; issues: PluginConfigIssue[] }

export interface PluginConfigStoreOptions {
  eventTarget?: EventTarget
  /** Injectable for tests; defaults to the document visibility check. */
  isVisible?: () => boolean
}

const encoder = new TextEncoder()

function initialSnapshot(): PluginConfigSnapshot {
  return {
    status: 'idle',
    path: EXO_CONFIG_PATH,
    version: null,
    text: null,
    entries: [],
    issues: [],
    busy: false,
    revision: 0,
  }
}

function issue(
  code: PluginConfigErrorCode,
  options: { field?: string; entryIndex?: number } = {},
): PluginConfigIssue {
  return { code, path: EXO_CONFIG_PATH, ...options }
}

function failure(code: PluginConfigErrorCode): PluginConfigMutationResult {
  return { ok: false, issues: [issue(code)] }
}

/**
 * Workspace-scoped declaration state. The store lives for the runtime lifetime
 * and attaches to one session at a time; a generation counter makes every late
 * result from a released workspace inert.
 */
export class PluginConfigStore {
  private readonly eventTarget: EventTarget | null
  private readonly isVisible: () => boolean
  private readonly listeners = new Set<() => void>()
  private snapshot: PluginConfigSnapshot = initialSnapshot()
  private session: WorkspaceSession | null = null
  private generation = 0
  private controller: AbortController | null = null
  private inFlight: Promise<void> | null = null
  private writeInFlight: Promise<PluginConfigMutationResult> | null = null
  private listening = false

  constructor(options: PluginConfigStoreOptions = {}) {
    this.eventTarget = options.eventTarget ?? (typeof window === 'undefined' ? null : window)
    this.isVisible =
      options.isVisible ??
      (() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PluginConfigSnapshot => this.snapshot

  async attach(session: WorkspaceSession): Promise<void> {
    this.detach()
    this.generation += 1
    this.session = session
    this.installListeners()
    this.setSnapshot({
      status: 'loading',
      version: null,
      text: null,
      entries: [],
      issues: [],
      busy: true,
    })
    await this.startLoad(true, true)
  }

  detach(): void {
    this.generation += 1
    this.controller?.abort()
    this.controller = null
    this.removeListeners()
    this.session = null
    this.inFlight = null
    this.writeInFlight = null
    if (this.snapshot.status !== 'idle') {
      this.setSnapshot({
        status: 'idle',
        version: null,
        text: null,
        entries: [],
        issues: [],
        busy: false,
      })
    }
  }

  refresh(force = false): Promise<void> {
    if (!this.session) return Promise.resolve()
    if (this.writeInFlight) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    return this.startLoad(force, false)
  }

  async addEntry(manifest: string): Promise<PluginConfigMutationResult> {
    const pending = this.inFlight
    if (pending) await pending
    const config = this.currentConfig()
    if (!config) return this.currentFailure()
    return this.writeConfig(addPluginEntry(config, manifest))
  }

  async setEnabled(index: number, enabled: boolean): Promise<PluginConfigMutationResult> {
    const pending = this.inFlight
    if (pending) await pending
    const config = this.currentConfig()
    if (!config) return this.currentFailure()
    try {
      return this.writeConfig(setPluginEnabled(config, index, enabled))
    } catch {
      return {
        ok: false,
        issues: [issue('invalid-config', { entryIndex: index })],
      }
    }
  }

  async removeEntry(index: number): Promise<PluginConfigMutationResult> {
    const pending = this.inFlight
    if (pending) await pending
    const config = this.currentConfig()
    if (!config) return this.currentFailure()
    try {
      return this.writeConfig(removePluginEntry(config, index))
    } catch {
      return {
        ok: false,
        issues: [issue('invalid-config', { entryIndex: index })],
      }
    }
  }

  async saveRaw(text: string): Promise<PluginConfigMutationResult> {
    const parsed = parseExoConfig(text)
    if (!parsed.ok) return { ok: false, issues: parsed.issues }
    return this.writeConfig(parsed.config)
  }

  private currentConfig(): ExoConfig | null {
    if (this.snapshot.status === 'absent') return emptyExoConfig()
    if (this.snapshot.status !== 'valid') return null
    return {
      schemaVersion: 1,
      plugins: this.snapshot.entries.map((entry) => ({
        manifest: entry.manifest,
        enabled: entry.enabled,
      })),
    }
  }

  private currentFailure(): PluginConfigMutationResult {
    if (this.snapshot.issues.length > 0) {
      return { ok: false, issues: this.snapshot.issues }
    }
    return failure('not-readable')
  }

  private startLoad(force: boolean, initial: boolean): Promise<void> {
    const session = this.session
    if (!session) return Promise.resolve()
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    const task = this.load(session, generation, controller, force, initial)
    this.inFlight = task
    void task.finally(() => {
      if (this.inFlight === task) this.inFlight = null
    })
    return task
  }

  private async load(
    session: WorkspaceSession,
    generation: number,
    controller: AbortController,
    force: boolean,
    initial: boolean,
  ): Promise<void> {
    const current = () =>
      this.generation === generation && this.session === session && !controller.signal.aborted

    if (initial) {
      this.setSnapshot({
        status: 'loading',
        version: null,
        text: null,
        entries: [],
        issues: [],
        busy: true,
      })
    }

    try {
      const stat = await session.stat(EXO_CONFIG_PATH, { signal: controller.signal })
      if (!current()) return

      if (
        !force &&
        this.snapshot.status !== 'idle' &&
        this.snapshot.status !== 'loading' &&
        this.snapshot.version === stat.version
      ) {
        if (this.snapshot.busy) this.setSnapshot({ busy: false })
        return
      }

      if (stat.kind !== 'file') {
        this.setSnapshot({
          status: 'invalid',
          version: stat.version,
          text: null,
          entries: [],
          issues: [issue('not-readable')],
          busy: false,
        })
        return
      }
      if (stat.size > EXO_CONFIG_MAX_BYTES) {
        this.setSnapshot({
          status: 'invalid',
          version: stat.version,
          text: null,
          entries: [],
          issues: [issue('too-large')],
          busy: false,
        })
        return
      }

      const bytes = await session.read(EXO_CONFIG_PATH, {
        maxBytes: EXO_CONFIG_MAX_BYTES,
        signal: controller.signal,
      })
      if (!current()) return

      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        this.setSnapshot({
          status: 'invalid',
          version: stat.version,
          text: null,
          entries: [],
          issues: [issue('invalid-json')],
          busy: false,
        })
        return
      }

      const result = parseExoConfig(text)
      if (!result.ok) {
        this.setSnapshot({
          status: 'invalid',
          version: stat.version,
          text,
          entries: [],
          issues: result.issues,
          busy: false,
        })
        return
      }

      this.setSnapshot({
        status: 'valid',
        version: stat.version,
        text,
        entries: toPluginConfigEntries(result.config),
        issues: [],
        busy: false,
      })
    } catch (error) {
      if (!current()) return
      const mapped = asWorkspaceError(error)
      if (mapped.code === 'aborted') return
      if (mapped.code === 'not-found') {
        if (
          this.snapshot.status === 'absent' &&
          this.snapshot.version === null &&
          this.snapshot.text === null &&
          this.snapshot.issues.length === 0
        ) {
          if (this.snapshot.busy) this.setSnapshot({ busy: false })
          return
        }
        this.setSnapshot({
          status: 'absent',
          version: null,
          text: null,
          entries: [],
          issues: [],
          busy: false,
        })
        return
      }
      if (mapped.code === 'too-large') {
        this.setSnapshot({
          status: 'invalid',
          version: this.snapshot.version,
          text: null,
          entries: [],
          issues: [issue('too-large')],
          busy: false,
        })
        return
      }
      this.setSnapshot({
        status: 'invalid',
        version: null,
        text: null,
        entries: [],
        issues: [issue('not-readable')],
        busy: false,
      })
    }
  }

  private writeConfig(next: ExoConfig): Promise<PluginConfigMutationResult> {
    if (this.writeInFlight) return this.writeInFlight
    const session = this.session
    if (!session) return Promise.resolve(failure('not-readable'))
    if (!session.capabilities().writable) {
      return Promise.resolve(failure('not-readable'))
    }
    if (
      this.snapshot.status === 'invalid' &&
      this.snapshot.version === null &&
      this.snapshot.text === null
    ) {
      return Promise.resolve(failure('not-readable'))
    }

    const validation = validateExoConfig(next)
    if (!validation.ok) {
      return Promise.resolve({ ok: false, issues: validation.issues })
    }

    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    const serialized = serializeExoConfig(validation.config)
    this.setSnapshot({ busy: true })

    const task = (async (): Promise<PluginConfigMutationResult> => {
      const current = () =>
        this.generation === generation && this.session === session && !controller.signal.aborted

      try {
        const pending = this.inFlight
        if (pending) await pending
        if (!current()) return { ok: false, issues: [] }
        if (
          this.snapshot.status === 'invalid' &&
          this.snapshot.version === null &&
          this.snapshot.text === null
        ) {
          this.setSnapshot({ busy: false })
          return failure('not-readable')
        }

        const version = this.snapshot.version
        const create = this.snapshot.status === 'absent' || version === null
        const stat = await session.write(EXO_CONFIG_PATH, encoder.encode(serialized), {
          ifVersion: version ?? undefined,
          create,
          signal: controller.signal,
        })
        if (!current()) return { ok: false, issues: [] }

        this.setSnapshot({
          status: 'valid',
          version: stat.version,
          text: serialized,
          entries: toPluginConfigEntries(validation.config),
          issues: [],
          busy: false,
        })
        return { ok: true }
      } catch (error) {
        if (!current()) return { ok: false, issues: [] }
        const mapped = asWorkspaceError(error)
        this.setSnapshot({ busy: false })
        if (mapped.code === 'aborted') return { ok: false, issues: [] }
        if (mapped.code === 'conflict') return failure('conflict')
        if (mapped.code === 'too-large') return failure('too-large')
        return failure('not-readable')
      } finally {
        if (this.controller === controller) this.controller = null
      }
    })()

    this.writeInFlight = task
    void task.finally(() => {
      if (this.writeInFlight === task) this.writeInFlight = null
    })
    return task
  }

  private setSnapshot(partial: Partial<PluginConfigSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      path: EXO_CONFIG_PATH,
      revision: this.snapshot.revision + 1,
    }
    for (const listener of [...this.listeners]) listener()
  }

  private installListeners(): void {
    if (this.listening || !this.eventTarget) return
    this.eventTarget.addEventListener('focus', this.handleFocus)
    this.eventTarget.addEventListener('visibilitychange', this.handleFocus)
    this.listening = true
  }

  private removeListeners(): void {
    if (!this.listening || !this.eventTarget) return
    this.eventTarget.removeEventListener('focus', this.handleFocus)
    this.eventTarget.removeEventListener('visibilitychange', this.handleFocus)
    this.listening = false
  }

  private handleFocus = (): void => {
    if (!this.isVisible()) return
    void this.refresh()
  }
}
