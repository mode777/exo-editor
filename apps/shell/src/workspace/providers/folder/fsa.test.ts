import { describe, expect, it } from 'vitest'
import { WorkspaceError } from '../../contract'
import { mapFsaError, queryPermission, supportsFolderWorkspaces } from './fsa'

describe('File System Access error mapping', () => {
  it.each([
    ['NotFoundError', 'not-found'],
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NoModificationAllowedError', 'permission-denied'],
    ['QuotaExceededError', 'quota-exceeded'],
    ['AbortError', 'aborted'],
    ['TypeMismatchError', 'io'],
    ['InvalidModificationError', 'io'],
    ['InvalidStateError', 'io'],
    ['SyntaxError', 'io'],
    ['SomeFutureError', 'io'],
  ] as const)('maps %s to %s', (name, code) => {
    expect(mapFsaError(new DOMException('message', name), '/file.txt')).toMatchObject({
      code,
      path: '/file.txt',
    })
  })

  it('keeps an existing workspace error unchanged', () => {
    const original = new WorkspaceError('conflict', 'changed')
    expect(mapFsaError(original)).toBe(original)
  })

  it('detects browser support and defaults missing permission APIs to granted', async () => {
    expect(supportsFolderWorkspaces()).toBe(false)

    const handle = {} as FileSystemHandle
    expect(await queryPermission(handle, 'readwrite')).toBe('granted')
  })
})
