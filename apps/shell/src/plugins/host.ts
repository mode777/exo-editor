import type { WorkspaceSession } from '../workspace/contract'
import { ConsentStore, computeFingerprint, type ConsentStorage, type Digest } from './consent'
import { DomFrameTransport, type FrameTransport } from './frame'
import { loadManifest, type ManifestErrorCode, type PluginManifest } from './manifest'
import {
  RegistrationSession,
  type RegistrationErrorCode,
  type RegistrationOutcome,
  type RegisteredCommand,
  type RegisteredContentView,
  type RegisteredEditor,
  type RegisteredNewFile,
  type RegisteredPanel,
} from './registration'
import { EditorRegistry, type EditorCandidate } from './registry'
import { CommandRegistry, type CommandEntry, type PluginCommandSource } from './commands'
import type { PluginConfigStore } from './store'
import type { PluginSettingsStore } from './settings'
import { SHELL_VERSION } from '../version'

export type PluginHostPhase =
  'disabled' | 'loading' | 'awaiting-consent' | 'denied' | 'registering' | 'active' | 'failed'

export type PluginHostFailurePhase = 'manifest' | 'consent' | 'ready' | 'register' | 'internal'

export type PluginHostErrorCode =
  ManifestErrorCode | RegistrationErrorCode | 'duplicate-identity' | 'consent-store-failed'

export interface PluginHostRecord {
  manifestUrl: string
  entryIndex: number
  enabled: boolean
  phase: PluginHostPhase
  identity?: string
  manifest?: PluginManifest
  fingerprint?: string
  consent: 'none' | 'granted' | 'denied' | 'revoked'
  registrations: RegisteredEditor[]
  panels: RegisteredPanel[]
  contentViews: RegisteredContentView[]
  commands: RegisteredCommand[]
  newFiles: RegisteredNewFile[]
  error?: {
    code: PluginHostErrorCode
    phase: PluginHostFailurePhase
    message?: string
  }
}

export interface PluginLogEntry {
  at: number
  manifestUrl?: string
  pluginId?: string
  origin?: string
  phase: string
  code?: string
  message?: string
}

export interface PendingConsent {
  identity: string
  manifestUrl: string
  manifest: PluginManifest
  fingerprint: string
}

export interface PluginHostSnapshot {
  phase: 'idle' | 'ready'
  records: PluginHostRecord[]
  consentRequest: PendingConsent | null
  log: PluginLogEntry[]
  revision: number
}

export interface PluginHostAttachOptions {
  session: WorkspaceSession
  config: PluginConfigStore
  /** Shell-owned workspace settings; declarations are registered on load. */
  settings?: PluginSettingsStore
}

export interface HandlerLifecycle {
  closeFor(
    identity: string,
    reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error',
  ): void
}

export interface ViewLifecycle {
  closeFor(
    identity: string,
    reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error',
  ): void
}

export interface NewFileLifecycle {
  closeFor(
    identity: string,
    reason: 'closed' | 'workspace-switch' | 'plugin-removed' | 'error',
  ): void
}

export interface PluginHostOptions {
  fetchImpl?: typeof fetch
  transport?: FrameTransport
  handlerLifecycle?: HandlerLifecycle
  viewLifecycle?: ViewLifecycle
  newFileLifecycle?: NewFileLifecycle
  consentStore?: ConsentStore
  consentStorage?: ConsentStorage | null
  digest?: Digest
  shellVersion?: string
  shellOrigin?: string
  theme?: () => 'dark' | 'light' | 'high-contrast'
  locale?: string
  now?: () => number
  createSessionId?: () => string
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  fetchConcurrency?: number
  registrationConcurrency?: number
}

const INITIAL_SNAPSHOT: PluginHostSnapshot = {
  phase: 'idle',
  records: [],
  consentRequest: null,
  log: [],
  revision: 0,
}

const MAX_LOG_ENTRIES = 200
const MAX_LOG_MESSAGE = 200

function identityOf(manifest: PluginManifest): string {
  return `${manifest.manifestOrigin}::${manifest.id}`
}

function defaultTheme(): 'dark' | 'light' | 'high-contrast' {
  if (typeof document === 'undefined') return 'dark'
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'high-contrast' ? theme : 'dark'
}

function errorMessage(issue: {
  status?: number
  message?: string
  field?: string
  code: string
}): string {
  if (issue.status !== undefined) return `HTTP ${issue.status}`
  if (issue.message) return issue.message.slice(0, MAX_LOG_MESSAGE)
  if (issue.field) return `Invalid field ${issue.field}`
  return issue.code
}

function cloneManifest(manifest: PluginManifest): PluginManifest {
  return {
    ...manifest,
    fileEditors: manifest.fileEditors.map((editor) => ({ ...editor })),
    panels: manifest.panels.map((panel) => ({ ...panel })),
    contentViews: manifest.contentViews.map((view) => ({ ...view })),
    commands: manifest.commands.map((command) => ({
      ...command,
      ...(command.target === 'activeEditor' ? {} : { target: { ...command.target } }),
      menus: [...command.menus],
    })),
    newFiles: manifest.newFiles.map((template) => ({
      ...template,
      bytes: new Uint8Array(template.bytes),
    })),
    configuration: manifest.configuration
      ? {
          properties: Object.fromEntries(
            Object.entries(manifest.configuration.properties).map(([key, setting]) => [
              key,
              {
                ...setting,
                ...(setting.enum ? { enum: [...setting.enum] } : {}),
              },
            ]),
          ),
        }
      : undefined,
  }
}

function cloneRecord(record: PluginHostRecord): PluginHostRecord {
  return {
    ...record,
    manifest: record.manifest ? cloneManifest(record.manifest) : undefined,
    registrations: [...record.registrations],
    panels: record.panels.map((panel) => ({ ...panel })),
    contentViews: record.contentViews.map((view) => ({ ...view })),
    commands: record.commands.map((command) => ({
      ...command,
      ...(command.target === 'activeEditor' ? {} : { target: { ...command.target } }),
      menus: [...command.menus],
    })),
    newFiles: record.newFiles.map((template) => ({
      ...template,
      bytes: new Uint8Array(template.bytes),
    })),
    error: record.error ? { ...record.error } : undefined,
  }
}

/**
 * One workspace's plugin host. It consumes the validated configuration
 * snapshot, drives manifest loading, consent, registration frames and the
 * editor registry, and publishes a React-friendly snapshot of status and log.
 */
export class PluginHost {
  private readonly fetchImpl: typeof fetch | undefined
  private readonly transport: FrameTransport
  private readonly ownsTransport: boolean
  private readonly consentStore: ConsentStore
  private readonly digest: Digest | undefined
  private readonly shellVersion: string
  private readonly shellOrigin: string
  private readonly theme: () => 'dark' | 'light' | 'high-contrast'
  private readonly locale: string
  private readonly now: () => number
  private readonly createSessionId: (() => string) | undefined
  private handlerLifecycleValue: HandlerLifecycle | undefined
  private viewLifecycleValue: ViewLifecycle | undefined
  private newFileLifecycleValue: NewFileLifecycle | undefined
  private readonly setTimeoutImpl: typeof setTimeout | undefined
  private readonly clearTimeoutImpl: typeof clearTimeout | undefined
  private readonly fetchLimit: number
  private readonly registrationLimit: number

  private readonly listeners = new Set<() => void>()
  private readonly records = new Map<string, PluginHostRecord>()
  private readonly registry = new EditorRegistry()
  private readonly commands = new CommandRegistry()
  private readonly denied = new Set<string>()
  private readonly sessions = new Map<string, RegistrationSession>()
  private readonly mounted = new Set<string>()
  private readonly controllers = new Map<PluginHostRecord, AbortController>()
  private readonly manifestLoading = new Set<PluginHostRecord>()
  private logEntries: PluginLogEntry[] = []
  private consentRequest: PendingConsent | null = null
  private snapshot: PluginHostSnapshot = INITIAL_SNAPSHOT
  private session: WorkspaceSession | null = null
  private config: PluginConfigStore | null = null
  private settings: PluginSettingsStore | null = null
  private unsubscribe: (() => void) | null = null
  private generation = 0
  private work: Promise<void> = Promise.resolve()
  private fetchQueue: PluginHostRecord[] = []
  private fetchActive = 0
  private registrationQueue: PluginHostRecord[] = []
  private registrationActive = 0

  constructor(options: PluginHostOptions = {}) {
    this.fetchImpl = options.fetchImpl
    this.transport = options.transport ?? new DomFrameTransport()
    this.ownsTransport = options.transport === undefined
    this.consentStore =
      options.consentStore ??
      new ConsentStore(
        options.consentStorage === undefined ? {} : { storage: options.consentStorage },
      )
    this.digest = options.digest
    this.shellVersion = options.shellVersion ?? SHELL_VERSION
    this.shellOrigin =
      options.shellOrigin ??
      (typeof location === 'undefined' ? 'http://localhost' : location.origin)
    this.theme = options.theme ?? defaultTheme
    this.locale =
      options.locale ?? (typeof navigator === 'undefined' ? 'en' : navigator.language || 'en')
    this.now = options.now ?? (() => Date.now())
    this.createSessionId = options.createSessionId
    this.handlerLifecycleValue = options.handlerLifecycle
    this.viewLifecycleValue = options.viewLifecycle
    this.newFileLifecycleValue = options.newFileLifecycle
    this.setTimeoutImpl = options.setTimeoutImpl
    this.clearTimeoutImpl = options.clearTimeoutImpl
    this.fetchLimit = options.fetchConcurrency ?? 4
    this.registrationLimit = options.registrationConcurrency ?? 4
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PluginHostSnapshot => this.snapshot

  attach(options: PluginHostAttachOptions): void {
    this.detach()
    this.generation += 1
    this.session = options.session
    this.config = options.config
    this.settings = options.settings ?? null
    this.unsubscribe = options.config.subscribe(this.handleConfig)
    this.publish({ phase: 'ready' })
    this.enqueue(() => this.reconcile())
  }

  detach(): void {
    this.generation += 1
    this.unsubscribe?.()
    this.unsubscribe = null
    this.stopAll()
    this.session = null
    this.config = null
    this.settings = null
    this.records.clear()
    this.logEntries = []
    this.consentRequest = null
    this.publish({ phase: 'idle', records: [], consentRequest: null, log: [] })
  }

  dispose(): void {
    this.detach()
    if (this.ownsTransport) this.transport.dispose?.()
    this.listeners.clear()
  }

  match(path: string): EditorCandidate[] {
    return this.registry.match(path)
  }

  /** Every active plugin command, ordered by declaration and registration order. */
  listCommands(): CommandEntry[] {
    return this.commands.list()
  }

  findCommand(identity: string, commandId: string): CommandEntry | undefined {
    return this.commands.find(identity, commandId)
  }

  requestConsent(identity: string): void {
    const record = this.findByIdentity(identity)
    if (!record?.manifest || !record.fingerprint) return
    if (record.phase !== 'awaiting-consent' && record.phase !== 'denied') {
      return
    }
    this.consentRequest = {
      identity,
      manifestUrl: record.manifestUrl,
      manifest: record.manifest,
      fingerprint: record.fingerprint,
    }
    this.publish()
  }

  approveConsent(identity: string): void {
    const request = this.consentRequest
    if (!request || request.identity !== identity) return
    const record = this.records.get(request.manifestUrl)
    if (!record?.manifest || !record.fingerprint) return

    const stored = this.consentStore.grant({
      manifestOrigin: record.manifest.manifestOrigin,
      pluginId: record.manifest.id,
      manifestUrl: record.manifest.manifestUrl,
      version: record.manifest.version,
      fingerprint: record.fingerprint,
      grantedAt: new Date(this.now()).toISOString(),
    })
    if (!stored) {
      this.log('consent', record, 'consent-store-failed', 'Consent applies for this session only.')
    }
    this.denied.delete(identity)
    record.consent = 'granted'
    this.consentRequest = null
    this.log('consent', record, 'approved')
    this.publish()
    this.beginRegistration(record)
    this.showNextConsent()
  }

  denyConsent(identity: string): void {
    const request = this.consentRequest
    if (!request || request.identity !== identity) return
    const record = this.records.get(request.manifestUrl)
    if (!record) return
    this.denied.add(identity)
    record.phase = 'denied'
    record.consent = 'denied'
    record.registrations = []
    record.panels = []
    record.contentViews = []
    record.commands = []
    record.newFiles = []
    record.error = undefined
    this.consentRequest = null
    this.log('consent', record, 'denied')
    this.publish()
    this.showNextConsent()
  }

  revokeConsent(identity: string): void {
    const record = this.findByIdentity(identity)
    if (!record?.manifest) return
    this.consentStore.revoke(record.manifest.manifestOrigin, record.manifest.id)
    this.log('consent', record, 'revoked')
    this.stopRegistration(record)
    record.phase = 'awaiting-consent'
    record.consent = 'revoked'
    record.registrations = []
    record.panels = []
    record.contentViews = []
    record.commands = []
    record.newFiles = []
    record.error = undefined
    this.denied.delete(identity)
    if (this.consentRequest?.identity === identity) this.consentRequest = null
    this.publish()
  }

  private handleConfig = (): void => {
    this.enqueue(() => this.reconcile())
  }

  private enqueue(task: () => void | Promise<void>): void {
    const generation = this.generation
    this.work = this.work
      .then(async () => {
        if (generation !== this.generation) return
        await task()
      })
      .catch(() => {
        // A task failure must not poison the queue; individual operations log
        // their own failures where they can be explained to the user.
      })
  }

  private findByIdentity(identity: string): PluginHostRecord | undefined {
    for (const record of this.records.values()) {
      if (record.identity === identity) return record
    }
    return undefined
  }

  private commandSource(
    record: PluginHostRecord,
    identity = record.identity ?? '',
  ): PluginCommandSource {
    return {
      identity,
      pluginId: record.manifest?.id ?? identity,
      pluginName: record.manifest?.name ?? record.manifestUrl,
      pluginVersion: record.manifest?.version ?? '0.0.0',
      origin: record.manifest?.manifestOrigin ?? '',
      pluginOrder: record.entryIndex,
    }
  }

  private reconcile(): void {
    if (!this.session || !this.config) return
    const config = this.config.getSnapshot()
    if (config.status !== 'valid') {
      this.stopAll()
      this.records.clear()
      this.registry.clear()
      this.commands.clear()
      this.consentRequest = null
      this.publish()
      return
    }

    const desired = new Map(config.entries.map((entry) => [entry.manifest, entry]))
    for (const [manifestUrl, record] of [...this.records]) {
      if (!desired.has(manifestUrl)) {
        this.stopRecord(record)
        this.records.delete(manifestUrl)
      }
    }

    for (const entry of config.entries) {
      let record = this.records.get(entry.manifest)
      if (!entry.enabled) {
        if (!record) {
          this.records.set(entry.manifest, {
            manifestUrl: entry.manifest,
            entryIndex: entry.index,
            enabled: false,
            phase: 'disabled',
            consent: 'none',
            registrations: [],
            panels: [],
            contentViews: [],
            commands: [],
            newFiles: [],
          })
          continue
        }
        if (record.enabled || record.phase !== 'disabled') this.stopRecord(record)
        record.entryIndex = entry.index
        record.enabled = false
        record.phase = 'disabled'
        record.identity = undefined
        record.manifest = undefined
        record.fingerprint = undefined
        record.consent = 'none'
        record.registrations = []
        record.panels = []
        record.contentViews = []
        record.commands = []
        record.newFiles = []
        record.error = undefined
        continue
      }

      if (!record) {
        record = {
          manifestUrl: entry.manifest,
          entryIndex: entry.index,
          enabled: true,
          phase: 'loading',
          consent: 'none',
          registrations: [],
          panels: [],
          contentViews: [],
          commands: [],
          newFiles: [],
        }
        this.records.set(entry.manifest, record)
        this.enqueueManifest(record)
        continue
      }

      record.entryIndex = entry.index
      if (!record.enabled) {
        record.enabled = true
        record.phase = 'loading'
        record.identity = undefined
        record.manifest = undefined
        record.fingerprint = undefined
        record.consent = 'none'
        record.registrations = []
        record.panels = []
        record.contentViews = []
        record.commands = []
        record.newFiles = []
        record.error = undefined
        this.enqueueManifest(record)
      } else if (record.identity && record.phase === 'active') {
        this.registry.add(
          {
            identity: record.identity,
            pluginOrder: record.entryIndex,
            pluginName: record.manifest?.name ?? record.manifestUrl,
            pluginId: record.manifest?.id ?? record.identity,
            pluginVersion: record.manifest?.version ?? '0.0.0',
            origin: record.manifest?.manifestOrigin ?? '',
            permissions: record.manifest?.permissions ?? [],
          },
          record.registrations,
        )
        this.commands.add(this.commandSource(record), record.commands)
      }
    }

    this.reconsiderDuplicates()
    this.publish()
    this.pumpFetches()
    this.showNextConsent()
    this.scheduleFinalize()
  }

  private reconsiderDuplicates(): void {
    for (const record of this.records.values()) {
      if (record.error?.code !== 'duplicate-identity') continue
      const identity = record.identity
      if (!identity) continue
      const earlier = [...this.records.values()].some(
        (other) =>
          other !== record &&
          other.identity === identity &&
          other.entryIndex < record.entryIndex &&
          other.phase !== 'failed',
      )
      if (earlier) continue
      record.phase = 'loading'
      record.identity = undefined
      record.fingerprint = undefined
      record.error = undefined
      if (record.manifest) {
        this.scheduleFinalize()
      } else {
        this.enqueueManifest(record)
      }
    }
  }

  private enqueueManifest(record: PluginHostRecord): void {
    if (this.manifestLoading.has(record) || this.controllers.has(record)) return
    this.fetchQueue.push(record)
    this.pumpFetches()
  }

  private pumpFetches(): void {
    while (this.fetchActive < this.fetchLimit && this.fetchQueue.length > 0) {
      const record = this.fetchQueue.shift()
      if (!record || this.records.get(record.manifestUrl) !== record) continue
      if (this.manifestLoading.has(record)) continue
      this.manifestLoading.add(record)
      this.fetchActive += 1
      void this.loadRecord(record).finally(() => {
        this.manifestLoading.delete(record)
        this.fetchActive = Math.max(0, this.fetchActive - 1)
        this.pumpFetches()
        this.scheduleFinalize()
      })
    }
  }

  private async loadRecord(record: PluginHostRecord): Promise<void> {
    const generation = this.generation
    const controller = new AbortController()
    this.controllers.set(record, controller)
    record.phase = 'loading'
    record.error = undefined
    this.log('manifest', record, 'fetch')
    this.publish()

    let result
    try {
      result = await loadManifest(record.manifestUrl, {
        shellOrigin: this.shellOrigin,
        shellVersion: this.shellVersion,
        fetchImpl: this.fetchImpl,
        signal: controller.signal,
        setTimeoutImpl: this.setTimeoutImpl,
        clearTimeoutImpl: this.clearTimeoutImpl,
      })
    } catch {
      if (controller.signal.aborted || generation !== this.generation) return
      result = {
        ok: false as const,
        error: { code: 'internal' as const, message: 'The manifest request failed.' },
      }
    }

    if (
      generation !== this.generation ||
      this.records.get(record.manifestUrl) !== record ||
      controller.signal.aborted
    ) {
      return
    }
    this.controllers.delete(record)

    if (!result.ok) {
      record.phase = 'failed'
      record.error = {
        code: result.error.code,
        phase: 'manifest',
        message: errorMessage(result.error),
      }
      this.log('manifest', record, result.error.code, errorMessage(result.error))
      this.publish()
      return
    }

    record.manifest = result.manifest
    record.error = undefined
    this.log('manifest', record, 'validated')
    this.publish()
  }

  private scheduleFinalize(): void {
    this.enqueue(() => this.finalize())
  }

  private async finalize(): Promise<void> {
    if (!this.session) return
    if (this.fetchQueue.length > 0 || this.manifestLoading.size > 0) return

    const candidates = [...this.records.values()]
      .filter((record) => record.enabled && record.manifest && record.phase === 'loading')
      .sort((left, right) => left.entryIndex - right.entryIndex)
    if (candidates.length === 0) {
      this.showNextConsent()
      return
    }

    const claimed = new Map<string, PluginHostRecord>()
    for (const record of this.records.values()) {
      if (
        record.manifest &&
        record.identity &&
        record.phase !== 'loading' &&
        record.phase !== 'failed'
      ) {
        claimed.set(record.identity, record)
      }
    }

    const granted: PluginHostRecord[] = []
    for (const record of candidates) {
      const manifest = record.manifest
      if (!manifest) continue
      const identity = identityOf(manifest)
      record.identity = identity
      if (claimed.has(identity)) {
        record.phase = 'failed'
        record.error = { code: 'duplicate-identity', phase: 'manifest' }
        this.log('manifest', record, 'duplicate-identity')
        continue
      }
      claimed.set(identity, record)
      this.settings?.declare(identity, manifest.configuration)

      let fingerprint: string
      try {
        fingerprint = await computeFingerprint(manifest, this.digest)
      } catch {
        record.phase = 'failed'
        record.error = {
          code: 'internal',
          phase: 'consent',
          message: 'The consent fingerprint could not be computed.',
        }
        this.log('consent', record, 'internal')
        continue
      }
      record.fingerprint = fingerprint

      const stored = this.consentStore.get(manifest.manifestOrigin, manifest.id)
      if (stored && stored.fingerprint === fingerprint) {
        record.consent = 'granted'
        granted.push(record)
        this.log('consent', record, 'granted')
      } else if (this.denied.has(identity)) {
        record.phase = 'denied'
        record.consent = 'denied'
        this.log('consent', record, 'denied')
      } else {
        record.phase = 'awaiting-consent'
        record.consent = 'none'
        this.log('consent', record, 'awaiting')
      }
    }

    this.publish()
    for (const record of granted) this.beginRegistration(record)
    this.showNextConsent()
  }

  private beginRegistration(record: PluginHostRecord): void {
    if (!record.identity || !record.manifest) return
    if (record.phase === 'registering' || record.phase === 'active') return
    record.phase = 'registering'
    record.consent = 'granted'
    record.error = undefined
    this.registrationQueue.push(record)
    this.log('register', record, 'queued')
    this.publish()
    this.pumpRegistrations()
  }

  private pumpRegistrations(): void {
    while (this.registrationActive < this.registrationLimit && this.registrationQueue.length > 0) {
      const record = this.registrationQueue.shift()
      if (
        !record ||
        this.records.get(record.manifestUrl) !== record ||
        !record.manifest ||
        !record.identity ||
        record.phase !== 'registering'
      ) {
        continue
      }
      const identity = record.identity
      const generation = this.generation
      const session = new RegistrationSession({
        manifest: record.manifest,
        transport: this.transport,
        shellVersion: this.shellVersion,
        shellOrigin: this.shellOrigin,
        workspaceName: this.session?.descriptor.name ?? '',
        theme: this.theme(),
        locale: this.locale,
        settings: this.settings?.values(identity) ?? {},
        createSessionId: this.createSessionId,
        setTimeoutImpl: this.setTimeoutImpl,
        clearTimeoutImpl: this.clearTimeoutImpl,
        onOutcome: (outcome) => this.handleOutcome(record, identity, generation, outcome),
      })
      this.sessions.set(identity, session)
      this.mounted.add(identity)
      this.registrationActive += 1
      session.start()
    }
  }

  private handleOutcome(
    record: PluginHostRecord,
    identity: string,
    generation: number,
    outcome: RegistrationOutcome,
  ): void {
    if (generation !== this.generation || this.records.get(record.manifestUrl) !== record) return
    if (this.mounted.delete(identity)) {
      this.registrationActive = Math.max(0, this.registrationActive - 1)
    }

    if (outcome.kind === 'active') {
      record.phase = 'active'
      record.registrations = outcome.editors
      record.panels = outcome.panels
      record.contentViews = outcome.contentViews
      record.commands = outcome.commands
      record.newFiles = outcome.newFiles
      record.error = undefined
      record.consent = 'granted'
      this.registry.add(
        {
          identity,
          pluginOrder: record.entryIndex,
          pluginName: record.manifest?.name ?? record.manifestUrl,
          pluginId: record.manifest?.id ?? identity,
          pluginVersion: record.manifest?.version ?? '0.0.0',
          origin: record.manifest?.manifestOrigin ?? '',
          permissions: record.manifest?.permissions ?? [],
        },
        outcome.editors,
      )
      this.commands.add(this.commandSource(record, identity), outcome.commands)
      this.log(
        'register',
        record,
        'active',
        `${outcome.editors.length} editor(s), ${outcome.panels.length} panel(s), ${outcome.contentViews.length} content view(s), ${outcome.commands.length} command(s), ${outcome.newFiles.length} new-file template(s)`,
      )
    } else {
      record.phase = 'failed'
      record.registrations = []
      record.panels = []
      record.contentViews = []
      record.commands = []
      record.newFiles = []
      record.error = {
        code: outcome.code,
        phase: outcome.phase,
        message: outcome.message,
      }
      this.registry.remove(identity)
      this.commands.remove(identity)
      this.sessions.delete(identity)
      this.log('register', record, outcome.code, outcome.message)
    }
    this.publish()
    this.pumpRegistrations()
  }

  private showNextConsent(): void {
    if (this.consentRequest) return
    const next = [...this.records.values()]
      .filter(
        (record) =>
          record.phase === 'awaiting-consent' &&
          record.identity &&
          record.manifest &&
          record.fingerprint &&
          !this.denied.has(record.identity),
      )
      .sort((left, right) => left.entryIndex - right.entryIndex)[0]
    if (!next?.manifest || !next.identity || !next.fingerprint) return
    this.consentRequest = {
      identity: next.identity,
      manifestUrl: next.manifestUrl,
      manifest: next.manifest,
      fingerprint: next.fingerprint,
    }
    this.publish()
  }

  private stopRegistration(record: PluginHostRecord): void {
    const identity = record.identity
    if (!identity) return
    const session = this.sessions.get(identity)
    if (session) {
      session.close()
      this.sessions.delete(identity)
    }
    if (this.mounted.delete(identity)) {
      this.registrationActive = Math.max(0, this.registrationActive - 1)
    }
    this.handlerLifecycleValue?.closeFor(identity, 'plugin-removed')
    this.viewLifecycleValue?.closeFor(identity, 'plugin-removed')
    this.newFileLifecycleValue?.closeFor(identity, 'plugin-removed')
    this.registry.remove(identity)
    this.commands.remove(identity)
    this.registrationQueue = this.registrationQueue.filter((entry) => entry !== record)
  }

  private stopRecord(record: PluginHostRecord): void {
    this.stopRegistration(record)
    if (record.identity) this.settings?.declare(record.identity, undefined)
    const controller = this.controllers.get(record)
    if (controller) {
      controller.abort()
      this.controllers.delete(record)
    }
    this.manifestLoading.delete(record)
    this.fetchQueue = this.fetchQueue.filter((entry) => entry !== record)
    if (this.consentRequest?.manifestUrl === record.manifestUrl) {
      this.consentRequest = null
    }
    this.log('host', record, 'stopped')
  }

  private stopAll(): void {
    for (const record of this.records.values()) this.stopRecord(record)
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
    for (const session of this.sessions.values()) session.close()
    this.sessions.clear()
    this.mounted.clear()
    this.records.clear()
    this.registry.clear()
    this.commands.clear()
    this.fetchQueue = []
    this.registrationQueue = []
    this.manifestLoading.clear()
    this.fetchActive = 0
    this.registrationActive = 0
    this.consentRequest = null
  }

  setHandlerLifecycle(lifecycle: HandlerLifecycle | undefined): void {
    this.handlerLifecycleValue = lifecycle
  }

  setViewLifecycle(lifecycle: ViewLifecycle | undefined): void {
    this.viewLifecycleValue = lifecycle
  }

  setNewFileLifecycle(lifecycle: NewFileLifecycle | undefined): void {
    this.newFileLifecycleValue = lifecycle
  }

  logView(identity: string, phase: string, code?: string, message?: string): void {
    this.logHandler(identity, phase, code, message)
  }

  logCommand(identity: string, phase: string, code?: string, message?: string): void {
    this.logHandler(identity, phase, code, message)
  }

  logHandler(identity: string, phase: string, code?: string, message?: string): void {
    this.log(phase, this.findByIdentity(identity), code, message)
    this.publish()
  }

  private log(phase: string, record?: PluginHostRecord, code?: string, message?: string): void {
    this.logEntries.push({
      at: this.now(),
      manifestUrl: record?.manifestUrl,
      pluginId: record?.manifest?.id,
      origin: record?.manifest?.manifestOrigin,
      phase,
      code,
      message: message?.slice(0, MAX_LOG_MESSAGE),
    })
    if (this.logEntries.length > MAX_LOG_ENTRIES) this.logEntries.shift()
  }

  private publish(partial: Partial<PluginHostSnapshot> = {}): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      records: [...this.records.values()]
        .sort((left, right) => left.entryIndex - right.entryIndex)
        .map(cloneRecord),
      consentRequest: this.consentRequest,
      log: [...this.logEntries],
      revision: this.snapshot.revision + 1,
    }
    for (const listener of [...this.listeners]) listener()
  }
}
