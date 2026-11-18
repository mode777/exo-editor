import {
  asWorkspaceError,
  type FileStat,
  type ListOptions,
  type WorkspacePath,
} from '../workspace/contract'
import { dirname, isReservedPath } from '../workspace/paths'
import type { ShellErrorCode } from './protocol'

/**
 * One handler's directory-listing broker. It is the only place that turns a
 * workspace listing into a bounded page: a snapshot is taken on the first
 * request, later pages slice the same snapshot, and every request is rate- and
 * concurrency-limited so a plugin cannot use discovery to hammer the provider.
 */

export const LISTING_PAGE_SIZE = 1_000
export const LISTING_PAGE_TIMEOUT_MS = 5_000
export const LISTING_MAX_IN_FLIGHT = 4
export const LISTING_RATE_LIMIT = 20
export const LISTING_RATE_WINDOW_MS = 1_000
export const LISTING_MAX_SNAPSHOTS = 8
export const LISTING_MAX_SNAPSHOT_ENTRIES = 20_000

/** The minimal wire shape. There is deliberately no mtime, version or content. */
export interface DirectoryEntry {
  path: WorkspacePath
  kind: 'file' | 'directory'
  size?: number
}

export interface ListingPage {
  entries: DirectoryEntry[]
  nextCursor?: string
}

export type ListingResult = { ok: true; page: ListingPage } | { ok: false; code: ShellErrorCode }

export interface ListingBrokerOptions {
  /** The plugin-scoped facade; it filters reserved entries and logs denials. */
  list(path: WorkspacePath, options?: ListOptions): Promise<FileStat[]>
  caseSensitive: boolean
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
  now?: () => number
  createSnapshotId?: () => string
  pageSize?: number
  timeoutMs?: number
  maxInFlight?: number
  rateLimit?: number
  rateWindowMs?: number
  maxSnapshots?: number
  maxSnapshotEntries?: number
}

interface Snapshot {
  id: string
  path: WorkspacePath
  entries: FileStat[]
}

interface PendingRequest {
  controller: AbortController
  cancel: () => void
}

interface ParsedCursor {
  id: string
  offset: number
}

const CURSOR_PATTERN = /^v1\.([A-Za-z0-9_-]{1,64})\.(0|[1-9][0-9]{0,8})$/

function defaultSnapshotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function listingCursor(id: string, offset: number): string {
  return `v1.${id}.${offset}`
}

function parseCursor(cursor: string): ParsedCursor | null {
  const match = CURSOR_PATTERN.exec(cursor)
  if (!match) return null
  return { id: match[1], offset: Number(match[2]) }
}

/** Map a workspace failure to the listing protocol vocabulary. */
export function listingCodeFor(error: unknown): ShellErrorCode {
  const mapped = asWorkspaceError(error)
  switch (mapped.code) {
    case 'not-found':
      return 'not-found'
    case 'not-a-directory':
      return 'not-a-directory'
    case 'permission-denied':
      return 'permission-denied'
    default:
      return 'internal'
  }
}

function entryOf(stat: FileStat): DirectoryEntry {
  return {
    path: stat.path,
    kind: stat.kind,
    ...(stat.kind === 'file' ? { size: stat.size } : {}),
  }
}

export class ListingBroker {
  private readonly listPath: (path: WorkspacePath, options?: ListOptions) => Promise<FileStat[]>
  private readonly caseSensitive: boolean
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout
  private readonly now: () => number
  private readonly createSnapshotId: () => string
  private readonly pageSize: number
  private readonly timeoutMs: number
  private readonly maxInFlight: number
  private readonly rateLimit: number
  private readonly rateWindowMs: number
  private readonly maxSnapshots: number
  private readonly maxSnapshotEntries: number
  private readonly snapshots = new Map<string, Snapshot>()
  private readonly pending = new Map<number, PendingRequest>()
  private requestTimes: number[] = []
  private nextPendingId = 0
  private generation = 0

  constructor(options: ListingBrokerOptions) {
    this.listPath = options.list
    this.caseSensitive = options.caseSensitive
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
    this.now = options.now ?? (() => Date.now())
    this.createSnapshotId = options.createSnapshotId ?? defaultSnapshotId
    this.pageSize = options.pageSize ?? LISTING_PAGE_SIZE
    this.timeoutMs = options.timeoutMs ?? LISTING_PAGE_TIMEOUT_MS
    this.maxInFlight = options.maxInFlight ?? LISTING_MAX_IN_FLIGHT
    this.rateLimit = options.rateLimit ?? LISTING_RATE_LIMIT
    this.rateWindowMs = options.rateWindowMs ?? LISTING_RATE_WINDOW_MS
    this.maxSnapshots = options.maxSnapshots ?? LISTING_MAX_SNAPSHOTS
    this.maxSnapshotEntries = options.maxSnapshotEntries ?? LISTING_MAX_SNAPSHOT_ENTRIES
  }

  /**
   * Serve one page. The caller has already normalized the path, checked the
   * reserved set and the permission. Malformed, foreign, mismatched and evicted
   * cursors all read as `not-found` so the plugin re-lists.
   */
  async list(path: WorkspacePath, cursor?: string): Promise<ListingResult> {
    const now = this.now()
    this.pruneRateWindow(now)
    if (this.pending.size >= this.maxInFlight) {
      return { ok: false, code: 'rate-limited' }
    }
    if (this.requestTimes.length >= this.rateLimit) {
      return { ok: false, code: 'rate-limited' }
    }
    this.requestTimes.push(now)

    if (cursor !== undefined) return this.continuePage(path, cursor)
    return this.firstPage(path)
  }

  /** Handler disposal or workspace switch: drop every snapshot and page. */
  reset(): void {
    this.generation += 1
    for (const pending of this.pending.values()) {
      pending.controller.abort()
      pending.cancel()
    }
    this.pending.clear()
    this.snapshots.clear()
    this.requestTimes = []
  }

  private async firstPage(path: WorkspacePath): Promise<ListingResult> {
    const generation = this.generation
    const controller = new AbortController()
    const pendingId = ++this.nextPendingId
    let cancel: () => void = () => undefined
    const cancelled = new Promise<'cancelled'>((resolve) => {
      cancel = () => resolve('cancelled')
    })
    this.pending.set(pendingId, { controller, cancel })

    let timer: ReturnType<typeof setTimeout> | null = null
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = this.setTimeoutImpl(() => {
        controller.abort()
        resolve('timeout')
      }, this.timeoutMs)
    })

    try {
      const listing = this.listPath(path, { depth: 'one', signal: controller.signal })
      const result = await Promise.race([listing, timedOut, cancelled])
      if (result === 'timeout') return { ok: false, code: 'timeout' }
      if (result === 'cancelled' || generation !== this.generation) {
        return { ok: false, code: 'internal' }
      }
      const snapshot: Snapshot = {
        id: this.createSnapshotId(),
        path,
        entries: this.prepare(path, result),
      }
      this.store(snapshot)
      return this.pageFrom(snapshot, 0)
    } catch (error) {
      if (generation !== this.generation) return { ok: false, code: 'internal' }
      return { ok: false, code: listingCodeFor(error) }
    } finally {
      if (timer !== null) this.clearTimeoutImpl(timer)
      this.pending.delete(pendingId)
    }
  }

  private continuePage(path: WorkspacePath, cursor: string): ListingResult {
    const parsed = parseCursor(cursor)
    if (!parsed) return { ok: false, code: 'not-found' }
    const snapshot = this.snapshots.get(parsed.id)
    if (!snapshot || !this.samePath(snapshot.path, path)) return { ok: false, code: 'not-found' }
    if (parsed.offset <= 0 || parsed.offset >= snapshot.entries.length) {
      return { ok: false, code: 'not-found' }
    }
    // Mark the snapshot as most recently used.
    this.snapshots.delete(parsed.id)
    this.snapshots.set(parsed.id, snapshot)
    return this.pageFrom(snapshot, parsed.offset)
  }

  private pageFrom(snapshot: Snapshot, offset: number): ListingResult {
    const slice = snapshot.entries.slice(offset, offset + this.pageSize)
    const next = offset + slice.length
    return {
      ok: true,
      page: {
        entries: slice.map(entryOf),
        ...(next < snapshot.entries.length ? { nextCursor: listingCursor(snapshot.id, next) } : {}),
      },
    }
  }

  /** Direct children only, reserved entries re-filtered, deterministic order. */
  private prepare(path: WorkspacePath, stats: FileStat[]): FileStat[] {
    const entries = stats.filter((stat) => {
      if (typeof stat?.path !== 'string') return false
      if (isReservedPath(stat.path, this.caseSensitive)) return false
      try {
        return this.samePath(dirname(stat.path), path)
      } catch {
        return false
      }
    })
    return entries.sort((left, right) => this.compare(left, right))
  }

  private samePath(left: WorkspacePath, right: WorkspacePath): boolean {
    if (this.caseSensitive) return left === right
    return left.toLowerCase() === right.toLowerCase()
  }

  private compare(left: FileStat, right: FileStat): number {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    const a = this.caseSensitive ? left.path : left.path.toLowerCase()
    const b = this.caseSensitive ? right.path : right.path.toLowerCase()
    if (a < b) return -1
    if (a > b) return 1
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  }

  /**
   * The newest snapshot is always admitted. Older snapshots are evicted in LRU
   * order until both caps hold; a single directory larger than the entry cap
   * stays intact so pagination is never silently truncated.
   */
  private store(snapshot: Snapshot): void {
    this.snapshots.delete(snapshot.id)
    this.snapshots.set(snapshot.id, snapshot)
    let total = 0
    for (const item of this.snapshots.values()) total += item.entries.length
    while (
      this.snapshots.size > 1 &&
      (this.snapshots.size > this.maxSnapshots || total > this.maxSnapshotEntries)
    ) {
      const oldest = this.snapshots.keys().next().value
      if (oldest === undefined) break
      const evicted = this.snapshots.get(oldest)
      this.snapshots.delete(oldest)
      total -= evicted?.entries.length ?? 0
    }
  }

  private pruneRateWindow(now: number): void {
    this.requestTimes = this.requestTimes.filter((time) => now - time < this.rateWindowMs)
  }
}
