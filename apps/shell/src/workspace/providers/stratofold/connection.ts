/**
 * Turns a user-supplied server URL plus credential (or public directory id)
 * into a validated connection. Nothing is mounted until this resolves.
 *
 * Discovery uses a throwaway client because `@stratofold/client` validates that
 * `vdir` is a non-empty string before `tokenInfo()` can be called, while the
 * token alone already determines the directory. The probe performs exactly one
 * request (`/api/sf/tokens/me`) and is never used for file operations; the real
 * client is rebuilt from the discovered directory id.
 */
import {
  ConfigurationError,
  StratofoldClient,
  StratofoldError,
  type FetchLike,
} from '@stratofold/client'

/** A sentinel that satisfies the client's constructor without naming a directory. */
export const DISCOVERY_VDIR = '-'

export type StratofoldRole = 'editor' | 'viewer' | 'public'

export type ConnectErrorCode =
  'invalid-server' | 'unauthorized' | 'not-found' | 'mismatch' | 'network'

export class StratofoldConnectError extends Error {
  readonly code: ConnectErrorCode

  constructor(code: ConnectErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'StratofoldConnectError'
    this.code = code
  }
}

/** The non-secret description of a connected workspace. */
export interface StratofoldConnection {
  /** Normalized server address, no trailing slash. Never includes the token. */
  server: string
  vdir: string
  name: string
  role: StratofoldRole
  /** Shell-owned credential. Absent for a public directory. */
  token?: string
}

export interface ConnectRequest {
  server: string
  /** Bearer token. Omit for a public directory. */
  token?: string
  /** Required for public mode; optional for a token, where it is verified. */
  vdir?: string
}

export interface ConnectSeams {
  fetch?: FetchLike
  createXhr?: () => XMLHttpRequest
}

export interface ConnectedWorkspace {
  connection: StratofoldConnection
  client: StratofoldClient
}

export function clientFor(
  connection: StratofoldConnection,
  seams: ConnectSeams = {},
): StratofoldClient {
  return new StratofoldClient({
    baseUrl: connection.server,
    vdir: connection.vdir,
    token: connection.token,
    fetch: seams.fetch,
    createXhr: seams.createXhr,
  })
}

export async function connectStratofold(
  request: ConnectRequest,
  seams: ConnectSeams = {},
): Promise<ConnectedWorkspace> {
  const server = normalizeServer(request.server)
  const token = request.token?.trim() ?? ''
  if (token.length === 0) {
    return connectPublic(server, request.vdir, seams)
  }
  return connectWithToken(server, token, request.vdir, seams)
}

async function connectWithToken(
  server: string,
  token: string,
  expectedVdir: string | undefined,
  seams: ConnectSeams,
): Promise<ConnectedWorkspace> {
  const probe = new StratofoldClient({
    baseUrl: server,
    vdir: DISCOVERY_VDIR,
    token,
    fetch: seams.fetch,
    createXhr: seams.createXhr,
  })

  let info: Awaited<ReturnType<StratofoldClient['tokenInfo']>>
  try {
    info = await probe.tokenInfo()
  } catch (error) {
    throw connectError(error, 'token')
  }

  const vdir = info.vdir?.id
  if (!vdir) {
    throw new StratofoldConnectError(
      'invalid-server',
      'The server answered with no directory for this token.',
    )
  }
  if (expectedVdir !== undefined && expectedVdir !== '' && expectedVdir !== vdir) {
    throw new StratofoldConnectError(
      'mismatch',
      'The token belongs to a different directory than the one requested.',
    )
  }
  if (info.role !== 'editor' && info.role !== 'viewer') {
    throw new StratofoldConnectError('invalid-server', 'The server reported an unknown role.')
  }

  const connection: StratofoldConnection = {
    server,
    vdir,
    name: info.vdir.name || vdir,
    role: info.role,
    token,
  }
  return { connection, client: clientFor(connection, seams) }
}

async function connectPublic(
  server: string,
  vdir: string | undefined,
  seams: ConnectSeams,
): Promise<ConnectedWorkspace> {
  if (!vdir || vdir.trim() === '') {
    throw new StratofoldConnectError(
      'invalid-server',
      'A directory identifier is required to open a public directory.',
    )
  }
  const connection: StratofoldConnection = {
    server,
    vdir: vdir.trim(),
    name: vdir.trim(),
    role: 'public',
  }
  const client = clientFor(connection, seams)
  try {
    await client.list('')
  } catch (error) {
    throw connectError(error, 'directory')
  }
  return { connection, client }
}

function normalizeServer(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '') {
    throw new StratofoldConnectError('invalid-server', 'A server address is required.')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new StratofoldConnectError(
      'invalid-server',
      'The server address must be an absolute HTTP or HTTPS URL.',
    )
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new StratofoldConnectError('invalid-server', 'The server address must use HTTP or HTTPS.')
  }
  return trimmed.replace(/\/+$/, '')
}

function connectError(error: unknown, mode: 'token' | 'directory'): StratofoldConnectError {
  if (error instanceof StratofoldConnectError) return error
  if (error instanceof StratofoldError) {
    if (error.status === 0) {
      return new StratofoldConnectError(
        'network',
        'The server could not be reached. Check the address, network and CORS settings.',
        error,
      )
    }
    if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
      return new StratofoldConnectError(
        'unauthorized',
        mode === 'token'
          ? 'The server rejected this token. Check that it is current and not revoked.'
          : 'This directory is not public.',
        error,
      )
    }
    if (error.kind === 'notfound') {
      return new StratofoldConnectError(
        'not-found',
        mode === 'token'
          ? 'The server has no token endpoint at that address.'
          : 'The server has no public directory with that identifier.',
        error,
      )
    }
    return new StratofoldConnectError(
      'invalid-server',
      'The server rejected the request. Check the address and try again.',
      error,
    )
  }
  if (error instanceof ConfigurationError) {
    return new StratofoldConnectError('invalid-server', 'The server address is not usable.', error)
  }
  return new StratofoldConnectError(
    'network',
    'The server could not be reached. Check the address, network and CORS settings.',
    error,
  )
}
