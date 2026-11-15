import { describe, expect, it } from 'vitest'
import { StratofoldClient, StratofoldError } from '@stratofold/client'
import { FAKE_TOKEN, FakeStratofoldServer } from './fake-server'

function clientFor(server: FakeStratofoldServer, token: string | null = FAKE_TOKEN) {
  return new StratofoldClient({
    baseUrl: server.baseUrl,
    vdir: server.vdir,
    token: token ?? undefined,
    fetch: server.fetch,
    createXhr: server.createXhr,
  })
}

const encoder = new TextEncoder()

describe('fake Stratofold server', () => {
  it('lists, stats and uploads through the published client', async () => {
    const server = new FakeStratofoldServer({
      initialFiles: { 'a.txt': 'alpha' },
      initialDirectories: ['docs'],
    })
    const client = clientFor(server)

    const root = await client.list('')
    expect(root.map((entry) => entry.name)).toEqual(['a.txt', 'docs'])
    expect(root[1]).toMatchObject({ dir: true, size: 0 })

    const stat = await client.stat('a.txt')
    expect(stat).toMatchObject({ path: 'a.txt', name: 'a.txt', kind: 'file', size: 5 })
    expect(stat.version).toBe(server.versionOf('a.txt'))

    const encoded = encoder.encode('beta')
    const result = await client.upload('a.txt', encoded.buffer.slice(0) as ArrayBuffer, {
      ifVersion: stat.version,
    })
    expect(result).toMatchObject({ path: 'a.txt', size: 4 })
    expect(server.readText('a.txt')).toBe('beta')
    expect(await client.list('docs')).toEqual([])
  })

  it('rejects a stale conditional upload with the current version', async () => {
    const server = new FakeStratofoldServer({ initialFiles: { 'a.txt': 'alpha' } })
    const client = clientFor(server)
    const loaded = await client.stat('a.txt')
    server.seedFile('a.txt', 'newer')

    const error = await client
      .upload('a.txt', encoder.encode('stale').buffer as ArrayBuffer, {
        ifVersion: loaded.version,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(StratofoldError)
    expect(error).toMatchObject({ kind: 'conflict', status: 412 })
    expect(server.readText('a.txt')).toBe('newer')
  })

  it('rejects a bad token and keeps credentials out of every URL', async () => {
    const server = new FakeStratofoldServer({ initialFiles: { 'a.txt': 'alpha' } })

    await expect(clientFor(server, 'sf_v1_wrong').list('')).rejects.toMatchObject({
      kind: 'unauthorized',
    })
    await expect(clientFor(server, null).list('')).rejects.toMatchObject({
      kind: 'unauthorized',
    })

    server.requests.length = 0
    const client = clientFor(server)
    await client.list('')
    await client.stat('a.txt')
    expect(server.requests.length).toBe(2)
    for (const request of server.requests) {
      expect(request.url).not.toContain(FAKE_TOKEN)
      expect(request.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`)
    }
  })

  it('serves a public vdir without a token', async () => {
    const server = new FakeStratofoldServer({
      publicRead: true,
      tokens: [],
      initialFiles: { 'a.txt': 'alpha' },
    })
    const client = clientFor(server, null)

    expect((await client.list('')).map((entry) => entry.name)).toEqual(['a.txt'])
    expect(server.requests.every((request) => !request.headers.authorization)).toBe(true)
  })
})
