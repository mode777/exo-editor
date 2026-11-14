import { describe, expect, it, vi } from 'vitest'
import { MemoryWorkspaceProvider } from './providers/memory'
import { Session } from './session'
import type { WorkspaceHandle } from './contract'

const encoder = new TextEncoder()

async function makeSession(options: ConstructorParameters<typeof MemoryWorkspaceProvider>[0] = {}) {
  const provider = new MemoryWorkspaceProvider({
    now: () => 1000,
    initialFiles: {
      '/exo.json': '{}',
      '/.exo/state.json': '{"private":true}',
      '/src/a.ts': 'export const a = 1',
      '/notes.txt': 'hello',
    },
    ...options,
  })
  const handle = await provider.open()
  const session = new Session(handle)
  return { provider, handle, session }
}

describe('session caller scoping', () => {
  it('lets the shell read reserved paths while a plugin facade is denied', async () => {
    const { session } = await makeSession()
    const plugin = session.forPlugin('plugin.one')

    expect(new TextDecoder().decode(await session.read('/exo.json'))).toBe('{}')
    await expect(plugin.read('/exo.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.stat('/.exo/state.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(session.getLog().at(-1)).toMatchObject({
      pluginId: 'plugin.one',
      code: 'permission-denied',
    })
  })

  it('lets the shell write reserved paths while a plugin facade is denied', async () => {
    const { session } = await makeSession()
    const plugin = session.forPlugin('plugin.one')
    const body = encoder.encode('{"schemaVersion":1,"plugins":[]}')

    await expect(session.write('/exo.json', body)).resolves.toMatchObject({
      kind: 'file',
    })
    expect(new TextDecoder().decode(await session.read('/exo.json'))).toBe(
      '{"schemaVersion":1,"plugins":[]}',
    )
    await expect(plugin.write('/exo.json', body)).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('denies every plugin mutation on reserved paths', async () => {
    const { session } = await makeSession()
    const plugin = session.forPlugin('plugin.one')

    await expect(plugin.write('/exo.json', encoder.encode('x'))).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.mkdir('/.exo/nested')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.remove('/.exo')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.move('/notes.txt', '/exo.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.move('/.exo/state.json', '/state.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('hides reserved entries from a plugin root listing', async () => {
    const { session } = await makeSession()
    const plugin = session.forPlugin('plugin.one')

    const visible = await plugin.list('/')
    expect(visible.map((entry) => entry.path)).not.toContain('/exo.json')
    expect(visible.map((entry) => entry.path)).not.toContain('/.exo')
    expect(visible.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['/notes.txt', '/src']),
    )

    const shell = await session.list('/')
    expect(shell.map((entry) => entry.path)).toEqual(expect.arrayContaining(['/exo.json', '/.exo']))
  })

  it('folds reserved names on a case-insensitive provider', async () => {
    const { session } = await makeSession({
      caseSensitive: false,
      initialFiles: { '/EXO.JSON': '{}' },
    })
    const plugin = session.forPlugin('plugin.one')

    await expect(plugin.read('/EXO.JSON')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.stat('/.EXO/state.json')).rejects.toMatchObject({
      code: 'permission-denied',
    })
  })

  it('rejects traversal before calling the provider', async () => {
    const { handle, session } = await makeSession()
    const read = vi.spyOn(handle, 'read')
    const plugin = session.forPlugin('plugin.one')

    await expect(plugin.read('/src/../notes.txt')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    await expect(plugin.read('/src\\notes.txt')).rejects.toMatchObject({
      code: 'permission-denied',
    })
    expect(read).not.toHaveBeenCalled()
  })
})

describe('session versions and aborts', () => {
  it('rejects a stale ifVersion before the provider write', async () => {
    const { handle, session } = await makeSession()
    const loaded = await session.stat('/notes.txt')
    await session.write('/notes.txt', encoder.encode('newer'))
    const write = vi.spyOn(handle, 'write')

    await expect(
      session.write('/notes.txt', encoder.encode('stale'), {
        ifVersion: loaded.version,
      }),
    ).rejects.toMatchObject({ code: 'conflict' })

    expect(write).not.toHaveBeenCalled()
    expect(new TextDecoder().decode(await session.read('/notes.txt'))).toBe('newer')
  })

  it('starts no provider call when the signal is already aborted', async () => {
    const { handle, session } = await makeSession()
    const read = vi.spyOn(handle, 'read')
    const controller = new AbortController()
    controller.abort()

    await expect(session.read('/notes.txt', { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('maps a missing path to not-found', async () => {
    const { session } = await makeSession()
    await expect(session.read('/missing.txt')).rejects.toMatchObject({
      code: 'not-found',
      path: '/missing.txt',
    })
  })
})

describe('session plugin facade shape', () => {
  it('returns the same facade for a plugin id and rejects an empty id', async () => {
    const { session } = await makeSession()

    expect(session.forPlugin('plugin.one')).toBe(session.forPlugin('plugin.one'))
    expect(() => session.forPlugin('')).toThrow(
      expect.objectContaining({ code: 'permission-denied' }),
    )
  })

  it('exposes no handle or provider on the facade', async () => {
    const { session } = await makeSession()
    const plugin = session.forPlugin('plugin.one') as unknown as Record<string, unknown>

    expect(plugin.descriptor).toBeUndefined()
    expect(plugin.handle).toBeUndefined()
    expect(plugin.forPlugin).toBeUndefined()
  })

  it('wraps a generic handle without leaking it through calls', async () => {
    const { handle } = await makeSession()
    const wrapped: WorkspaceHandle = handle
    const session = new Session(wrapped)

    await expect(session.stat('/notes.txt')).resolves.toMatchObject({
      path: '/notes.txt',
      kind: 'file',
    })
  })
})
