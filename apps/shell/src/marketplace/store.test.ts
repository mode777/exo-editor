import { describe, expect, it, vi } from 'vitest'
import { MarketplaceStore, type MarketplaceSnapshot } from './store'

const SOURCE_URL = 'https://shell.example.com/marketplace-sources.json'
const FEED_A = 'https://shell.example.com/a.json'
const FEED_B = 'https://other.example.com/b.json'

function sources(feeds: string[] = [FEED_A, FEED_B]) {
  return { schemaVersion: 1, feeds }
}

function feed(
  id: string,
  plugins: Array<{ name: string; manifest: string; description?: string }>,
) {
  return {
    schemaVersion: 1,
    id,
    name: id === 'feed-a' ? 'Feed A' : 'Feed B',
    owner: { name: 'Example' },
    plugins,
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function makeFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init
    const url = String(input)
    const handler = handlers[url]
    if (!handler) throw new Error(`Unexpected request: ${url}`)
    return handler()
  })
}

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for snapshot'))
        return
      }
      setTimeout(check, 0)
    }
    check()
  })
}

describe('MarketplaceStore', () => {
  it('does nothing until ensureLoaded is called', async () => {
    const fetchImpl = makeFetch({})
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.getSnapshot().phase).toBe('idle')
    store.dispose()
  })

  it('loads the source and feeds, preserves order and dedupes manifests', async () => {
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources()),
      [FEED_A]: () =>
        jsonResponse(
          feed('feed-a', [
            { name: 'One', manifest: 'https://plugins.example.com/one/exo-manifest.json' },
            { name: 'Two', manifest: 'https://plugins.example.com/two/exo-manifest.json' },
          ]),
        ),
      [FEED_B]: () =>
        jsonResponse(
          feed('feed-b', [
            { name: 'Duplicate', manifest: 'https://plugins.example.com/one/exo-manifest.json' },
            { name: 'Three', manifest: 'https://plugins.example.com/three/exo-manifest.json' },
          ]),
        ),
    })
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    await store.ensureLoaded()
    const snapshot = store.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.sourceStatus).toBe('ready')
    expect(snapshot.feeds.map((entry) => entry.status)).toEqual(['ready', 'ready'])
    expect(snapshot.plugins.map((entry) => entry.entry.name)).toEqual(['One', 'Two', 'Three'])
    expect(snapshot.plugins[0]?.feedName).toBe('Feed A')
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([SOURCE_URL, FEED_A, FEED_B])
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({
        credentials: 'omit',
        cache: 'no-cache',
        referrerPolicy: 'no-referrer',
      })
    }
  })

  it('isolates a failed feed', async () => {
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources()),
      [FEED_A]: () =>
        jsonResponse(
          feed('feed-a', [
            { name: 'One', manifest: 'https://plugins.example.com/one/exo-manifest.json' },
          ]),
        ),
      [FEED_B]: () => Promise.reject(new Error('offline')),
    })
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    await store.ensureLoaded()
    const snapshot = store.getSnapshot()
    expect(snapshot.feeds[0]?.status).toBe('ready')
    expect(snapshot.feeds[1]?.status).toBe('failed')
    expect(snapshot.feeds[1]?.issues[0]?.code).toBe('cors')
    expect(snapshot.plugins.map((entry) => entry.entry.name)).toEqual(['One'])
  })

  it('stops on an invalid source and fetches no feed', async () => {
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse({ schemaVersion: 1, feeds: [] }),
    })
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    await store.ensureLoaded()
    const snapshot = store.getSnapshot()
    expect(snapshot.sourceStatus).toBe('failed')
    expect(snapshot.sourceIssues[0]?.field).toBe('/feeds')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(snapshot.feeds).toEqual([])
  })

  it('reports HTTP, content-type and JSON failures with stable codes', async () => {
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources([FEED_A])),
      [FEED_A]: () => new Response('not json', { headers: { 'content-type': 'text/plain' } }),
    })
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    await store.ensureLoaded()
    expect(store.getSnapshot().feeds[0]?.issues[0]?.code).toBe('invalid-json')
    store.dispose()

    const http = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources([FEED_A])),
      [FEED_A]: () =>
        new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }),
    })
    const second = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: http as never })
    await second.ensureLoaded()
    expect(second.getSnapshot().feeds[0]?.issues[0]).toMatchObject({
      code: 'http-status',
      status: 404,
    })
    second.dispose()
  })

  it('caps the feed body', async () => {
    const big = feed('feed-a', [
      {
        name: 'Big',
        manifest: 'https://plugins.example.com/big/exo-manifest.json',
        description: 'x'.repeat(5000),
      },
    ])
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources([FEED_A])),
      [FEED_A]: () => jsonResponse(big),
    })
    const store = new MarketplaceStore({
      sourceUrl: SOURCE_URL,
      fetchImpl: fetchImpl as never,
      feedMaxBytes: 200,
    })
    await store.ensureLoaded()
    expect(store.getSnapshot().feeds[0]?.issues[0]?.code).toBe('too-large')
  })

  it('times out a request', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const store = new MarketplaceStore({
      sourceUrl: SOURCE_URL,
      fetchImpl: fetchImpl as never,
      timeoutMs: 5,
    })
    await store.ensureLoaded()
    expect(store.getSnapshot().sourceStatus).toBe('failed')
    expect(store.getSnapshot().sourceIssues[0]?.code).toBe('timeout')
  })

  it('refreshes and replaces the catalog', async () => {
    let revision = 0
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources([FEED_A])),
      [FEED_A]: () => {
        revision += 1
        return jsonResponse(
          feed('feed-a', [
            {
              name: revision === 1 ? 'First' : 'Second',
              manifest: `https://plugins.example.com/${revision}/exo-manifest.json`,
            },
          ]),
        )
      },
    })
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    await store.ensureLoaded()
    expect(store.getSnapshot().plugins[0]?.entry.name).toBe('First')
    await store.refresh()
    expect(store.getSnapshot().plugins[0]?.entry.name).toBe('Second')
  })

  it('ignores a late result after dispose', async () => {
    const deferred: { resolve?: (response: Response) => void } = {}
    const pending = new Promise<Response>((resolve) => {
      deferred.resolve = resolve
    })
    const store = new MarketplaceStore({
      sourceUrl: SOURCE_URL,
      fetchImpl: vi.fn(() => pending) as never,
    })
    const loading = store.ensureLoaded()
    store.dispose()
    deferred.resolve?.(jsonResponse(sources([FEED_A])))
    await loading
    expect(store.getSnapshot()).toMatchObject({
      phase: 'idle',
      sourceStatus: 'idle',
      feeds: [],
      plugins: [],
    } satisfies Partial<MarketplaceSnapshot>)
  })

  it('reports a same-origin source failure as network', async () => {
    const store = new MarketplaceStore({
      sourceUrl: SOURCE_URL,
      fetchImpl: vi.fn(async () => {
        throw new TypeError('failed')
      }) as never,
    })
    await store.ensureLoaded()
    expect(store.getSnapshot().sourceIssues[0]?.code).toBe('network')
  })

  it('emits updates to subscribers', async () => {
    const fetchImpl = makeFetch({
      [SOURCE_URL]: () => jsonResponse(sources([FEED_A])),
      [FEED_A]: () =>
        jsonResponse(
          feed('feed-a', [
            { name: 'One', manifest: 'https://plugins.example.com/one/exo-manifest.json' },
          ]),
        ),
    })
    const store = new MarketplaceStore({ sourceUrl: SOURCE_URL, fetchImpl: fetchImpl as never })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const loading = store.ensureLoaded()
    await waitFor(() => store.getSnapshot().phase === 'loading')
    await loading
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    store.dispose()
  })
})
