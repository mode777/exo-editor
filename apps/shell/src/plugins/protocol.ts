import type { FrameHandle, FrameSandbox } from './frame'

/**
 * Shared protocol plumbing for both frame lifetimes: registration controllers
 * and per-document handlers. Keeping the envelope, size, origin and violation
 * rules in one place stops the two state machines from drifting on the parts
 * that are security-relevant.
 */

export const PROTOCOL_VERSION = '1'
export const READY_TIMEOUT_MS = 10_000
export const REGISTRATION_TIMEOUT_MS = 10_000
export const ACK_CLOSE_DELAY_MS = 250
export const SAVE_TIMEOUT_MS = 5_000
export const DISPOSE_TIMEOUT_MS = 1_000
export const MAX_PROTOCOL_VIOLATIONS = 3
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024
export const MAX_HANDLER_FRAMES = 20
export const MAX_IN_FLIGHT_REQUESTS = 64
export const MAX_FRAME_ID_LENGTH = 64

export type ShellErrorCode =
  | 'unsupported-message'
  | 'unsupported-version'
  | 'protocol-violation'
  | 'timeout'
  | 'loading-failed'
  | 'permission-denied'
  | 'not-found'
  | 'not-a-file'
  | 'too-large'
  | 'conflict'
  | 'rate-limited'
  | 'internal'

export interface Envelope {
  exo: 1
  type: string
  id?: string
  replyTo?: string
  payload?: unknown
}

export type FrameMode = 'register' | 'editor'

export interface FrameBoundary {
  /** A same-origin frame is sandboxed to an opaque origin. */
  opaque: boolean
  sandbox: FrameSandbox
  /** `*` only for an opaque frame, which has no nameable origin. */
  targetOrigin: string
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function frameBoundary(manifestOrigin: string, shellOrigin: string): FrameBoundary {
  const opaque = manifestOrigin === shellOrigin
  return {
    opaque,
    sandbox: opaque ? 'allow-scripts' : 'allow-scripts allow-same-origin',
    targetOrigin: opaque ? '*' : manifestOrigin,
  }
}

export function buildFrameUrl(
  entryUrl: string,
  shellOrigin: string,
  mode: FrameMode,
  sessionId: string,
): string {
  const url = new URL(entryUrl)
  const params = new URLSearchParams()
  params.set('exo-host', shellOrigin)
  params.set('exo-mode', mode)
  params.set('exo-session', sessionId)
  url.hash = params.toString()
  return url.href
}

export function defaultSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `exo-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function parseEnvelope(data: unknown): Envelope | null {
  if (!isPlainObject(data) || data.exo !== 1) return null
  if (typeof data.type !== 'string' || data.type.length === 0) return null
  if (
    data.id !== undefined &&
    (typeof data.id !== 'string' || data.id.length > MAX_FRAME_ID_LENGTH)
  ) {
    return null
  }
  if (
    data.replyTo !== undefined &&
    (typeof data.replyTo !== 'string' || data.replyTo.length > MAX_FRAME_ID_LENGTH)
  ) {
    return null
  }
  return data as unknown as Envelope
}

function sizeOf(value: unknown, limit: number, seen: Set<object>): number {
  if (typeof value === 'string') return value.length * 2
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 8
  if (value === null || value === undefined) return 0
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value) {
      total += sizeOf(item, limit - total, seen)
      if (total > limit) return total
    }
    return total
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return 0
    seen.add(value)
    let total = 0
    for (const [key, item] of Object.entries(value)) {
      total += key.length * 2 + sizeOf(item, limit - total, seen)
      if (total > limit) return total
    }
    return total
  }
  return 0
}

export function payloadTooLarge(payload: unknown): boolean {
  return sizeOf(payload, MAX_MESSAGE_BYTES, new Set()) > MAX_MESSAGE_BYTES
}

export function postEnvelope(
  frame: FrameHandle | null,
  targetOrigin: string,
  type: string,
  payload?: unknown,
  replyTo?: string,
): void {
  if (!frame?.window) return
  const envelope: Envelope = { exo: 1, type }
  if (replyTo !== undefined) envelope.replyTo = replyTo
  if (payload !== undefined) envelope.payload = payload
  frame.window.postMessage(envelope, targetOrigin)
}

/** A shell-initiated request: carries an `id` the plugin must answer. */
export function postRequest(
  frame: FrameHandle | null,
  targetOrigin: string,
  type: string,
  id: string,
  payload?: unknown,
): void {
  if (!frame?.window) return
  const envelope: Envelope = { exo: 1, type, id }
  if (payload !== undefined) envelope.payload = payload
  frame.window.postMessage(envelope, targetOrigin)
}

export function sendShellError(
  frame: FrameHandle | null,
  targetOrigin: string,
  code: ShellErrorCode,
  replyTo?: string,
  message?: string,
): void {
  postEnvelope(
    frame,
    targetOrigin,
    'shell/error',
    { code, ...(message ? { message } : {}) },
    replyTo,
  )
}

/**
 * Counts protocol violations for one frame and invokes the teardown callback
 * when the budget is spent. Callers still decide whether to reply first.
 */
export class ViolationBudget {
  private used = 0

  constructor(
    private readonly onExceeded: () => void,
    private readonly limit = MAX_PROTOCOL_VIOLATIONS,
  ) {}

  record(): void {
    this.used += 1
    if (this.used >= this.limit) this.onExceeded()
  }

  get count(): number {
    return this.used
  }
}
