/**
 * Deterministic in-memory Stratofold server for tests.
 *
 * It implements only what the shell's adapter and the published client use:
 * token scope, one-level listings, stat, files, upload, mkdir, move, remove.
 * Tests therefore run the real client against a controllable backend instead of
 * mocking the adapter's own helpers.
 *
 * Paths are vdir-relative without a leading slash (`""` is the root), matching
 * the Stratofold filesystem API.
 */
import type { FetchLike } from '@stratofold/client'

export type FakeRole = 'viewer' | 'editor'

export interface FakeToken {
  token: string
  role: FakeRole
  name: string
  expiresAt?: string | null
}

export interface FakeServerOptions {
  baseUrl?: string
  vdir?: string
  vdirName?: string
  /** One editor token by default. Pass `tokens: []` with `publicRead` for a public vdir. */
  tokens?: FakeToken[]
  publicRead?: boolean
  now?: () => number
  initialFiles?: Record<string, string>
  initialDirectories?: string[]
}

interface FakeNode {
  kind: 'file' | 'directory'
  content: Uint8Array
  mtime: number
  generation: number
}

export interface RecordedRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

interface AuthSuccess {
  ok: true
  role: FakeRole
  name: string
  expiresAt?: string | null
}

interface AuthFailure {
  ok: false
  status: number
  message: string
}

export const FAKE_TOKEN = 'sf_v1_test_token'
export const FAKE_VDIR = 'vdir-1'
export const FAKE_BASE_URL = 'https://files.test'

const encoder = new TextEncoder()

function splitPath(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0)
}

function parentPath(path: string): string {
  const segments = splitPath(path)
  segments.pop()
  return segments.join('/')
}

function baseName(path: string): string {
  const segments = splitPath(path)
  return segments[segments.length - 1] ?? ''
}

function joinPath(base: string, name: string): string {
  return base === '' ? name : `${base}/${name}`
}

export class FakeStratofoldServer {
  readonly baseUrl: string
  readonly vdir: string
  readonly vdirName: string
  readonly requests: RecordedRequest[] = []
  /** Called when a request is rejected as unauthorized or forbidden. */
  onAuthFailure: ((status: number) => void) | null = null

  private readonly tokens = new Map<string, FakeToken>()
  private readonly nodes = new Map<string, FakeNode>()
  private readonly publicRead: boolean
  private readonly now: () => number
  private nextFault: number | 'network' | null = null
  private generation = 0

  constructor(options: FakeServerOptions = {}) {
    this.baseUrl = options.baseUrl ?? FAKE_BASE_URL
    this.vdir = options.vdir ?? FAKE_VDIR
    this.vdirName = options.vdirName ?? 'demo'
    this.publicRead = options.publicRead ?? false
    this.now = options.now ?? (() => 1_700_000_000_000)

    const tokens = options.tokens ?? [{ token: FAKE_TOKEN, role: 'editor', name: 'Exo' }]
    for (const token of tokens) this.tokens.set(token.token, token)

    this.nodes.set('', {
      kind: 'directory',
      content: new Uint8Array(),
      mtime: this.now(),
      generation: 0,
    })
    for (const directory of options.initialDirectories ?? []) this.seedDirectory(directory)
    for (const [path, text] of Object.entries(options.initialFiles ?? {})) {
      this.seedFile(path, text)
    }
  }

  /** Fail the next request with an HTTP status or a transport error. */
  failNext(status: number | 'network'): void {
    this.nextFault = status
  }

  seedFile(path: string, text: string): void {
    this.writeNode(path, encoder.encode(text))
  }

  seedDirectory(path: string): void {
    this.ensureDirectory(path)
  }

  readText(path: string): string {
    const node = this.nodes.get(path)
    if (!node || node.kind !== 'file') throw new Error(`No file at ${path}`)
    return new TextDecoder().decode(node.content)
  }

  versionOf(path: string): string {
    return this.contentVersion(path)
  }

  /** `fetch` seam for `new StratofoldClient({ fetch: server.fetch })`. */
  fetch: FetchLike = async (input, init) => {
    const request = this.record(input, init)
    const fault = this.nextFault
    this.nextFault = null
    if (fault === 'network') throw new TypeError('Failed to fetch')
    if (typeof fault === 'number') return this.errorResponse(fault)
    return this.route(request)
  }

  /** `createXhr` seam: uploads go through XMLHttpRequest in the client. */
  createXhr = (): XMLHttpRequest => new FakeUploadXhr(this) as unknown as XMLHttpRequest

  /** Called by the fake XHR with the parsed upload request. */
  handleUpload(request: RecordedRequest, body: ArrayBuffer): { status: number; body: string } {
    const path = requestedPath(request)
    const auth = this.authorize(request)
    if (!auth.ok) {
      return { status: auth.status, body: JSON.stringify({ message: auth.message }) }
    }
    if (auth.role !== 'editor') {
      return { status: 403, body: JSON.stringify({ message: 'forbidden' }) }
    }
    if (!this.isDirectory(parentPath(path))) {
      return { status: 404, body: JSON.stringify({ message: 'parent not found' }) }
    }
    const existing = this.nodes.get(path)
    if (existing?.kind === 'directory') {
      return { status: 400, body: JSON.stringify({ message: 'target is a directory' }) }
    }
    const ifMatch = request.headers['if-match']
    if (ifMatch !== undefined) {
      if (ifMatch === '*') {
        if (!existing) return { status: 412, body: JSON.stringify({ message: 'target missing' }) }
      } else {
        const expected = ifMatch.replace(/^"|"$/g, '')
        const current = existing ? this.contentVersion(path) : ''
        if (current !== expected) {
          return {
            status: 412,
            body: JSON.stringify({ message: 'version mismatch', version: current }),
          }
        }
      }
    }
    const bytes = new Uint8Array(body.slice(0))
    this.writeNode(path, bytes)
    return { status: 200, body: JSON.stringify({ path, size: bytes.byteLength }) }
  }

  /** Records an upload request so tests can inspect its URL and headers. */
  recordUpload(request: RecordedRequest): void {
    this.requests.push(request)
  }

  private record(input: string, init?: RequestInit): RecordedRequest {
    const url = typeof input === 'string' ? input : String(input)
    const headers: Record<string, string> = {}
    const raw = init?.headers
    if (raw instanceof Headers) {
      raw.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
    } else if (Array.isArray(raw)) {
      for (const [key, value] of raw) headers[key.toLowerCase()] = String(value)
    } else if (raw) {
      for (const [key, value] of Object.entries(raw)) headers[key.toLowerCase()] = String(value)
    }
    const request: RecordedRequest = {
      method: init?.method ?? 'GET',
      url,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    }
    this.requests.push(request)
    return request
  }

  private route(request: RecordedRequest): Response {
    const url = new URL(request.url)
    if (url.pathname === '/api/sf/tokens/me') {
      const auth = this.authorize(request)
      if (!auth.ok) return this.errorResponse(auth.status)
      return this.json({
        id: 'token-1',
        name: auth.name,
        vdir: { id: this.vdir, name: this.vdirName },
        role: auth.role,
        expires_at: auth.expiresAt ?? null,
        last_used_at: null,
        token_hint: '…test',
      })
    }

    const api = url.pathname.match(/^\/api\/sf\/vdirs\/([^/]+)\/([a-z]+)$/)
    if (api) {
      if (decodeURIComponent(api[1]) !== this.vdir) return this.errorResponse(404)
      const operation = api[2]
      const body = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {}
      const path = typeof body.path === 'string' ? body.path : ''
      const auth = this.authorize(request)
      if (!auth.ok) return this.errorResponse(auth.status)

      if (operation === 'ls') {
        const entries = this.listEntries(path)
        if (!entries) return this.errorResponse(404)
        return this.json({ entries })
      }
      if (operation === 'stat') {
        const entry = path === '' ? this.rootEntry() : this.tryStatEntry(path)
        if (!entry) return this.errorResponse(404)
        return this.json(entry)
      }
      if (auth.role !== 'editor') return this.errorResponse(403)
      if (operation === 'mkdir') {
        this.ensureDirectory(path)
        return this.json({ ok: true })
      }
      if (operation === 'mv') {
        const to = typeof body.to === 'string' ? body.to : ''
        if (!this.nodes.has(path)) return this.errorResponse(404)
        this.moveNode(path, to)
        return this.json({ ok: true })
      }
      if (operation === 'rm') {
        this.removeNode(path)
        return this.json({ ok: true })
      }
      return this.errorResponse(404)
    }

    const file = url.pathname.match(/^\/files\/([^/]+)(\/.*)?$/)
    if (file) {
      if (decodeURIComponent(file[1]) !== this.vdir) return this.errorResponse(404)
      const auth = this.authorize(request)
      if (!auth.ok) return this.errorResponse(auth.status)
      let path = (file[2] ?? '')
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => decodeURIComponent(segment))
        .join('/')
      let node = this.nodes.get(path)
      if (node?.kind === 'directory') {
        path = joinPath(path, 'index.html')
        node = this.nodes.get(path)
      }
      if (!node || node.kind !== 'file') return this.errorResponse(404)
      const bytes = node.content.slice()
      return new Response(bytes.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': String(bytes.byteLength),
          ETag: `"${this.contentVersion(path)}"`,
        },
      })
    }

    return this.errorResponse(404)
  }

  private authorize(request: RecordedRequest): AuthSuccess | AuthFailure {
    const header = request.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? this.tokens.get(header.slice(7)) : undefined
    if (token) {
      if (token.expiresAt && Date.parse(token.expiresAt) <= this.now()) {
        return { ok: false, status: 401, message: 'token expired' }
      }
      return { ok: true, role: token.role, name: token.name, expiresAt: token.expiresAt }
    }
    if (this.publicRead && !header) return { ok: true, role: 'viewer', name: 'public' }
    return { ok: false, status: 401, message: 'unauthorized' }
  }

  private errorResponse(status: number, version?: string): Response {
    if (status === 401 || status === 403) this.onAuthFailure?.(status)
    const message = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'not found'
    return this.json({ message, version }, status)
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private listEntries(path: string) {
    if (!this.isDirectory(path)) return null
    return this.children(path)
      .map((name) => {
        const childPath = joinPath(path, name)
        const node = this.nodes.get(childPath)
        if (!node) return null
        return {
          name,
          size: node.kind === 'file' ? node.content.byteLength : 0,
          dir: node.kind === 'directory',
          modtime: new Date(node.mtime).toISOString(),
          version: this.contentVersion(childPath),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private rootEntry() {
    return {
      path: '',
      name: this.vdirName,
      kind: 'directory' as const,
      size: 0,
      mtime: new Date(this.now()).toISOString(),
      version: 'directory',
    }
  }

  private tryStatEntry(path: string) {
    if (!this.nodes.has(path)) return null
    return this.statEntry(path)
  }

  private statEntry(path: string) {
    const node = this.nodes.get(path)
    if (!node) throw new Error(`No node at ${path}`)
    return {
      path,
      name: path === '' ? this.vdirName : baseName(path),
      kind: node.kind,
      size: node.kind === 'file' ? node.content.byteLength : 0,
      mtime: new Date(node.mtime).toISOString(),
      version: this.contentVersion(path),
    }
  }

  private contentVersion(path: string): string {
    if (path === '') return 'directory'
    const node = this.nodes.get(path)
    if (!node) throw new Error(`No node at ${path}`)
    if (node.kind === 'directory') return 'directory'
    return `${node.content.byteLength}:${Math.floor(node.mtime / 1000)}:${node.generation}`
  }

  private children(path: string): string[] {
    const prefix = path === '' ? '' : `${path}/`
    const names = new Set<string>()
    for (const key of this.nodes.keys()) {
      if (key === '' || !key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.length === 0) continue
      names.add(rest.split('/')[0])
    }
    return [...names]
  }

  private isDirectory(path: string): boolean {
    return this.nodes.get(path)?.kind === 'directory'
  }

  private ensureDirectory(path: string): void {
    const segments = splitPath(path)
    let current = ''
    for (const segment of segments) {
      current = joinPath(current, segment)
      const node = this.nodes.get(current)
      if (node && node.kind !== 'directory') this.nodes.delete(current)
      if (!this.nodes.has(current)) {
        this.nodes.set(current, {
          kind: 'directory',
          content: new Uint8Array(),
          mtime: this.now(),
          generation: 0,
        })
      }
    }
  }

  private writeNode(path: string, bytes: Uint8Array): void {
    const parent = parentPath(path)
    if (parent !== '' && !this.isDirectory(parent)) this.ensureDirectory(parent)
    this.generation += 1
    this.nodes.set(path, {
      kind: 'file',
      content: bytes,
      mtime: this.now(),
      generation: this.generation,
    })
  }

  private moveNode(from: string, to: string): void {
    const node = this.nodes.get(from)
    if (!node) return
    const parent = parentPath(to)
    if (parent !== '' && !this.isDirectory(parent)) this.ensureDirectory(parent)
    this.generation += 1
    this.nodes.set(to, { ...node, generation: this.generation, mtime: this.now() })
    if (node.kind === 'directory') {
      for (const key of [...this.nodes.keys()]) {
        if (key.startsWith(`${from}/`)) this.nodes.delete(key)
      }
    }
    this.nodes.delete(from)
  }

  private removeNode(path: string): void {
    if (path === '') return
    this.nodes.delete(path)
    for (const key of [...this.nodes.keys()]) {
      if (key.startsWith(`${path}/`)) this.nodes.delete(key)
    }
  }
}

function requestedPath(request: RecordedRequest): string {
  const url = new URL(request.url)
  return url.searchParams.get('path') ?? ''
}

/**
 * Minimal XMLHttpRequest used only by the client's upload transport. It shares
 * the server's state so uploads behave like the other operations.
 */
class FakeUploadXhr {
  upload: {
    onprogress:
      ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null
  } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  statusText = ''
  responseText = ''
  withCredentials = false

  private readonly server: FakeStratofoldServer
  private method = 'GET'
  private url = ''
  private readonly headers: Record<string, string> = {}
  private aborted = false

  constructor(server: FakeStratofoldServer) {
    this.server = server
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string): void {
    this.headers[key.toLowerCase()] = value
  }

  abort(): void {
    this.aborted = true
    queueMicrotask(() => {
      this.status = 0
      this.statusText = 'aborted'
      this.onabort?.()
    })
  }

  send(body: XMLHttpRequestBodyInit | null): void {
    const buffer = toArrayBuffer(body)
    const request: RecordedRequest = {
      method: this.method,
      url: this.url,
      headers: { ...this.headers },
    }
    this.server.recordUpload(request)
    setTimeout(() => {
      if (this.aborted) return
      const result = this.server.handleUpload(request, buffer)
      this.status = result.status
      this.statusText = result.status >= 200 && result.status < 300 ? 'OK' : 'Error'
      this.responseText = result.body
      this.onload?.()
    }, 0)
  }
}

function toArrayBuffer(body: XMLHttpRequestBodyInit | null): ArrayBuffer {
  if (body === null) return new ArrayBuffer(0)
  // Cross-realm-safe: jsdom's ArrayBuffer is not the TextEncoder realm's.
  if (Object.prototype.toString.call(body) === '[object ArrayBuffer]') return body as ArrayBuffer
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
  }
  if (typeof body === 'string') return encoder.encode(body).buffer as ArrayBuffer
  throw new Error('The fake server only accepts ArrayBuffer, typed-array or string bodies.')
}
