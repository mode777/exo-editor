import type { WorkspaceChange, WorkspacePath } from '../workspace/contract'
import { payloadTooLarge } from './protocol'

export type ThemeName = 'dark' | 'light' | 'high-contrast'

export const EVENT_TOPICS = [
  'theme/changed',
  'workspace/file-changed',
  'workspace/closed',
  'config/changed',
  'view/active',
] as const

export type ShellEventTopic = (typeof EVENT_TOPICS)[number]
export type LocalEventTopic = `local/${string}`
export type EventTopic = ShellEventTopic | LocalEventTopic

export interface ThemeChangedPayload {
  theme: ThemeName
}

export interface FileChangedPayload {
  path: WorkspacePath
  kind: 'created' | 'changed' | 'deleted' | 'renamed'
  version?: string
}

export interface WorkspaceClosedPayload {
  reason: 'switch' | 'close'
}

export interface ConfigChangedPayload {
  pluginId: string
  values: Record<string, unknown>
}

export type ViewActivePayload =
  | { pluginId: string; active: false }
  | {
      pluginId: string
      active: true
      viewId: string
      instanceId: string
      instanceKey: string
    }

export interface EventPayloads {
  'theme/changed': ThemeChangedPayload
  'workspace/file-changed': FileChangedPayload
  'workspace/closed': WorkspaceClosedPayload
  'config/changed': ConfigChangedPayload
  'view/active': ViewActivePayload
}

export interface ShellEvent<T = unknown> {
  topic: EventTopic
  seq: number
  payload: T
  /** Opaque `exo-session` of the publishing frame; present on local events. */
  from?: string
}

export const MAX_TOPICS_PER_FRAME = 32
export const MAX_QUEUED_EVENTS = 1000
export const MAX_EVENT_BYTES = 1024 * 1024
export const MAX_EVENTS_PER_SECOND = 100
export const MAX_LOCAL_EVENTS_PER_SECOND = 200
export const EVENT_RATE_WINDOW_MS = 1000
export const LOCAL_TOPIC_PREFIX = 'local/'

const TOPIC_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/
const LOCAL_TOPIC_PATTERN = /^local\/[a-z0-9][a-z0-9._-]{0,63}$/

/** Shell topic names are lowercase `<namespace>/<event>` segments, at most 64 chars. */
export function validTopicSyntax(topic: string): boolean {
  return topic.length > 0 && topic.length <= 64 && TOPIC_PATTERN.test(topic)
}

export function isEventTopic(value: unknown): value is ShellEventTopic {
  return typeof value === 'string' && (EVENT_TOPICS as readonly string[]).includes(value)
}

/**
 * Plugin-local topics reserve `local/<name>`: the name is 1-64 characters of
 * lowercase letters, digits, dots, underscores or hyphens and starts with a
 * letter or digit.
 */
export function isLocalEventTopic(value: unknown): value is LocalEventTopic {
  return typeof value === 'string' && LOCAL_TOPIC_PATTERN.test(value)
}

export function isLocalTopicSyntax(topic: string): boolean {
  return isLocalEventTopic(topic)
}

function localSequenceKey(identity: string, topic: LocalEventTopic): string {
  return `${identity}\u0000${topic}`
}

export type SubscribeResult =
  { ok: true; seq: number } | { ok: false; code: 'unsupported-topic' | 'rate-limited' | 'internal' }

export type PublishLocalResult =
  | { ok: true; seq: number }
  | { ok: false; code: 'unsupported-topic' | 'too-large' | 'rate-limited' | 'internal' }

export interface EventSink {
  /** Post one `shell/event` to the frame. May throw; the bus contains it. */
  deliver(event: ShellEvent): void
  /** Report a dropped event without tearing the frame down. */
  onError?(topic: EventTopic, code: 'rate-limited'): void
  /** Stable label used when a failing subscriber is removed. */
  label?: string
  /** Plugin identity used by targeted topics such as `config/changed`. */
  identity?: string
}

export interface EventBusOptions {
  now?: () => number
  scheduleFlush?: (flush: () => void) => void
  onSubscriberRemoved?: (label: string, topic: string, code: string) => void
  onDropped?: (topic: string, code: 'rate-limited' | 'too-large') => void
}

/** One handler frame's subscription state; created by the bus. */
export class EventSubscriber {
  readonly topics = new Set<EventTopic>()
  readonly queues = new Map<EventTopic, ShellEvent[]>()
  readonly rateLimited = new Set<EventTopic>()
  failures = 0
  active = true
  scheduled = false

  constructor(
    readonly bus: EventBus,
    readonly sink: EventSink,
    readonly id: string,
  ) {}

  subscribe(topic: string): SubscribeResult {
    return this.bus.subscribe(this, topic)
  }

  unsubscribe(topic: string): void {
    this.bus.unsubscribe(this, topic)
  }

  close(): void {
    this.bus.removeSubscriber(this)
  }
}

interface RateWindow {
  start: number
  count: number
}

/**
 * Shell-to-plugin event bus. One instance belongs to one workspace session;
 * sequences, queues and subscriptions reset when the session is replaced.
 */
export class EventBus {
  private readonly subscribers = new Set<EventSubscriber>()
  private readonly sequences = new Map<ShellEventTopic, number>()
  private readonly localSequences = new Map<string, number>()
  private readonly rates = new Map<ShellEventTopic, RateWindow>()
  private readonly localRates = new Map<string, RateWindow>()
  private readonly localFrameRates = new Map<string, RateWindow>()
  private readonly now: () => number
  private readonly scheduleFlush: (flush: () => void) => void
  private readonly onSubscriberRemoved:
    ((label: string, topic: string, code: string) => void) | undefined
  private readonly onDropped:
    ((topic: string, code: 'rate-limited' | 'too-large') => void) | undefined
  private generation = 0
  private nextId = 1

  constructor(options: EventBusOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.scheduleFlush = options.scheduleFlush ?? ((flush) => queueMicrotask(flush))
    this.onSubscriberRemoved = options.onSubscriberRemoved
    this.onDropped = options.onDropped
  }

  createSubscriber(sink: EventSink): EventSubscriber {
    const subscriber = new EventSubscriber(this, sink, `events-${this.nextId++}`)
    this.subscribers.add(subscriber)
    return subscriber
  }

  subscribe(subscriber: EventSubscriber, topic: string): SubscribeResult {
    if (!subscriber.active) return { ok: false, code: 'internal' }
    const local = isLocalEventTopic(topic)
    if (!local && !isEventTopic(topic)) return { ok: false, code: 'unsupported-topic' }
    if (local && !subscriber.sink.identity) return { ok: false, code: 'unsupported-topic' }
    if (subscriber.topics.has(topic)) {
      return { ok: true, seq: this.sequenceFor(subscriber, topic) }
    }
    if (subscriber.topics.size >= MAX_TOPICS_PER_FRAME) {
      return { ok: false, code: 'rate-limited' }
    }
    subscriber.topics.add(topic)
    subscriber.queues.set(topic, [])
    return { ok: true, seq: this.sequenceFor(subscriber, topic) }
  }

  unsubscribe(subscriber: EventSubscriber, topic: string): void {
    if (!isEventTopic(topic) && !isLocalEventTopic(topic)) return
    subscriber.topics.delete(topic)
    subscriber.queues.delete(topic)
    subscriber.rateLimited.delete(topic)
  }

  removeSubscriber(subscriber: EventSubscriber): void {
    if (!subscriber.active) return
    subscriber.active = false
    subscriber.topics.clear()
    subscriber.queues.clear()
    subscriber.rateLimited.clear()
    this.localFrameRates.delete(subscriber.id)
    this.subscribers.delete(subscriber)
  }

  sequence(topic: ShellEventTopic): number {
    return this.sequences.get(topic) ?? 0
  }

  /** Current local sequence for one plugin identity and topic. */
  localSequence(identity: string, topic: LocalEventTopic): number {
    return this.localSequences.get(localSequenceKey(identity, topic)) ?? 0
  }

  private sequenceFor(subscriber: EventSubscriber, topic: EventTopic): number {
    if (isLocalEventTopic(topic)) {
      const identity = subscriber.sink.identity
      return identity ? this.localSequence(identity, topic) : 0
    }
    return this.sequence(topic)
  }

  publish(
    topic: ShellEventTopic,
    payload: unknown,
    options: { burst?: boolean; target?: string } = {},
  ): boolean {
    if (!isEventTopic(topic)) return false
    if (payloadTooLarge(payload, MAX_EVENT_BYTES)) {
      this.onDropped?.(topic, 'too-large')
      return false
    }
    if (!options.burst && !this.allowRate(this.rates, topic, MAX_EVENTS_PER_SECOND)) {
      this.onDropped?.(topic, 'rate-limited')
      return false
    }

    const seq = (this.sequences.get(topic) ?? 0) + 1
    this.sequences.set(topic, seq)
    if (this.subscribers.size === 0) return true

    const event: ShellEvent = { topic, seq, payload }
    for (const subscriber of [...this.subscribers]) {
      if (!subscriber.active || !subscriber.topics.has(topic)) continue
      if (options.target !== undefined && subscriber.sink.identity !== options.target) continue
      this.enqueue(subscriber, event)
    }
    return true
  }

  /**
   * Publish one plugin-local event. Delivery is limited to subscribers of the
   * publisher's identity; `from` is the shell-known frame session id. The
   * payload is opaque to the shell and only size and rate are enforced.
   */
  publishLocal(
    publisher: EventSubscriber,
    topic: string,
    payload: unknown,
    options: { from: string },
  ): PublishLocalResult {
    if (!publisher.active) return { ok: false, code: 'internal' }
    if (!isLocalEventTopic(topic)) return { ok: false, code: 'unsupported-topic' }
    const identity = publisher.sink.identity
    if (!identity) return { ok: false, code: 'internal' }
    if (payloadTooLarge(payload, MAX_EVENT_BYTES)) {
      this.onDropped?.(topic, 'too-large')
      return { ok: false, code: 'too-large' }
    }
    if (!this.allowRate(this.localFrameRates, publisher.id, MAX_LOCAL_EVENTS_PER_SECOND)) {
      this.onDropped?.(topic, 'rate-limited')
      return { ok: false, code: 'rate-limited' }
    }
    const key = localSequenceKey(identity, topic)
    if (!this.allowRate(this.localRates, key, MAX_EVENTS_PER_SECOND)) {
      this.onDropped?.(topic, 'rate-limited')
      return { ok: false, code: 'rate-limited' }
    }

    const seq = (this.localSequences.get(key) ?? 0) + 1
    this.localSequences.set(key, seq)
    const event: ShellEvent = { topic, seq, payload, from: options.from }
    for (const subscriber of [...this.subscribers]) {
      if (!subscriber.active) continue
      if (subscriber.sink.identity !== identity) continue
      if (!subscriber.topics.has(topic)) continue
      this.enqueue(subscriber, event)
    }
    return { ok: true, seq }
  }

  /** Deliver synchronously, bypassing the queue; used for `workspace/closed`. */
  publishImmediate(topic: ShellEventTopic, payload: unknown): boolean {
    if (!isEventTopic(topic)) return false
    if (payloadTooLarge(payload, MAX_EVENT_BYTES)) {
      this.onDropped?.(topic, 'too-large')
      return false
    }
    const seq = (this.sequences.get(topic) ?? 0) + 1
    this.sequences.set(topic, seq)
    const event: ShellEvent = { topic, seq, payload }
    for (const subscriber of [...this.subscribers]) {
      if (!subscriber.active || !subscriber.topics.has(topic)) continue
      this.deliver(subscriber, event)
    }
    return true
  }

  /** Flush every pending queue synchronously. */
  flush(): void {
    for (const subscriber of [...this.subscribers]) {
      subscriber.scheduled = false
      this.flushSubscriber(subscriber)
    }
  }

  reset(): void {
    this.generation += 1
    for (const subscriber of this.subscribers) {
      subscriber.active = false
      subscriber.topics.clear()
      subscriber.queues.clear()
      subscriber.rateLimited.clear()
      subscriber.failures = 0
    }
    this.subscribers.clear()
    this.sequences.clear()
    this.localSequences.clear()
    this.rates.clear()
    this.localRates.clear()
    this.localFrameRates.clear()
  }

  private enqueue(subscriber: EventSubscriber, event: ShellEvent): void {
    let queue = subscriber.queues.get(event.topic)
    if (!queue) {
      queue = []
      subscriber.queues.set(event.topic, queue)
    }
    queue.push(event)
    if (queue.length > MAX_QUEUED_EVENTS) {
      queue.shift()
      if (!subscriber.rateLimited.has(event.topic)) {
        subscriber.rateLimited.add(event.topic)
        this.report(subscriber, event.topic)
      }
    }
    this.schedule(subscriber)
  }

  private allowRate<K>(rates: Map<K, RateWindow>, key: K, limit: number): boolean {
    const now = this.now()
    let window = rates.get(key)
    if (!window || now - window.start >= EVENT_RATE_WINDOW_MS) {
      window = { start: now, count: 0 }
      rates.set(key, window)
    }
    if (window.count >= limit) return false
    window.count += 1
    return true
  }

  private schedule(subscriber: EventSubscriber): void {
    if (subscriber.scheduled) return
    subscriber.scheduled = true
    const generation = this.generation
    this.scheduleFlush(() => {
      if (generation !== this.generation || !subscriber.active) {
        subscriber.scheduled = false
        return
      }
      subscriber.scheduled = false
      this.flushSubscriber(subscriber)
    })
  }

  private flushSubscriber(subscriber: EventSubscriber): void {
    if (!subscriber.active) return
    let drained = true
    for (const [topic, queue] of subscriber.queues) {
      while (queue.length > 0) {
        const event = queue.shift() as ShellEvent
        if (!this.deliver(subscriber, event)) {
          drained = false
          break
        }
      }
      if (!subscriber.active) return
      if (drained && queue.length === 0) subscriber.rateLimited.delete(topic)
    }
  }

  private deliver(subscriber: EventSubscriber, event: ShellEvent): boolean {
    try {
      subscriber.sink.deliver(event)
      return true
    } catch {
      subscriber.failures += 1
      if (subscriber.failures >= 3) {
        this.onSubscriberRemoved?.(subscriber.sink.label ?? subscriber.id, event.topic, 'internal')
        this.removeSubscriber(subscriber)
      }
      return false
    }
  }

  private report(subscriber: EventSubscriber, topic: EventTopic): void {
    try {
      subscriber.sink.onError?.(topic, 'rate-limited')
    } catch {
      // An error report must not break publication either.
    }
  }
}

/**
 * Filesystem change payloads use one shape for the targeted protocol message
 * and the topic event, so the two forms cannot drift.
 */
export function fileChangedPayload(change: WorkspaceChange): FileChangedPayload {
  if (change.kind === 'deleted') return { path: change.path, kind: 'deleted' }
  return { path: change.path, kind: change.kind, version: change.stat.version }
}

/** Suppresses a watcher/poll report of the shell's own recent write. */
export class SelfWriteEcho {
  private readonly writes = new Map<WorkspacePath, { version: string; at: number }>()

  constructor(
    private readonly now: () => number,
    private readonly windowMs = 1000,
  ) {}

  record(path: WorkspacePath, version: string): void {
    this.writes.set(path, { version, at: this.now() })
  }

  isEcho(change: WorkspaceChange): boolean {
    if (change.kind === 'deleted') return false
    const entry = this.writes.get(change.path)
    if (!entry) return false
    this.writes.delete(change.path)
    return entry.version === change.stat.version && this.now() - entry.at <= this.windowMs
  }

  reset(): void {
    this.writes.clear()
  }
}

export interface FileChangeCoalescerOptions {
  publish: (payload: FileChangedPayload) => void
  windowMs?: number
  setTimeoutImpl?: typeof setTimeout
  clearTimeoutImpl?: typeof clearTimeout
}

interface PendingChange {
  payload: FileChangedPayload
  timer: ReturnType<typeof setTimeout>
}

const KIND_PRIORITY: Record<FileChangedPayload['kind'], number> = {
  changed: 0,
  created: 1,
  renamed: 2,
  deleted: 3,
}

export function mergeFileChange(
  current: FileChangedPayload,
  next: FileChangedPayload,
): FileChangedPayload {
  if (KIND_PRIORITY[next.kind] >= KIND_PRIORITY[current.kind]) {
    return { ...next, path: next.path }
  }
  return { ...current, path: current.path }
}

/**
 * Coalesces changes to one path inside a fixed window. A rename supersedes any
 * pending window for the old path and is reported once on the new path.
 */
export class FileChangeCoalescer {
  private readonly pending = new Map<WorkspacePath, PendingChange>()
  private readonly publish: (payload: FileChangedPayload) => void
  private readonly windowMs: number
  private readonly setTimeoutImpl: typeof setTimeout
  private readonly clearTimeoutImpl: typeof clearTimeout

  constructor(options: FileChangeCoalescerOptions) {
    this.publish = options.publish
    this.windowMs = options.windowMs ?? 50
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? (setTimeout.bind(globalThis) as typeof setTimeout)
    this.clearTimeoutImpl =
      options.clearTimeoutImpl ?? (clearTimeout.bind(globalThis) as typeof clearTimeout)
  }

  push(change: WorkspaceChange): void {
    if (change.kind === 'renamed') this.drop(change.previousPath)
    const payload = fileChangedPayload(change)
    const existing = this.pending.get(change.path)
    if (existing) {
      existing.payload = mergeFileChange(existing.payload, payload)
      return
    }
    const timer = this.setTimeoutImpl(() => {
      const pending = this.pending.get(change.path)
      if (!pending || pending.timer !== timer) return
      this.pending.delete(change.path)
      this.publish(pending.payload)
    }, this.windowMs)
    this.pending.set(change.path, { payload, timer })
  }

  reset(): void {
    for (const pending of this.pending.values()) this.clearTimeoutImpl(pending.timer)
    this.pending.clear()
  }

  get size(): number {
    return this.pending.size
  }

  private drop(path: WorkspacePath): void {
    const pending = this.pending.get(path)
    if (!pending) return
    this.clearTimeoutImpl(pending.timer)
    this.pending.delete(path)
  }
}
