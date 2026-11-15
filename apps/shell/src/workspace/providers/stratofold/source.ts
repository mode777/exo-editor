import { WorkspaceError } from '../../contract'
import {
  clientFor,
  connectStratofold,
  StratofoldConnectError,
  type ConnectRequest,
  type ConnectSeams,
  type StratofoldConnection,
} from './connection'
import { type ConnectionStore, type StoredConnectionRecord } from './connection-store'
import { StratofoldWorkspaceProvider, stratofoldWorkspaceId } from './provider'
import type { WorkspaceHandle, WorkspaceProvider } from '../../contract'

export interface ConnectOptions {
  onCredentialRejected?: (status: 'unauthorized' | 'forbidden') => void
  signal?: AbortSignal
}

export interface ConnectedWorkspace {
  provider: WorkspaceProvider
  handle: WorkspaceHandle
  connection: StratofoldConnection
  /** False only when the connection store rejected the write. */
  stored: boolean
}

export interface StratofoldSourceOptions {
  connectionStore: ConnectionStore
  /** Test seam; defaults to the real connect flow. */
  connect?: typeof connectStratofold
  seams?: ConnectSeams
  now?: () => number
}

/**
 * Connects and restores Stratofold workspaces. The runtime owns activation and
 * the active-workspace marker; this source owns validation, the provider and the
 * recent-connection store.
 */
export class StratofoldSource {
  readonly kind = 'stratofold'
  readonly label = 'Stratofold'

  private readonly connectionStore: ConnectionStore
  private readonly connectFn: typeof connectStratofold
  private readonly seams: ConnectSeams
  private readonly now: () => number

  constructor(options: StratofoldSourceOptions) {
    this.connectionStore = options.connectionStore
    this.connectFn = options.connect ?? connectStratofold
    this.seams = options.seams ?? {}
    this.now = options.now ?? (() => Date.now())
  }

  async connect(request: ConnectRequest, options: ConnectOptions): Promise<ConnectedWorkspace> {
    if (options.signal?.aborted) {
      throw new WorkspaceError('aborted', 'The connect was cancelled.')
    }
    const { connection, client } = await this.connectFn(request, this.seams)
    let stored = true
    try {
      await this.connectionStore.put({
        id: stratofoldWorkspaceId(connection),
        connection,
        lastOpenedAt: this.now(),
      })
    } catch {
      // A storage failure must not block a validated workspace. The provider
      // reports the actual persistence state and the UI can say it is session-only.
      stored = false
    }
    const provider = new StratofoldWorkspaceProvider({
      connection,
      client,
      persistent: stored,
      onCredentialRejected: options.onCredentialRejected,
    })
    let handle: WorkspaceHandle
    try {
      handle = await provider.open({ signal: options.signal })
    } catch (error) {
      provider.dispose()
      throw error
    }
    return { provider, handle, connection, stored }
  }

  /** Revalidate the stored connection named by the active marker, then open it. */
  async restore(id: string, options: ConnectOptions): Promise<ConnectedWorkspace | null> {
    const record = await this.connectionStore.get(id)
    if (!record) return null

    if (options.signal?.aborted) {
      throw new WorkspaceError('aborted', 'The restore was cancelled.')
    }
    const { connection, client } = await this.connectFn(
      {
        server: record.connection.server,
        token: record.connection.token,
        vdir: record.connection.vdir,
      },
      this.seams,
    )
    if (stratofoldWorkspaceId(connection) !== id) {
      throw new StratofoldConnectError(
        'mismatch',
        'The stored connection resolves to a different directory.',
      )
    }
    const provider = new StratofoldWorkspaceProvider({
      connection,
      client,
      persistent: true,
      onCredentialRejected: options.onCredentialRejected,
    })
    try {
      const handle = await provider.open({ signal: options.signal })
      await this.connectionStore
        .put({ ...record, connection, lastOpenedAt: this.now() })
        .catch(() => undefined)
      return { provider, handle, connection, stored: true }
    } catch (error) {
      provider.dispose()
      throw error
    }
  }

  /** Newest-first recent workspaces, including credentials. Shell-internal only. */
  async list(): Promise<StoredConnectionRecord[]> {
    return this.connectionStore.list()
  }

  /** One stored record for the reconnect/remove paths. */
  async get(id: string): Promise<StoredConnectionRecord | null> {
    return this.connectionStore.get(id)
  }

  /** The stored record without contacting the server, for a reconnect prompt. */
  async peek(id: string): Promise<StratofoldConnection | null> {
    const record = await this.connectionStore.get(id)
    return record?.connection ?? null
  }

  async remove(id: string): Promise<void> {
    await this.connectionStore.remove(id)
  }

  /** Build a client for an already validated connection (used by tests and reconnect). */
  static client(connection: StratofoldConnection, seams: ConnectSeams = {}) {
    return clientFor(connection, seams)
  }
}
