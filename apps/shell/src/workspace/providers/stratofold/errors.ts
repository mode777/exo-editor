/**
 * Maps `@stratofold/client` failures onto the workspace error taxonomy.
 *
 * The client classifies by HTTP status, so the mapping is small and total. Two
 * rules matter beyond the code table:
 *
 * - an abort is decided by the caller's signal, not by the thrown type, because
 *   a transport failure during an abort looks like any other network error;
 * - provider messages never leave this module. The `WorkspaceError` carries a
 *   fixed message and the original error only as `cause`.
 */
import {
  ConfigurationError,
  StratofoldError,
  UploadCanceled,
  type FailureKind,
} from '@stratofold/client'
import { WorkspaceError, type WorkspaceErrorCode, type WorkspacePath } from '../../contract'

export type CredentialRejection = 'unauthorized' | 'forbidden'

const KIND_TO_CODE: Record<FailureKind, WorkspaceErrorCode> = {
  unauthorized: 'permission-denied',
  forbidden: 'permission-denied',
  notfound: 'not-found',
  conflict: 'conflict',
  retryable: 'io',
  rejected: 'io',
  server: 'io',
}

export function rejectionOf(error: unknown): CredentialRejection | null {
  if (!(error instanceof StratofoldError)) return null
  if (error.kind === 'unauthorized') return 'unauthorized'
  if (error.kind === 'forbidden') return 'forbidden'
  return null
}

export function mapStratofoldError(
  error: unknown,
  path?: WorkspacePath,
  signal?: AbortSignal,
): WorkspaceError {
  if (error instanceof WorkspaceError) {
    if (error.path === undefined && path !== undefined) {
      return new WorkspaceError(error.code, error.message, { path, cause: error })
    }
    return error
  }
  if (signal?.aborted || error instanceof UploadCanceled) {
    return new WorkspaceError('aborted', 'The workspace operation was cancelled.', {
      path,
      cause: error,
    })
  }
  if (error instanceof StratofoldError) {
    return new WorkspaceError(KIND_TO_CODE[error.kind], messageFor(KIND_TO_CODE[error.kind]), {
      path,
      cause: error,
    })
  }
  if (error instanceof ConfigurationError) {
    return new WorkspaceError('io', 'The remote workspace is misconfigured.', {
      path,
      cause: error,
    })
  }
  return new WorkspaceError('io', 'The remote workspace operation failed.', { path, cause: error })
}

function messageFor(code: WorkspaceErrorCode): string {
  switch (code) {
    case 'permission-denied':
      return 'The remote server denied the request.'
    case 'not-found':
      return 'The remote path does not exist.'
    case 'conflict':
      return 'The remote file changed.'
    default:
      return 'The remote workspace operation failed.'
  }
}

/**
 * Races a client call that has no `AbortSignal` of its own against the caller's
 * signal. The remote operation is not cancelled - Stratofold 0.12.0 has no
 * signal on `list`, `mkdir`, `move` or `remove` - so the promise rejects
 * immediately and the late result is dropped.
 */
export async function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  path?: WorkspacePath,
): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) {
    throw new WorkspaceError('aborted', 'The workspace operation was cancelled.', { path })
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new WorkspaceError('aborted', 'The workspace operation was cancelled.', { path }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
