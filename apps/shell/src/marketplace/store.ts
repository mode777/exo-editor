import {
  MARKETPLACE_FEED_MAX_BYTES,
  MARKETPLACE_FETCH_TIMEOUT_MS,
  MARKETPLACE_SOURCES_MAX_BYTES,
  parseMarketplaceFeed,
  parseMarketplaceSources,
  normalizeMarketplaceUrl,
  type MarketplaceFeed,
  type MarketplaceFeedPlugin,
  type MarketplaceIssue,
} from './feed'

export type MarketplacePhase = 'idle' | 'loading' | 'ready'
export type MarketplaceDocumentStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface MarketplaceCatalogPlugin {
  /** Normalized manifest URL; the catalog and install dedupe key. */
  key: string
  manifest: string
  feedUrl: string
  feedId: string
  feedName: string
  entry: MarketplaceFeedPlugin
}

export interface MarketplaceFeedSnapshot {
  url: string
  status: MarketplaceDocumentStatus
  id?: string
  name?: string
  pluginCount: number
  issues: MarketplaceIssue[]
}

export interface MarketplaceSnapshot {
  phase: MarketplacePhase
  sourceUrl: string
  sourceStatus: MarketplaceDocumentStatus
  sourceIssues: MarketplaceIssue[]
  feeds: MarketplaceFeedSnapshot[]
  plugins: MarketplaceCatalogPlugin[]
  revision: number
}

export interface MarketplaceStoreOptions {
  fetchImpl?: typeof fetch
  sourceUrl?: string
  timeoutMs?: number
  sourcesMaxBytes?: number
  feedMaxBytes?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

interface FetchTextResult {
  ok: boolean
  text?: string
  issues: MarketplaceIssue[]
  aborted?: boolean
}

const INITIAL_SNAPSHOT = (sourceUrl: string): MarketplaceSnapshot => ({
  phase: 'idle',
  sourceUrl,
  sourceStatus: 'idle',
  sourceIssues: [],
  feeds: [],
  plugins: [],
  revision: 0,
})

function defaultSourceUrl(): string {
  if (typeof document === 'undefined') return '/marketplace-sources.json'
  return new URL('marketplace-sources.json', document.baseURI).href
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function failureIssue(
  code: MarketplaceIssue['code'],
  message?: string,
  status?: number,
): MarketplaceIssue {
  return {
    code,
    ...(message === undefined ? {} : { message }),
    ...(status === undefined ? {} : { status }),
  }
}

function requestFailure(url: string, sourceUrl: string): MarketplaceIssue {
  const sourceOrigin = originOf(sourceUrl)
  const targetOrigin = originOf(url)
  if (sourceOrigin !== null && targetOrigin !== null && sourceOrigin !== targetOrigin) {
    return failureIssue(
      'cors',
      `The browser could not read ${targetOrigin}; CORS or a network failure is possible.`,
    )
  }
  return failureIssue('network', 'The marketplace request failed.')
}

/**
 * Deployment-scoped catalog state. It is never attached to a workspace, never
 * mounts a frame and never persists feed content. Loading is lazy: the
 * Extensions view calls `ensureLoaded()` when it first mounts.
 */
export class MarketplaceStore {
  private readonly fetchImpl: typeof fetch | undefined
  private readonly timeoutMs: number
  private readonly sourcesMaxBytes: number
  private readonly feedMaxBytes: number
  private readonly setTimeoutImpl: typeof setTimeout | undefined
  private readonly clearTimeoutImpl: typeof clearTimeout | undefined
  private readonly sourceUrl: string
  private readonly listeners = new Set<() => void>()
  private readonly controllers = new Set<AbortController>()
  private readonly documents = new Map<string, MarketplaceFeed>()
  private snapshot: MarketplaceSnapshot
  private generation = 0
  private inFlight: Promise<void> | null = null
  private runController: AbortController | null = null
  private disposed = false

  constructor(options: MarketplaceStoreOptions = {}) {
    this.fetchImpl = options.fetchImpl
    this.timeoutMs = options.timeoutMs ?? MARKETPLACE_FETCH_TIMEOUT_MS
    this.sourcesMaxBytes = options.sourcesMaxBytes ?? MARKETPLACE_SOURCES_MAX_BYTES
    this.feedMaxBytes = options.feedMaxBytes ?? MARKETPLACE_FEED_MAX_BYTES
    this.setTimeoutImpl = options.setTimeoutImpl
    this.clearTimeoutImpl = options.clearTimeoutImpl
    this.sourceUrl = options.sourceUrl ?? defaultSourceUrl()
    this.snapshot = INITIAL_SNAPSHOT(this.sourceUrl)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): MarketplaceSnapshot => this.snapshot

  /** Load the source list and feeds once; a later call is a no-op. */
  ensureLoaded(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.snapshot.sourceStatus !== 'idle') return Promise.resolve()
    if (this.inFlight) return this.inFlight
    return this.start()
  }

  /** Re-fetch the source list and every feed, discarding the current catalog. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.generation += 1
    this.runController?.abort()
    this.runController = null
    this.inFlight = null
    this.documents.clear()
    this.setSnapshot({
      ...INITIAL_SNAPSHOT(this.sourceUrl),
      phase: 'loading',
      sourceStatus: 'loading',
    })
    return this.start()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.runController?.abort()
    this.runController = null
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    this.inFlight = null
    this.documents.clear()
    this.setSnapshot(INITIAL_SNAPSHOT(this.sourceUrl))
  }

  private start(): Promise<void> {
    const controller = new AbortController()
    this.runController = controller
    const generation = this.generation
    const task = this.load(controller, generation)
    this.inFlight = task
    void task.finally(() => {
      if (this.inFlight === task) this.inFlight = null
      if (this.runController === controller) this.runController = null
    })
    return task
  }

  private current(controller: AbortController, generation: number): boolean {
    return (
      !this.disposed &&
      this.generation === generation &&
      this.runController === controller &&
      !controller.signal.aborted
    )
  }

  private async load(controller: AbortController, generation: number): Promise<void> {
    this.setSnapshot({
      ...INITIAL_SNAPSHOT(this.sourceUrl),
      phase: 'loading',
      sourceStatus: 'loading',
    })
    const source = await this.fetchText(
      this.sourceUrl,
      this.sourcesMaxBytes,
      controller,
      this.timeoutMs,
    )
    if (!this.current(controller, generation)) return
    if (!source.ok || source.text === undefined) {
      this.setSnapshot({
        phase: 'ready',
        sourceStatus: 'failed',
        sourceIssues: source.issues,
        feeds: [],
        plugins: [],
      })
      return
    }

    const parsed = parseMarketplaceSources(source.text)
    if (!parsed.ok) {
      this.setSnapshot({
        phase: 'ready',
        sourceStatus: 'failed',
        sourceIssues: parsed.issues,
        feeds: [],
        plugins: [],
      })
      return
    }

    const feeds: MarketplaceFeedSnapshot[] = parsed.sources.feeds.map((url) => ({
      url,
      status: 'loading',
      pluginCount: 0,
      issues: [],
    }))
    this.setSnapshot({ phase: 'loading', sourceStatus: 'ready', feeds })
    await Promise.all(
      parsed.sources.feeds.map((url, index) => this.loadFeed(url, index, controller, generation)),
    )
    if (!this.current(controller, generation)) return

    const plugins: MarketplaceCatalogPlugin[] = []
    const seen = new Set<string>()
    for (const feed of this.snapshot.feeds) {
      const document = this.documents.get(feed.url)
      if (!document || feed.status !== 'ready') continue
      for (const entry of document.plugins) {
        const key = normalizeMarketplaceUrl(entry.manifest)
        if (key === null || seen.has(key)) continue
        seen.add(key)
        plugins.push({
          key,
          manifest: entry.manifest,
          feedUrl: feed.url,
          feedId: document.id,
          feedName: document.name,
          entry,
        })
      }
    }
    this.setSnapshot({ phase: 'ready', plugins })
  }

  private async loadFeed(
    url: string,
    index: number,
    controller: AbortController,
    generation: number,
  ): Promise<void> {
    const result = await this.fetchText(url, this.feedMaxBytes, controller, this.timeoutMs)
    if (!this.current(controller, generation)) return
    if (!result.ok || result.text === undefined) {
      this.updateFeed(index, { status: 'failed', issues: result.issues })
      return
    }
    const parsed = parseMarketplaceFeed(result.text)
    if (!parsed.ok) {
      this.updateFeed(index, { status: 'failed', issues: parsed.issues })
      return
    }
    this.documents.set(url, parsed.feed)
    this.updateFeed(index, {
      status: 'ready',
      id: parsed.feed.id,
      name: parsed.feed.name,
      pluginCount: parsed.feed.plugins.length,
      issues: [],
    })
  }

  private updateFeed(index: number, partial: Partial<MarketplaceFeedSnapshot>): void {
    this.setSnapshot({
      feeds: this.snapshot.feeds.map((feed, current) =>
        current === index ? { ...feed, ...partial } : feed,
      ),
    })
  }

  private async fetchText(
    url: string,
    maxBytes: number,
    runController: AbortController,
    timeoutMs: number,
  ): Promise<FetchTextResult> {
    const controller = new AbortController()
    this.controllers.add(controller)
    let timedOut = false
    const onRunAbort = () => controller.abort()
    runController.signal.addEventListener('abort', onRunAbort, { once: true })
    const timeout = (this.setTimeoutImpl ?? setTimeout)(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    try {
      const response = await (this.fetchImpl ?? fetch)(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-cache',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (runController.signal.aborted || this.disposed)
        return { ok: false, issues: [], aborted: true }
      if (!response.ok) {
        return { ok: false, issues: [failureIssue('http-status', undefined, response.status)] }
      }
      if (!jsonContentType(response.headers.get('content-type'))) {
        return {
          ok: false,
          issues: [failureIssue('invalid-json', 'The response is not JSON.')],
        }
      }
      const text = await readBoundedText(response, maxBytes)
      if (text === null) {
        return { ok: false, issues: [failureIssue('too-large')] }
      }
      return { ok: true, text, issues: [] }
    } catch {
      if (runController.signal.aborted || this.disposed)
        return { ok: false, issues: [], aborted: true }
      if (timedOut) return { ok: false, issues: [failureIssue('timeout')] }
      return { ok: false, issues: [requestFailure(url, this.sourceUrl)] }
    } finally {
      ;(this.clearTimeoutImpl ?? clearTimeout)(timeout)
      runController.signal.removeEventListener('abort', onRunAbort)
      this.controllers.delete(controller)
    }
  }

  private setSnapshot(partial: Partial<MarketplaceSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      sourceUrl: this.sourceUrl,
      revision: this.snapshot.revision + 1,
    }
    for (const listener of [...this.listeners]) listener()
  }
}

function jsonContentType(value: string | null): boolean {
  if (!value) return false
  return /^(?:application\/json|application\/[a-z0-9.+-]+\+json)\b/i.test(value.trim())
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) {
    const text = await response.text()
    return new TextEncoder().encode(text).byteLength > maxBytes ? null : text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
