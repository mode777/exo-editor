import { describe, expect, it } from 'vitest'
import { connectStratofold, DISCOVERY_VDIR, StratofoldConnectError } from './connection'
import { FAKE_TOKEN, FakeStratofoldServer, FAKE_VDIR } from './fake-server'

const VIEWER_TOKEN = 'sf_v1_viewer_token'

function serverWithToken() {
  return new FakeStratofoldServer({
    tokens: [
      { token: FAKE_TOKEN, role: 'editor', name: 'Exo editor' },
      { token: VIEWER_TOKEN, role: 'viewer', name: 'Exo viewer' },
    ],
  })
}

describe('stratofold connection', () => {
  it('discovers the directory and role from a token with one probe request', async () => {
    const server = serverWithToken()
    const { connection, client } = await connectStratofold(
      { server: server.baseUrl, token: VIEWER_TOKEN },
      { fetch: server.fetch, createXhr: server.createXhr },
    )

    expect(connection).toEqual({
      server: server.baseUrl,
      vdir: FAKE_VDIR,
      name: 'demo',
      role: 'viewer',
      token: VIEWER_TOKEN,
    })
    expect(server.requests).toHaveLength(1)
    expect(new URL(server.requests[0].url).pathname).toBe('/api/sf/tokens/me')
    expect(server.requests[0].headers.authorization).toBe(`Bearer ${VIEWER_TOKEN}`)
    expect(server.requests[0].url).not.toContain(VIEWER_TOKEN)

    // The probe is discarded: the real client addresses the discovered vdir.
    expect((await client.stat('')).kind).toBe('directory')
    expect(server.requests[1].url).toContain(`/vdirs/${FAKE_VDIR}/stat`)
  })

  it('never puts the discovery sentinel on the wire as a directory', async () => {
    const server = serverWithToken()
    await connectStratofold(
      { server: server.baseUrl, token: FAKE_TOKEN },
      { fetch: server.fetch, createXhr: server.createXhr },
    )
    expect(DISCOVERY_VDIR).toBe('-')
    expect(server.requests.some((request) => request.url.includes('/vdirs/-/'))).toBe(false)
  })

  it('validates a public directory with a listing and stores no credential', async () => {
    const server = new FakeStratofoldServer({
      publicRead: true,
      tokens: [],
      initialFiles: { 'readme.md': '# hi' },
    })
    const { connection } = await connectStratofold(
      { server: server.baseUrl, vdir: FAKE_VDIR },
      { fetch: server.fetch, createXhr: server.createXhr },
    )

    expect(connection).toEqual({
      server: server.baseUrl,
      vdir: FAKE_VDIR,
      name: FAKE_VDIR,
      role: 'public',
    })
    expect(server.requests.every((request) => !request.headers.authorization)).toBe(true)
    expect(server.requests).toHaveLength(1)
  })

  it('distinguishes an unreachable server, a rejected token and a directory mismatch', async () => {
    const unreachable = new FakeStratofoldServer()
    unreachable.failNext('network')
    await expect(
      connectStratofold(
        { server: unreachable.baseUrl, token: FAKE_TOKEN },
        { fetch: unreachable.fetch, createXhr: unreachable.createXhr },
      ),
    ).rejects.toMatchObject({ code: 'network' })

    const rejecting = serverWithToken()
    await expect(
      connectStratofold(
        { server: rejecting.baseUrl, token: 'sf_v1_wrong' },
        { fetch: rejecting.fetch, createXhr: rejecting.createXhr },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })

    const matching = serverWithToken()
    await expect(
      connectStratofold(
        { server: matching.baseUrl, token: FAKE_TOKEN, vdir: 'another-vdir' },
        { fetch: matching.fetch, createXhr: matching.createXhr },
      ),
    ).rejects.toMatchObject({
      code: 'mismatch',
      message: 'The token belongs to a different directory than the one requested.',
    })
  })

  it('reports a public directory that is not public', async () => {
    const server = serverWithToken()
    await expect(
      connectStratofold(
        { server: server.baseUrl, vdir: FAKE_VDIR },
        { fetch: server.fetch, createXhr: server.createXhr },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('rejects unusable input before any request', async () => {
    const server = serverWithToken()
    const seams = { fetch: server.fetch, createXhr: server.createXhr }

    for (const request of [
      { server: '   ', token: FAKE_TOKEN },
      { server: 'ftp://files.test', token: FAKE_TOKEN },
      { server: 'not a url', token: FAKE_TOKEN },
      { server: server.baseUrl },
    ]) {
      const error = await connectStratofold(request, seams).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(StratofoldConnectError)
      expect((error as StratofoldConnectError).code).toBe('invalid-server')
    }
    expect(server.requests).toEqual([])
  })
})
