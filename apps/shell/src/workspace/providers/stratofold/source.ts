import { WorkspaceError } from '../../contract'
import {
  clientFor,
  connectStratofold,
  StratofoldConnectError,
  type ConnectRequest,
  type ConnectSeams,
  type StratofoldConnection,
} from './connection'
import { type ConnectionStore } from './connection-store'
import { StratofoldWorkspaceProvider, stratofoldWorkspaceId } from './provider'
import type { WorkspaceHandle, WorkspaceProvider } from '../../contract'

export interface ConnectOptions {
  /** Persist the connection only when the user asked to remember it. */
  remember: boolean
  onCredentialRejected?: (status: 'unauthorized' | 'forbidden') => void
  signal?: AbortSignal
}

export interface ConnectedWorkspace {
  provider: WorkspaceProvider
  handle: WorkspaceHandle
  connection: StratofoldConnection
  remembered: boolean
}

export interface StratofoldSourceOptions {
  connectionStore: ConnectionStore
  /** Test seam; defaults to the real connect flow. */
  connect?: typeof connectStratofold
  seams?: ConnectSeams
}

/**
 * Connects and restores Stratofold workspaces. The runtime owns activation and
 * the active-workspace marker; this source owns validation, the provider and the
 * remembered connection.
 */
export class StratofoldSource {
  readonly kind = 'stratofold'
  readonly label = 'Stratofold'

  private readonly connectionStore: ConnectionStore
  private readonly connectFn: typeof connectStratofold
  private readonly seams: ConnectSeams

  constructor(options: StratofoldSourceOptions) {
    this.connectionStore = options.connectionStore
    this.connectFn = options.connect ?? connectStratofold
    this.seams = options.seams ?? {}
  }

  async connect(request: ConnectRequest, options: ConnectOptions): Promise<ConnectedWorkspace> {
    if (options.signal?.aborted) {
      throw new WorkspaceError('aborted', 'The connect was cancelled.')
    }
    const { connection, client } = await this.connectFn(request, this.seams)
    const provider = new StratofoldWorkspaceProvider({
      connection,
      client,
      persistent: options.remember,
      onCredentialRejected: options.onCredentialRejected,
    })
    let handle: WorkspaceHandle
    try {
      handle = await provider.open({ signal: options.signal })
    } catch (error) {
      provider.dispose()
      throw error
    }

    if (options.remember) {
      await this.connectionStore.put({
        connection,
        id: stratofoldWorkspaceId(connection),
      })
    } else {
      // A session-only connection must not leave an older remembered workspace
      // that a reload would silently restore instead.
      await this.connectionStore.clear()
    }
    return { provider, handle, connection, remembered: options.remember }
  }

  /** Revalidate the remembered connection, then open it. */
  async restore(id: string, options: ConnectOptions): Promise<ConnectedWorkspace | null> {
    const record = await this.connectionStore.get()
    if (!record || record.id !== id) return null

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
        'The remembered connection resolves to a different directory.',
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
      return { provider, handle, connection, remembered: true }
    } catch (error) {
      provider.dispose()
      throw error
    }
  }

  /** The stored record without contacting the server, for a reconnect prompt. */
  async peek(): Promise<StratofoldConnection | null> {
    const record = await this.connectionStore.get()
    return record?.connection ?? null
  }

  async forget(): Promise<void> {
    await this.connectionStore.clear()
  }

  /** Build a client for an already validated connection (used by tests and reconnect). */
  static client(connection: StratofoldConnection, seams: ConnectSeams = {}) {
    return clientFor(connection, seams)
  }
}
