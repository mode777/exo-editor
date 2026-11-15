import { describe, expect, it } from 'vitest'
import type { WorkspaceChange } from '../workspace/contract'
import {
  EVENT_TOPICS,
  EventBus,
  FileChangeCoalescer,
  MAX_EVENTS_PER_SECOND,
  MAX_QUEUED_EVENTS,
  MAX_TOPICS_PER_FRAME,
  SelfWriteEcho,
  fileChangedPayload,
  isEventTopic,
  mergeFileChange,
  validTopicSyntax,
  type EventSink,
  type EventTopic,
  type ShellEvent,
} from './events'

function collector(label = 'test') {
  const events: ShellEvent[] = []
  const errors: Array<{ topic: string; code: string }> = []
  const sink: EventSink = {
    label,
    deliver: (event) => events.push(event),
    onError: (topic, code) => errors.push({ topic, code }),
  }
  return { events, errors, sink }
}

function harness(now: () => number = () => 0) {
  const scheduled: Array<() => void> = []
  const removed: Array<{ label: string; topic: string; code: string }> = []
  const dropped: Array<{ topic: string; code: string }> = []
  const bus = new EventBus({
    now,
    scheduleFlush: (flush) => scheduled.push(flush),
    onSubscriberRemoved: (label, topic, code) => removed.push({ label, topic, code }),
    onDropped: (topic, code) => dropped.push({ topic, code }),
  })
  const flush = () => {
    while (scheduled.length > 0) scheduled.shift()?.()
  }
  return { bus, flush, removed, dropped }
}

function change(
  path: string,
  kind: 'created' | 'changed' | 'deleted',
  version = 'v1',
): WorkspaceChange {
  if (kind === 'deleted') return { kind, path }
  return {
    kind,
    path,
    stat: { path, kind: 'file', size: 1, mtime: 1, version },
  }
}

describe('topic names', () => {
  it('accepts the v1 catalog and well-formed names', () => {
    for (const topic of EVENT_TOPICS) {
      expect(validTopicSyntax(topic)).toBe(true)
      expect(isEventTopic(topic)).toBe(true)
    }
    expect(validTopicSyntax('workspace/build-started')).toBe(true)
  })

  it('rejects malformed names', () => {
    expect(validTopicSyntax('Theme/changed')).toBe(false)
    expect(validTopicSyntax('theme/*')).toBe(false)
    expect(validTopicSyntax('theme/changed/extra')).toBe(false)
    expect(validTopicSyntax('theme/')).toBe(false)
    expect(validTopicSyntax('/changed')).toBe(false)
    expect(validTopicSyntax('theme/changed ')).toBe(false)
    expect(validTopicSyntax(`a/${'b'.repeat(64)}`)).toBe(false)
    expect(isEventTopic('workspace/build-started')).toBe(false)
  })
})

describe('subscriptions', () => {
  it('is idempotent and reports the current sequence', () => {
    const { bus, flush } = harness()
    const { sink, events } = collector()
    const subscriber = bus.createSubscriber(sink)

    bus.publish('theme/changed', { theme: 'dark' })
    bus.publish('theme/changed', { theme: 'light' })
    flush()

    const first = subscriber.subscribe('theme/changed')
    expect(first).toEqual({ ok: true, seq: 2 })
    expect(subscriber.subscribe('theme/changed')).toEqual(first)
    expect(events).toHaveLength(0)

    bus.publish('theme/changed', { theme: 'high-contrast' })
    flush()
    expect(events.map((event) => event.seq)).toEqual([3])
  })

  it('unsubscribes one topic without affecting another subscriber', () => {
    const { bus, flush } = harness()
    const first = collector('first')
    const second = collector('second')
    const a = bus.createSubscriber(first.sink)
    const b = bus.createSubscriber(second.sink)
    a.subscribe('theme/changed')
    b.subscribe('theme/changed')

    a.unsubscribe('theme/changed')
    bus.publish('theme/changed', { theme: 'light' })
    flush()

    expect(first.events).toHaveLength(0)
    expect(second.events).toHaveLength(1)
  })

  it('rejects a subscription beyond the 32-topic cap', () => {
    const { bus } = harness()
    const subscriber = bus.createSubscriber(collector().sink)
    for (let index = 0; index < MAX_TOPICS_PER_FRAME; index += 1) {
      subscriber.topics.add(`fake/topic-${index}` as EventTopic)
    }
    expect(subscriber.subscribe('workspace/file-changed')).toEqual({
      ok: false,
      code: 'rate-limited',
    })
    expect(subscriber.topics.size).toBe(MAX_TOPICS_PER_FRAME)
  })

  it('reports unknown topics without wildcard matching', () => {
    const { bus } = harness()
    const subscriber = bus.createSubscriber(collector().sink)
    expect(subscriber.subscribe('workspace/*')).toEqual({
      ok: false,
      code: 'unsupported-topic',
    })
    expect(subscriber.subscribe('workspace/build-started')).toEqual({
      ok: false,
      code: 'unsupported-topic',
    })
  })
})

describe('delivery', () => {
  it('numbers each topic independently and does not replay', () => {
    const { bus, flush } = harness()
    const first = collector('first')
    const subscriber = bus.createSubscriber(first.sink)

    bus.publish('theme/changed', { theme: 'dark' })
    bus.publish('workspace/file-changed', { path: '/a.txt', kind: 'changed', version: 'v1' })
    flush()

    expect(subscriber.subscribe('theme/changed')).toEqual({ ok: true, seq: 1 })
    expect(subscriber.subscribe('workspace/file-changed')).toEqual({ ok: true, seq: 1 })

    bus.publish('theme/changed', { theme: 'light' })
    bus.publish('theme/changed', { theme: 'high-contrast' })
    flush()

    expect(first.events.map((event) => [event.topic, event.seq])).toEqual([
      ['theme/changed', 2],
      ['theme/changed', 3],
    ])
  })

  it('caps the queue, keeps the newest and reports rate-limited once', () => {
    const { bus, flush } = harness()
    const { sink, events, errors } = collector()
    const subscriber = bus.createSubscriber(sink)
    subscriber.subscribe('workspace/file-changed')

    const total = MAX_QUEUED_EVENTS + 5
    for (let index = 0; index < total; index += 1) {
      bus.publish(
        'workspace/file-changed',
        { path: `/f${index}.txt`, kind: 'changed', version: `v${index}` },
        { burst: true },
      )
    }
    flush()

    expect(events).toHaveLength(MAX_QUEUED_EVENTS)
    expect(events[0]?.seq).toBe(total - MAX_QUEUED_EVENTS + 1)
    expect(events.at(-1)?.seq).toBe(total)
    expect(errors).toEqual([{ topic: 'workspace/file-changed', code: 'rate-limited' }])
  })

  it('drops payloads over 1 MiB', () => {
    const { bus, dropped } = harness()
    const subscriber = bus.createSubscriber(collector().sink)
    subscriber.subscribe('theme/changed')
    expect(bus.publish('theme/changed', { theme: 'dark', padding: 'x'.repeat(1024 * 1024) })).toBe(
      false,
    )
    expect(dropped).toEqual([{ topic: 'theme/changed', code: 'too-large' }])
  })

  it('limits non-burst topics to 100 events per second', () => {
    let now = 0
    const { bus, flush } = harness(() => now)
    const { events } = collector()
    const subscriber = bus.createSubscriber(collector().sink)
    subscriber.subscribe('theme/changed')

    const subscriber2 = bus.createSubscriber(collector().sink)
    subscriber2.subscribe('theme/changed')

    for (let index = 0; index < MAX_EVENTS_PER_SECOND; index += 1) {
      bus.publish('theme/changed', { theme: 'dark' })
    }
    expect(subscriber2.queues.get('theme/changed')).toHaveLength(MAX_EVENTS_PER_SECOND)
    expect(bus.publish('theme/changed', { theme: 'light' })).toBe(false)

    now = 1001
    expect(bus.publish('theme/changed', { theme: 'light' })).toBe(true)
    flush()
    expect(events.length).toBe(0)
    expect(subscriber2.queues.get('theme/changed')).toHaveLength(0)
  })

  it('contains a throwing subscriber and removes it after three failures', () => {
    const { bus, flush, removed } = harness()
    const good = collector('good')
    const badEvents: ShellEvent[] = []
    const bad = bus.createSubscriber({
      label: 'com.example.bad',
      deliver: (event) => {
        badEvents.push(event)
        throw new Error('frame gone')
      },
    })
    const ok = bus.createSubscriber(good.sink)
    bad.subscribe('theme/changed')
    ok.subscribe('theme/changed')

    for (let index = 0; index < 3; index += 1) {
      expect(() => bus.publish('theme/changed', { theme: 'dark' })).not.toThrow()
      flush()
    }

    expect(good.events).toHaveLength(3)
    expect(badEvents).toHaveLength(3)
    expect(removed).toEqual([
      { label: 'com.example.bad', topic: 'theme/changed', code: 'internal' },
    ])
    expect(bad.active).toBe(false)
  })

  it('starts a new session at sequence 1 after reset and drops pending flushes', () => {
    const { bus, flush } = harness()
    let delivered = 0
    const pending = collector()
    const stale = bus.createSubscriber({
      deliver: () => {
        delivered += 1
      },
    })
    stale.subscribe('theme/changed')
    bus.publish('theme/changed', { theme: 'dark' })
    bus.reset()
    flush()

    expect(delivered).toBe(0)
    expect(stale.active).toBe(false)

    const fresh = bus.createSubscriber(pending.sink)
    expect(fresh.subscribe('theme/changed')).toEqual({ ok: true, seq: 0 })
    bus.publish('theme/changed', { theme: 'light' })
    flush()
    expect(pending.events.map((event) => event.seq)).toEqual([1])
  })

  it('delivers workspace/closed synchronously', () => {
    const { bus } = harness()
    const { sink, events } = collector()
    const subscriber = bus.createSubscriber(sink)
    subscriber.subscribe('workspace/closed')

    bus.publishImmediate('workspace/closed', { reason: 'switch' })

    expect(events).toEqual([{ topic: 'workspace/closed', seq: 1, payload: { reason: 'switch' } }])
    expect(subscriber.queues.get('workspace/closed')).toHaveLength(0)
  })
})

describe('self-write echo suppression', () => {
  it('suppresses the same version within one second', () => {
    const now = 0
    const echo = new SelfWriteEcho(() => now)
    echo.record('/a.txt', 'v2')
    expect(echo.isEcho(change('/a.txt', 'changed', 'v2'))).toBe(true)
    expect(echo.isEcho(change('/a.txt', 'changed', 'v2'))).toBe(false)
  })

  it('still reports a different version or a different path', () => {
    let now = 0
    const echo = new SelfWriteEcho(() => now)
    echo.record('/a.txt', 'v2')
    expect(echo.isEcho(change('/a.txt', 'changed', 'v3'))).toBe(false)

    echo.record('/a.txt', 'v2')
    expect(echo.isEcho(change('/b.txt', 'changed', 'v2'))).toBe(false)

    echo.record('/a.txt', 'v2')
    now = 1001
    expect(echo.isEcho(change('/a.txt', 'changed', 'v2'))).toBe(false)
  })

  it('never suppresses a deletion and resets with the workspace', () => {
    const echo = new SelfWriteEcho(() => 0)
    echo.record('/a.txt', 'v2')
    expect(echo.isEcho(change('/a.txt', 'deleted'))).toBe(false)

    echo.record('/a.txt', 'v2')
    echo.reset()
    expect(echo.isEcho(change('/a.txt', 'changed', 'v2'))).toBe(false)
  })
})

describe('file change coalescing', () => {
  it('collapses three writes within the window', () => {
    const published: Array<{ path: string; kind: string; version?: string }> = []
    const callbacks: Array<() => void> = []
    const coalescer = new FileChangeCoalescer({
      publish: (payload) => published.push(payload),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback)
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    })
    coalescer.push(change('/a.txt', 'changed', 'v1'))
    coalescer.push(change('/a.txt', 'changed', 'v2'))
    coalescer.push(change('/a.txt', 'changed', 'v3'))
    for (const callback of callbacks) callback()
    expect(published).toEqual([{ path: '/a.txt', kind: 'changed', version: 'v3' }])
  })

  it('prefers deleted over created over changed', () => {
    const published: Array<{ path: string; kind: string; version?: string }> = []
    const callbacks: Array<() => void> = []
    const coalescer = new FileChangeCoalescer({
      publish: (payload) => published.push(payload),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback)
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    })
    coalescer.push(change('/a.txt', 'created'))
    coalescer.push(change('/a.txt', 'changed', 'v2'))
    coalescer.push(change('/a.txt', 'deleted'))
    for (const callback of callbacks) callback()
    expect(published).toEqual([{ path: '/a.txt', kind: 'deleted' }])
  })

  it('reports a rename once on the new path and drops the old window', () => {
    const published: Array<{ path: string; kind: string; version?: string }> = []
    const callbacks: Array<() => void> = []
    const coalescer = new FileChangeCoalescer({
      publish: (payload) => published.push(payload),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback)
        return callbacks.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    })
    coalescer.push(change('/old.txt', 'changed', 'v1'))
    coalescer.push({
      kind: 'renamed',
      path: '/new.txt',
      previousPath: '/old.txt',
      stat: { path: '/new.txt', kind: 'file', size: 1, mtime: 2, version: 'v2' },
    })
    for (const callback of callbacks) callback()
    expect(published).toEqual([{ path: '/new.txt', kind: 'renamed', version: 'v2' }])
  })

  it('lets a delete after a rename win', () => {
    const published: Array<{ path: string; kind: string; version?: string }> = []
    const callbacks: Array<() => void> = []
    const coalescer = new FileChangeCoalescer({
      publish: (payload) => published.push(payload),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback)
        return callbacks.length as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    })
    coalescer.push({
      kind: 'renamed',
      path: '/new.txt',
      previousPath: '/old.txt',
      stat: { path: '/new.txt', kind: 'file', size: 1, mtime: 2, version: 'v2' },
    })
    coalescer.push(change('/new.txt', 'deleted'))
    for (const callback of callbacks) callback()
    expect(published).toEqual([{ path: '/new.txt', kind: 'deleted' }])
  })

  it('drops pending windows on reset', () => {
    const published: Array<{ path: string; kind: string; version?: string }> = []
    const callbacks: Array<() => void> = []
    const coalescer = new FileChangeCoalescer({
      publish: (payload) => published.push(payload),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback)
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    })
    coalescer.push(change('/a.txt', 'changed'))
    coalescer.reset()
    for (const callback of callbacks) callback()
    expect(published).toHaveLength(0)
    expect(coalescer.size).toBe(0)
  })

  it('maps a change to the shared payload shape', () => {
    expect(fileChangedPayload(change('/a.txt', 'deleted'))).toEqual({
      path: '/a.txt',
      kind: 'deleted',
    })
    expect(
      fileChangedPayload({
        kind: 'renamed',
        path: '/b.txt',
        previousPath: '/a.txt',
        stat: { path: '/b.txt', kind: 'file', size: 1, mtime: 2, version: 'v9' },
      }),
    ).toEqual({ path: '/b.txt', kind: 'renamed', version: 'v9' })
  })

  it('merges with a stable priority', () => {
    expect(
      mergeFileChange({ path: '/a', kind: 'changed' }, { path: '/a', kind: 'deleted' }),
    ).toEqual({ path: '/a', kind: 'deleted' })
    expect(
      mergeFileChange({ path: '/a', kind: 'deleted' }, { path: '/a', kind: 'created' }),
    ).toEqual({ path: '/a', kind: 'deleted' })
  })
})
