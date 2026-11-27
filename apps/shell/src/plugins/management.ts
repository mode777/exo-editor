import { EXO_CONFIG_PATH, normalizeManifestUrl, type PluginConfigIssue } from './config'
import type { PluginConfigMutationResult, PluginConfigStore } from './store'
import type { PluginHost } from './host'
import type { WorkspacePath } from '../workspace/contract'

export interface PluginManagementDocuments {
  dirtyPathsFor(identity: string): WorkspacePath[]
  save(path: WorkspacePath): Promise<boolean>
}

export interface PendingPluginAction {
  paths: WorkspacePath[]
  error: string | null
}

export interface PluginManagementSnapshot {
  pending: PendingPluginAction | null
  revision: number
}

export interface PluginManagementOptions {
  config: PluginConfigStore
  host: PluginHost
  documents: PluginManagementDocuments
}

interface PendingAction extends PendingPluginAction {
  run: () => Promise<PluginConfigMutationResult>
  resolve: (result: PluginConfigMutationResult) => void
}

const INITIAL_SNAPSHOT: PluginManagementSnapshot = { pending: null, revision: 0 }

function failure(): PluginConfigMutationResult {
  return { ok: false, issues: [{ code: 'invalid-config', path: EXO_CONFIG_PATH }] }
}

/**
 * One UI-independent path for install, enable/disable, remove and revoke. It
 * maps operations by normalized manifest URL, keeps the dirty-document guard in
 * one place, and delegates every write to PluginConfigStore and every consent
 * decision to PluginHost.
 */
export class PluginManagement {
  private readonly config: PluginConfigStore
  private readonly host: PluginHost
  private readonly documents: PluginManagementDocuments
  private readonly listeners = new Set<() => void>()
  private snapshot: PluginManagementSnapshot = INITIAL_SNAPSHOT
  private pending: PendingAction | null = null

  constructor(options: PluginManagementOptions) {
    this.config = options.config
    this.host = options.host
    this.documents = options.documents
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PluginManagementSnapshot => this.snapshot

  install(manifestUrl: string): Promise<PluginConfigMutationResult> {
    return this.config.addEntry(manifestUrl.trim())
  }

  setEnabled(manifestUrl: string, enabled: boolean): Promise<PluginConfigMutationResult> {
    const index = this.entryIndex(manifestUrl)
    if (index === null) return Promise.resolve(failure())
    return this.guard(this.identity(manifestUrl), () => this.config.setEnabled(index, enabled))
  }

  remove(manifestUrl: string): Promise<PluginConfigMutationResult> {
    const index = this.entryIndex(manifestUrl)
    if (index === null) return Promise.resolve(failure())
    return this.guard(this.identity(manifestUrl), () => this.config.removeEntry(index))
  }

  reviewConsent(identity: string): void {
    this.host.requestConsent(identity)
  }

  revokeConsent(identity: string): Promise<PluginConfigMutationResult> {
    return this.guard(identity, () => {
      this.host.revokeConsent(identity)
      return Promise.resolve({ ok: true })
    })
  }

  /** Save every dirty document in the pending action, then run it. */
  async savePending(): Promise<boolean> {
    if (!this.pending) return false
    for (const path of this.pending.paths) {
      if (!(await this.documents.save(path))) {
        if (this.pending) {
          this.pending.error = `Could not save ${path}. The plugin was not changed.`
          this.publish()
        }
        return false
      }
    }
    const pending = this.pending
    this.pending = null
    this.publish()
    if (!pending) return false
    await pending.run()
    return true
  }

  /** Discard the dirty documents in the pending action and run it. */
  async discardPending(): Promise<void> {
    const pending = this.pending
    this.pending = null
    this.publish()
    await pending?.run()
  }

  /** Close the prompt without changing the plugin or the documents. */
  cancelPending(): void {
    const pending = this.pending
    this.pending = null
    pending?.resolve(failure())
    this.publish()
  }

  /** Drop a pending action on workspace switch so it cannot touch the next one. */
  reset(): void {
    const pending = this.pending
    this.pending = null
    pending?.resolve(failure())
    this.publish()
  }

  private guard(
    identity: string | undefined,
    run: () => Promise<PluginConfigMutationResult>,
  ): Promise<PluginConfigMutationResult> {
    const paths = identity ? this.documents.dirtyPathsFor(identity) : []
    if (paths.length === 0) {
      return run().catch(() => failure())
    }
    return new Promise((resolve) => {
      this.pending = {
        paths: [...paths],
        error: null,
        run: async () => {
          this.pending = null
          this.publish()
          try {
            const result = await run()
            resolve(result)
            return result
          } catch {
            const result = failure()
            resolve(result)
            return result
          }
        },
        resolve,
      }
      this.publish()
    })
  }

  private entryIndex(manifestUrl: string): number | null {
    const normalized = normalizeManifestUrl(manifestUrl)
    if (normalized === null) return null
    const entry = this.config
      .getSnapshot()
      .entries.find((candidate) => normalizeManifestUrl(candidate.manifest) === normalized)
    return entry?.index ?? null
  }

  private identity(manifestUrl: string): string | undefined {
    const normalized = normalizeManifestUrl(manifestUrl)
    return this.host
      .getSnapshot()
      .records.find((record) => normalizeManifestUrl(record.manifestUrl) === normalized)?.identity
  }

  private publish(): void {
    this.snapshot = {
      pending: this.pending ? { paths: [...this.pending.paths], error: this.pending.error } : null,
      revision: this.snapshot.revision + 1,
    }
    for (const listener of [...this.listeners]) listener()
  }
}

export type { PluginConfigIssue }
