import { describe, expect, it } from 'vitest'

import { runProviderConformance } from '../conformance'
import { clientFor, type StratofoldConnection, type StratofoldRole } from './connection'
import { FakeStratofoldServer, FAKE_TOKEN } from './fake-server'
import { stratofoldWorkspaceId, StratofoldWorkspaceProvider } from './provider'

const VIEWER_TOKEN = 'sf_v1_viewer_token'

function seededServer(role: StratofoldRole = 'editor'): FakeStratofoldServer {
  const tokens =
    role === 'public'
      ? []
      : [
          { token: FAKE_TOKEN, role: 'editor' as const, name: 'Exo editor' },
          { token: VIEWER_TOKEN, role: 'viewer' as const, name: 'Exo viewer' },
        ]
  return new FakeStratofoldServer({
    publicRead: role === 'public',
    tokens,
  })
}

function providerFor(server: FakeStratofoldServer, role: StratofoldRole = 'editor') {
  const connection: StratofoldConnection = {
    server: server.baseUrl,
    vdir: server.vdir,
    name: server.vdirName,
    role,
    token: role === 'editor' ? FAKE_TOKEN : role === 'viewer' ? VIEWER_TOKEN : undefined,
  }
  return {
    connection,
    provider: new StratofoldWorkspaceProvider({
      connection,
      client: clientFor(connection, { fetch: server.fetch, createXhr: server.createXhr }),
    }),
  }
}

runProviderConformance('stratofold', () => {
  const server = seededServer('editor')
  return providerFor(server).provider
})

describe('stratofold provider capabilities', () => {
  it('is writable only for an editor credential', async () => {
    const editor = providerFor(seededServer('editor'), 'editor')
    expect(editor.provider.capabilities()).toEqual({
      writable: true,
      watchable: false,
      persistent: false,
      caseSensitive: false,
    })

    const viewer = providerFor(seededServer('viewer'), 'viewer')
    expect(viewer.provider.capabilities()).toMatchObject({ writable: false })

    const publicVdir = providerFor(seededServer('public'), 'public')
    expect(publicVdir.provider.capabilities()).toMatchObject({ writable: false })

    const handle = await editor.provider.open()
    expect(handle.descriptor.providerKind).toBe('stratofold')
    expect(handle.descriptor.name).toBe('demo')
    expect(handle.watch).toBeUndefined()
  })

  it('keeps the descriptor id stable and free of the credential', () => {
    const { connection, provider } = providerFor(seededServer())
    expect(stratofoldWorkspaceId(connection)).toBe(
      `stratofold:${new URL(connection.server).origin}:${connection.vdir}`,
    )
    expect(stratofoldWorkspaceId(connection)).not.toContain(FAKE_TOKEN)
    expect(provider.connection.token).toBe(FAKE_TOKEN)
  })

  it('restores its own id and refuses another workspace id', async () => {
    const { provider } = providerFor(seededServer())
    const handle = await provider.open()
    expect(await provider.restore(handle.descriptor.id)).not.toBeNull()
    expect(await provider.restore('stratofold:https://other.test:other')).toBeNull()
  })

  it('is read-only end to end for a viewer credential', async () => {
    const server = seededServer('viewer')
    const { provider } = providerFor(server, 'viewer')
    const handle = await provider.open()

    await expect(
      handle.write('/a.txt', new TextEncoder().encode('x'), { create: true }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    await expect(handle.mkdir('/docs')).rejects.toMatchObject({ code: 'unsupported' })
    await expect(handle.remove('/a.txt')).rejects.toMatchObject({ code: 'unsupported' })
    await expect(handle.move('/a.txt', '/b.txt')).rejects.toMatchObject({ code: 'unsupported' })
    expect(server.requests).toEqual([])
  })

  it('maps a server that rejects the credential on a normal operation', async () => {
    const server = seededServer('editor')
    const { provider, connection } = providerFor(server)
    const handle = await provider.open()

    server.failNext(401)
    const error = await handle.stat('/a.txt').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ code: 'permission-denied' })
    expect((error as Error).message).not.toContain('unauthorized')
    expect(connection.token).toBe(FAKE_TOKEN)
  })
})

describe('stratofold provider reads', () => {
  it('rejects a file above maxBytes before transferring it', async () => {
    const server = seededServer()
    server.seedFile('big.txt', '0123456789')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    await expect(handle.read('/big.txt', { maxBytes: 4 })).rejects.toMatchObject({
      code: 'too-large',
    })
    expect(server.requests.every((request) => !request.url.includes('/files/'))).toBe(true)
  })

  it('returns independent buffers for repeated reads', async () => {
    const server = seededServer()
    server.seedFile('a.txt', 'alpha')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    const first = await handle.read('/a.txt')
    first.fill(0)
    expect(new TextDecoder().decode(await handle.read('/a.txt'))).toBe('alpha')
  })

  it('never serves index.html for a directory read', async () => {
    const server = seededServer()
    server.seedDirectory('docs')
    server.seedFile('docs/index.html', '<html></html>')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    await expect(handle.read('/docs')).rejects.toMatchObject({ code: 'not-a-file' })
  })

  it('aborts a read when the signal fires', async () => {
    const server = seededServer()
    server.seedFile('a.txt', 'alpha')
    const { provider } = providerFor(server)
    const handle = await provider.open()
    const controller = new AbortController()
    controller.abort()

    await expect(handle.read('/a.txt', { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    })
  })

  it('stops a recursive listing when the signal fires mid-walk', async () => {
    const server = seededServer()
    server.seedDirectory('docs')
    server.seedFile('docs/a.txt', 'a')
    const { provider } = providerFor(server)
    const handle = await provider.open()
    const controller = new AbortController()

    const pending = handle.list('/', { depth: 'recursive', signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })
})

describe('stratofold provider writes and mutations', () => {
  it('rotates the version for a same-size save in the same second and rejects a stale precondition', async () => {
    const server = seededServer()
    server.seedFile('a.txt', 'aaaa')
    const { provider } = providerFor(server)
    const handle = await provider.open()
    const loaded = await handle.stat('/a.txt')

    const written = await handle.write('/a.txt', new TextEncoder().encode('bbbb'), {
      ifVersion: loaded.version,
    })
    expect(written.version).not.toBe(loaded.version)
    expect(server.readText('a.txt')).toBe('bbbb')

    const stale = await handle
      .write('/a.txt', new TextEncoder().encode('cccc'), { ifVersion: loaded.version })
      .catch((error: unknown) => error)
    expect(stale).toMatchObject({ code: 'conflict' })
    expect(server.readText('a.txt')).toBe('bbbb')
  })

  it('creates missing parents only when create is set', async () => {
    const server = seededServer()
    const { provider } = providerFor(server)
    const handle = await provider.open()

    await expect(
      handle.write('/nested/deep.txt', new TextEncoder().encode('x')),
    ).rejects.toMatchObject({ code: 'not-found' })

    const created = await handle.write('/nested/deep.txt', new TextEncoder().encode('x'), {
      create: true,
    })
    expect(created).toMatchObject({ path: '/nested/deep.txt', size: 1 })
    expect(server.readText('nested/deep.txt')).toBe('x')
  })

  it('refuses to overwrite an existing target without overwrite', async () => {
    const server = seededServer()
    server.seedFile('a.txt', 'alpha')
    server.seedFile('b.txt', 'beta')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    await expect(handle.move('/a.txt', '/b.txt')).rejects.toMatchObject({ code: 'already-exists' })
    expect(server.readText('a.txt')).toBe('alpha')
    expect(server.readText('b.txt')).toBe('beta')

    const moved = await handle.move('/a.txt', '/b.txt', { overwrite: true })
    expect(moved.path).toBe('/b.txt')
    expect(server.readText('b.txt')).toBe('alpha')
  })

  it('fails a non-recursive remove of a non-empty folder without deleting it', async () => {
    const server = seededServer()
    server.seedDirectory('docs')
    server.seedFile('docs/a.txt', 'a')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    await expect(handle.remove('/docs')).rejects.toMatchObject({ code: 'io' })
    expect(server.readText('docs/a.txt')).toBe('a')

    await handle.remove('/docs', { recursive: true })
    await expect(handle.stat('/docs')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('reports a missing move source as not-found', async () => {
    const { provider } = providerFor(seededServer())
    const handle = await provider.open()
    await expect(handle.move('/missing.txt', '/b.txt')).rejects.toMatchObject({
      code: 'not-found',
    })
  })
})

describe('stratofold error mapping', () => {
  const cases: [number | 'network', string][] = [
    [401, 'permission-denied'],
    [403, 'permission-denied'],
    [404, 'not-found'],
    [412, 'conflict'],
    [400, 'io'],
    [503, 'io'],
    [500, 'io'],
    ['network', 'io'],
  ]

  for (const [status, code] of cases) {
    it(`maps ${status} to ${code} without leaking the server message`, async () => {
      const server = seededServer()
      const { provider } = providerFor(server)
      const handle = await provider.open()

      server.failNext(status)
      const error = (await handle.stat('/a.txt').catch((caught: unknown) => caught)) as Error
      expect(error).toMatchObject({ code })
      expect(error.message).not.toMatch(/unauthorized|forbidden|not found|version mismatch/)
      expect(error.stack ?? '').not.toContain('fake-server')
    })
  }
})

describe('stratofold cancellation and dispose', () => {
  it('aborts the signal-less calls instead of waiting for the server', async () => {
    const server = seededServer()
    server.seedDirectory('docs')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    const operations: [string, (signal: AbortSignal) => Promise<unknown>][] = [
      ['list', (signal) => handle.list('/', { signal })],
      ['mkdir', (signal) => handle.mkdir('/new', { signal })],
      ['remove', (signal) => handle.remove('/docs', { signal })],
      ['move', (signal) => handle.move('/docs', '/moved', { signal })],
    ]

    for (const [name, operation] of operations) {
      const controller = new AbortController()
      const pending = operation(controller.signal)
      controller.abort()
      await expect(pending, name).rejects.toMatchObject({ code: 'aborted' })
    }
  })

  it('serves no operation after dispose and keeps no cached result', async () => {
    const server = seededServer()
    server.seedFile('a.txt', 'alpha')
    const { provider } = providerFor(server)
    const handle = await provider.open()

    const before = await handle.stat('/a.txt')
    provider.dispose()

    await expect(handle.stat('/a.txt')).rejects.toMatchObject({ code: 'io' })
    server.seedFile('a.txt', 'changed')
    await expect(handle.read('/a.txt')).rejects.toMatchObject({ code: 'io' })
    expect(before.size).toBe(5)
  })
})

describe('stratofold credential rejection signal', () => {
  it('reports a rejected credential and then stops issuing requests', async () => {
    const server = seededServer()
    server.seedFile('a.txt', 'alpha')
    const connection: StratofoldConnection = {
      server: server.baseUrl,
      vdir: server.vdir,
      name: server.vdirName,
      role: 'editor',
      token: FAKE_TOKEN,
    }
    const rejections: string[] = []
    const handleWith = async () => {
      const provider = new StratofoldWorkspaceProvider({
        connection,
        client: clientFor(connection, { fetch: server.fetch, createXhr: server.createXhr }),
        onCredentialRejected: (status) => rejections.push(status),
      })
      return provider.open()
    }

    const unauthorized = await handleWith()
    server.failNext(401)
    await expect(unauthorized.stat('/a.txt')).rejects.toMatchObject({ code: 'permission-denied' })
    expect(rejections).toEqual(['unauthorized'])

    const before = server.requests.length
    await expect(unauthorized.stat('/a.txt')).rejects.toMatchObject({ code: 'permission-denied' })
    expect(server.requests.length).toBe(before)

    const forbidden = await handleWith()
    server.failNext(403)
    await expect(forbidden.stat('/a.txt')).rejects.toMatchObject({ code: 'permission-denied' })
    expect(rejections).toEqual(['unauthorized', 'forbidden'])

    const missing = await handleWith()
    server.failNext(404)
    await expect(missing.stat('/a.txt')).rejects.toMatchObject({ code: 'not-found' })
    expect(rejections).toEqual(['unauthorized', 'forbidden'])
  })

  it('does not report a plain read-only refusal as a credential problem', async () => {
    const server = seededServer('viewer')
    const connection: StratofoldConnection = {
      server: server.baseUrl,
      vdir: server.vdir,
      name: server.vdirName,
      role: 'viewer',
      token: VIEWER_TOKEN,
    }
    const rejections: string[] = []
    const provider = new StratofoldWorkspaceProvider({
      connection,
      client: clientFor(connection, { fetch: server.fetch, createXhr: server.createXhr }),
      onCredentialRejected: (status) => rejections.push(status),
    })
    const handle = await provider.open()

    await expect(
      handle.write('/a.txt', new TextEncoder().encode('x'), { create: true }),
    ).rejects.toMatchObject({ code: 'unsupported' })
    expect(rejections).toEqual([])
  })
})
