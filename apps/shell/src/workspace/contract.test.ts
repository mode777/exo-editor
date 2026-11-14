import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_ERROR_CODES,
  WorkspaceError,
  asWorkspaceError,
  isWorkspaceError,
  workspaceErrorMessage,
} from './contract'

describe('workspace contract types', () => {
  it('pins every error code in the ratified contract', () => {
    expect(WORKSPACE_ERROR_CODES).toEqual([
      'not-found',
      'not-a-file',
      'not-a-directory',
      'already-exists',
      'permission-denied',
      'conflict',
      'quota-exceeded',
      'unsupported',
      'too-large',
      'aborted',
      'io',
    ])
  })

  it('carries code, path and cause without exposing a provider message', () => {
    const cause = new Error('provider stack trace')
    const error = new WorkspaceError('conflict', 'sanitized', {
      path: '/a.txt',
      cause,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('WorkspaceError')
    expect(error.code).toBe('conflict')
    expect(error.path).toBe('/a.txt')
    expect(error.cause).toBe(cause)
    expect(error.message).toBe('sanitized')
    expect(isWorkspaceError(error)).toBe(true)
  })

  it('sanitizes unknown failures into io', () => {
    const mapped = asWorkspaceError(new Error('raw backend text'), '/notes.md')

    expect(mapped.code).toBe('io')
    expect(mapped.path).toBe('/notes.md')
    expect(mapped.message).not.toContain('raw backend text')
    expect(mapped.cause).toBeInstanceOf(Error)
  })

  it('keeps an existing workspace error and fills a missing path', () => {
    const original = new WorkspaceError('not-found', 'gone')
    const mapped = asWorkspaceError(original, '/gone.txt')

    expect(mapped.code).toBe('not-found')
    expect(mapped.path).toBe('/gone.txt')
    expect(mapped.cause).toBe(original)
  })

  it('maps every code to user-facing text', () => {
    for (const code of WORKSPACE_ERROR_CODES) {
      expect(workspaceErrorMessage(code, '/file.txt').length).toBeGreaterThan(0)
    }
  })
})
