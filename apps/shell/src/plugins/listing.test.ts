import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceError, type FileStat, type WorkspacePath } from '../workspace/contract'
import {
  LISTING_PAGE_TIMEOUT_MS,
  ListingBroker,
  listingCodeFor,
  listingCursor,
  type ListingBrokerOptions,
} from './listing'

const DIR = '/dir'

function stat(path: WorkspacePath, kind: FileStat['kind'] = 'file', size = 1): FileStat {
  return {
    path,
    kind,
    size: kind === 'file' ? size : 0,
    mtime: 1000,
    version: kind === 'file' ? 'v1' : 'd1',
  }
}

function many(count: number, make: (index: number) => FileStat): FileStat[] {
  return Array.from({ length: count }, (_, index) => make(index))
}

function makeBroker(overrides: Partial<ListingBrokerOptions> = {}): ListingBroker {
  return new ListingBroker({
    list: async () => [],
    caseSensitive: true,
    createSnapshotId: () => 'snap-1',
    ...overrides,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('listing broker', () => {
  it('pages a 1,001-entry directory with directories first', async () => {
    const directories = many(500, (index) =>
      stat(`/dir/d${String(index).padStart(3, '0')}`, 'directory'),
    )
    const files = many(501, (index) => stat(`/dir/f${String(index).padStart(3, '0')}`, 'file'))
    const broker = makeBroker({ list: async () => [...files, ...directories] })

    const first = await broker.list(DIR)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.page.entries).toHaveLength(1000)
    expect(first.page.entries[0].path).toBe('/dir/d000')
    expect(first.page.entries[499].kind).toBe('directory')
    expect(first.page.entries[500].path).toBe('/dir/f000')
    expect(first.page.nextCursor).toBeDefined()

    const second = await broker.list(DIR, first.page.nextCursor)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.page.entries).toEqual([{ path: '/dir/f500', kind: 'file', size: 1 }])
    expect(second.page.nextCursor).toBeUndefined()
    expect(JSON.stringify(first.page)).not.toContain('mtime')
    expect(JSON.stringify(first.page)).not.toContain('version')
  })

  it('returns the minimal entry shape and exact keys', async () => {
    const broker = makeBroker({
      list: async () => [stat('/dir/file.txt', 'file', 7), stat('/dir/sub', 'directory')],
    })
    const result = await broker.list(DIR)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.page.entries).toEqual([
      { path: '/dir/sub', kind: 'directory' },
      { path: '/dir/file.txt', kind: 'file', size: 7 },
    ])
    expect(Object.keys(result.page.entries[0]).sort()).toEqual(['kind', 'path'])
    expect(Object.keys(result.page.entries[1]).sort()).toEqual(['kind', 'path', 'size'])
  })

  it('sorts by path with the workspace case-sensitivity rule', async () => {
    const insensitive = makeBroker({
      caseSensitive: false,
      list: async () => [
        stat('/dir/Z', 'directory'),
        stat('/dir/c', 'directory'),
        stat('/dir/B', 'file'),
        stat('/dir/a', 'file'),
      ],
    })
    const result = await insensitive.list(DIR)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.page.entries.map((entry) => entry.path)).toEqual([
      '/dir/c',
      '/dir/Z',
      '/dir/a',
      '/dir/B',
    ])

    const sensitive = makeBroker({
      caseSensitive: true,
      list: async () => [stat('/dir/Z', 'directory'), stat('/dir/c', 'directory')],
    })
    const sensitiveResult = await sensitive.list(DIR)
    expect(sensitiveResult.ok).toBe(true)
    if (!sensitiveResult.ok) return
    expect(sensitiveResult.page.entries.map((entry) => entry.path)).toEqual(['/dir/Z', '/dir/c'])
  })

  it('matches direct children and cursor paths case-insensitively when the workspace does', async () => {
    const broker = makeBroker({
      caseSensitive: false,
      pageSize: 1,
      createSnapshotId: () => 'snap-case',
      list: async () => [stat('/DIR/a.txt'), stat('/dir/b.txt')],
    })
    const first = await broker.list('/dir')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.page.entries.map((entry) => entry.path)).toEqual(['/DIR/a.txt'])
    const cursor = first.page.nextCursor
    const second = await broker.list('/DIR', cursor)
    expect(second).toEqual({
      ok: true,
      page: { entries: [{ path: '/dir/b.txt', kind: 'file', size: 1 }] },
    })
  })

  it('filters reserved entries and non-direct children', async () => {
    const broker = makeBroker({
      list: async () => [
        stat('/exo.json'),
        stat('/.exo', 'directory'),
        stat('/.exo/state.json'),
        stat('/dir', 'directory'),
        stat('/dir/sub', 'directory'),
        stat('/dir/sub/grandchild.txt'),
        stat('/dir/file.txt'),
        stat('/elsewhere/file.txt'),
        stat('/file.txt'),
      ],
    })
    const root = await broker.list('/')
    expect(root.ok).toBe(true)
    if (!root.ok) return
    expect(root.page.entries.map((entry) => entry.path)).toEqual(['/dir', '/file.txt'])

    const nested = await broker.list('/dir')
    expect(nested.ok).toBe(true)
    if (!nested.ok) return
    expect(nested.page.entries.map((entry) => entry.path)).toEqual(['/dir/sub', '/dir/file.txt'])
  })

  it('continues the snapshot after create and delete, and a fresh request observes changes', async () => {
    let current = [stat('/dir/a.txt'), stat('/dir/b.txt'), stat('/dir/c.txt')]
    const broker = makeBroker({
      pageSize: 2,
      createSnapshotId: () => 'snap-stable',
      list: async () => current,
    })
    const first = await broker.list(DIR)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.page.entries.map((entry) => entry.path)).toEqual(['/dir/a.txt', '/dir/b.txt'])
    const cursor = first.page.nextCursor
    expect(cursor).toBeDefined()

    current = [stat('/dir/new.txt')]
    const second = await broker.list(DIR, cursor)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.page.entries.map((entry) => entry.path)).toEqual(['/dir/c.txt'])
    expect(second.page.nextCursor).toBeUndefined()

    const fresh = await broker.list(DIR)
    expect(fresh.ok).toBe(true)
    if (!fresh.ok) return
    expect(fresh.page.entries.map((entry) => entry.path)).toEqual(['/dir/new.txt'])
  })

  it('rejects malformed, foreign, mismatched and evicted cursors', async () => {
    const broker = makeBroker({
      pageSize: 2,
      maxSnapshots: 1,
      list: async () => [stat('/dir/a.txt'), stat('/dir/b.txt'), stat('/dir/c.txt')],
    })
    const first = await broker.list(DIR)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const cursor = first.page.nextCursor
    expect(cursor).toBeDefined()

    for (const bad of ['nope', 'v1.undefined.1', 'v2.snap-1.1', listingCursor('missing', 1)]) {
      await expect(broker.list(DIR, bad)).resolves.toEqual({ ok: false, code: 'not-found' })
    }
    await expect(broker.list('/other', cursor)).resolves.toEqual({
      ok: false,
      code: 'not-found',
    })

    // A new directory evicts the first snapshot under the one-snapshot cap.
    const other = await broker.list('/other')
    expect(other.ok).toBe(true)
    await expect(broker.list(DIR, cursor)).resolves.toEqual({ ok: false, code: 'not-found' })
  })

  it('rate limits the fifth in-flight request', async () => {
    let release: (entries: FileStat[]) => void = () => undefined
    const pending = new Promise<FileStat[]>((resolve) => {
      release = resolve
    })
    const broker = makeBroker({ list: () => pending })

    const firstFour = [1, 2, 3, 4].map(() => broker.list(DIR))
    await expect(broker.list(DIR)).resolves.toEqual({ ok: false, code: 'rate-limited' })
    release([stat('/dir/a.txt')])
    await Promise.all(firstFour)
  })

  it('enforces a rolling twenty-per-second rate limit', async () => {
    let now = 0
    let listings = 0
    const broker = makeBroker({
      now: () => now,
      rateLimit: 20,
      maxSnapshots: 32,
      list: async () => {
        listings += 1
        return [stat('/dir/a.txt')]
      },
    })
    for (let index = 0; index < 20; index += 1) {
      await expect(broker.list(DIR)).resolves.toMatchObject({ ok: true })
    }
    expect(listings).toBe(20)
    await expect(broker.list(DIR)).resolves.toEqual({ ok: false, code: 'rate-limited' })
    expect(listings).toBe(20)

    now = 1000
    await expect(broker.list(DIR)).resolves.toMatchObject({ ok: true })
    expect(listings).toBe(21)
  })

  it('times out a page at five seconds and ignores a late result', async () => {
    vi.useFakeTimers()
    let release: (entries: FileStat[]) => void = () => undefined
    const pending = new Promise<FileStat[]>((resolve) => {
      release = resolve
    })
    let listing: Promise<FileStat[]> = pending
    const broker = makeBroker({
      list: () => listing,
    })
    const request = broker.list(DIR)
    await vi.advanceTimersByTimeAsync(LISTING_PAGE_TIMEOUT_MS)
    await expect(request).resolves.toEqual({ ok: false, code: 'timeout' })

    release([stat('/dir/late.txt')])
    await vi.advanceTimersByTimeAsync(0)
    listing = Promise.resolve([stat('/dir/fresh.txt')])
    await expect(broker.list(DIR)).resolves.toMatchObject({ ok: true })
  })

  it('reset cancels a pending page', async () => {
    let release: (entries: FileStat[]) => void = () => undefined
    const pending = new Promise<FileStat[]>((resolve) => {
      release = resolve
    })
    const broker = makeBroker({ list: () => pending })
    const request = broker.list(DIR)
    broker.reset()
    await expect(request).resolves.toEqual({ ok: false, code: 'internal' })
    release([stat('/dir/a.txt')])
  })

  it('reset drops every snapshot', async () => {
    const broker = makeBroker({
      pageSize: 1,
      list: async () => [stat('/dir/a.txt'), stat('/dir/b.txt')],
    })
    const first = await broker.list(DIR)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const cursor = first.page.nextCursor
    expect(cursor).toBeDefined()

    broker.reset()
    await expect(broker.list(DIR, cursor)).resolves.toEqual({ ok: false, code: 'not-found' })
  })

  it('maps workspace failures to the listing vocabulary', async () => {
    const codes: Array<[unknown, string]> = [
      [new WorkspaceError('not-found', 'missing'), 'not-found'],
      [new WorkspaceError('not-a-directory', 'file'), 'not-a-directory'],
      [new WorkspaceError('permission-denied', 'denied'), 'permission-denied'],
      [new WorkspaceError('io', 'io failure'), 'internal'],
      [new Error('boom'), 'internal'],
    ]
    expect(listingCodeFor(new WorkspaceError('not-a-directory', 'file'))).toBe('not-a-directory')
    for (const [error, code] of codes) {
      const broker = makeBroker({ list: async () => Promise.reject(error) })
      await expect(broker.list(DIR)).resolves.toEqual({ ok: false, code })
    }
  })
})
