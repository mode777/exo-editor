import { describe, expect, it } from 'vitest'
import type { WorkspaceChange } from '../workspace/contract'
import {
  EVENT_TOPICS,
  EventBus,
  FileChangeCoalescer,
  MAX_EVENTS_PER_SECOND,
  MAX_EVENT_BYTES,
  MAX_LOCAL_EVENTS_PER_SECOND,
  MAX_QUEUED_EVENTS,
  MAX_TOPICS_PER_FRAME,
  SelfWriteEcho,
  fileChangedPayload,
  isEventTopic,
  isLocalEventTopic,
  mergeFileChange,
  validTopicSyntax,
  type EventSink,
  type EventTopic,
  type ShellEvent,
} from './events'

function collector(label = 'test', identity?: string) {
  const events: ShellEvent[] = []
  const errors: Array<{ topic: string; code: string }> = []
  const sink: EventSink = {
    label,
    identity,
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

describe('local topics', () => {
  it('accepts and rejects the local name syntax', () => {
    for (const topic of [
      'local/state',
      'local/state.v1',
      'local/my_state',
      'local/a-b',
      'local/0',
    ]) {
      expect(isLocalEventTopic(topic)).toBe(true)
    }
    for (const topic of [
      'local/',
      'local/State',
      'local/a/b',
      'local/state/',
      `local/${'a'.repeat(65)}`,
      'theme/changed',
      'local/.hidden',
    ]) {
      expect(isLocalEventTopic(topic)).toBe(false)
    }
  })

  it('delivers only to the publishing plugin and carries the frame session', () => {
    const { bus, flush } = harness()
    const first = collector('first', 'a::com.example.a')
    const second = collector('second', 'b::com.example.b')
    const publisher = collector('publisher', 'a::com.example.a')
    const firstSubscriber = bus.createSubscriber(first.sink)
    const secondSubscriber = bus.createSubscriber(second.sink)
    const publisherSubscriber = bus.createSubscriber(publisher.sink)
    firstSubscriber.subscribe('local/state')
    secondSubscriber.subscribe('local/state')
    publisherSubscriber.subscribe('local/state')

    expect(
      bus.publishLocal(publisherSubscriber, 'local/state', { ready: true }, { from: 'frame-a' }),
    ).toEqual({ ok: true, seq: 1 })
    flush()

    expect(first.events).toEqual([
      { topic: 'local/state', seq: 1, payload: { ready: true }, from: 'frame-a' },
    ])
    expect(second.events).toHaveLength(0)
    expect(publisher.events).toHaveLength(1)
    expect(bus.localSequence('a::com.example.a', 'local/state')).toBe(1)
    expect(bus.localSequence('b::com.example.b', 'local/state')).toBe(0)
  })

  it('sequences per plugin identity and does not replay', () => {
    const { bus, flush } = harness()
    const first = collector('first', 'a::com.example.a')
    const second = collector('second', 'b::com.example.b')
    const firstPublisher = bus.createSubscriber(collector('pa', 'a::com.example.a').sink)
    const secondPublisher = bus.createSubscriber(collector('pb', 'b::com.example.b').sink)
    bus.publishLocal(firstPublisher, 'local/state', { n: 1 }, { from: 'a1' })
    bus.publishLocal(firstPublisher, 'local/state', { n: 2 }, { from: 'a1' })
    bus.publishLocal(secondPublisher, 'local/state', { n: 3 }, { from: 'b1' })
    flush()

    const firstSubscriber = bus.createSubscriber(first.sink)
    const secondSubscriber = bus.createSubscriber(second.sink)
    expect(firstSubscriber.subscribe('local/state')).toEqual({ ok: true, seq: 2 })
    expect(secondSubscriber.subscribe('local/state')).toEqual({ ok: true, seq: 1 })
    flush()
    expect(first.events).toHaveLength(0)
    expect(second.events).toHaveLength(0)
  })

  it('acknowledges with no subscribers and shares the topic budget', () => {
    const { bus } = harness()
    const publisher = bus.createSubscriber(collector('publisher', 'a::com.example.a').sink)
    expect(bus.publishLocal(publisher, 'local/state', {}, { from: 'a1' })).toEqual({
      ok: true,
      seq: 1,
    })

    const subscriber = bus.createSubscriber(collector('subscriber', 'a::com.example.a').sink)
    for (let index = 0; index < MAX_TOPICS_PER_FRAME; index += 1) {
      subscriber.topics.add(`fake/topic-${index}` as EventTopic)
    }
    expect(subscriber.subscribe('local/state')).toEqual({ ok: false, code: 'rate-limited' })
  })

  it('drops an oversized local payload without advancing the sequence', () => {
    const { bus, dropped } = harness()
    const publisher = bus.createSubscriber(collector('publisher', 'a::com.example.a').sink)
    expect(
      bus.publishLocal(
        publisher,
        'local/state',
        { padding: 'x'.repeat(MAX_EVENT_BYTES) },
        { from: 'a1' },
      ),
    ).toEqual({ ok: false, code: 'too-large' })
    expect(bus.localSequence('a::com.example.a', 'local/state')).toBe(0)
    expect(dropped).toEqual([{ topic: 'local/state', code: 'too-large' }])
  })

  it('limits one topic to 100 local events per second per identity', () => {
    let now = 0
    const { bus } = harness(() => now)
    const publisher = bus.createSubscriber(collector('publisher', 'a::com.example.a').sink)
    for (let index = 0; index < MAX_EVENTS_PER_SECOND; index += 1) {
      expect(bus.publishLocal(publisher, 'local/state', { index }, { from: 'a1' }).ok).toBe(true)
    }
    expect(bus.publishLocal(publisher, 'local/state', {}, { from: 'a1' })).toEqual({
      ok: false,
      code: 'rate-limited',
    })
    now = 1001
    expect(bus.publishLocal(publisher, 'local/state', {}, { from: 'a1' }).ok).toBe(true)
  })

  it('limits one frame to 200 local events per second across topics', () => {
    const { bus } = harness()
    const publisher = bus.createSubscriber(collector('publisher', 'a::com.example.a').sink)
    for (let index = 0; index < MAX_LOCAL_EVENTS_PER_SECOND; index += 1) {
      expect(bus.publishLocal(publisher, `local/topic-${index}`, {}, { from: 'a1' }).ok).toBe(true)
    }
    expect(bus.publishLocal(publisher, 'local/other', {}, { from: 'a1' })).toEqual({
      ok: false,
      code: 'rate-limited',
    })
  })

  it('caps the local queue per subscriber and reports overflow once', () => {
    let now = 0
    const { bus, flush } = harness(() => now)
    const { sink, events, errors } = collector('subscriber', 'a::com.example.a')
    const subscriber = bus.createSubscriber(sink)
    subscriber.subscribe('local/state')
    const publisher = bus.createSubscriber(collector('publisher', 'a::com.example.a').sink)

    let seq = 0
    for (let window = 0; window < 11; window += 1) {
      for (let index = 0; index < 100; index += 1) {
        const result = bus.publishLocal(publisher, 'local/state', { index }, { from: 'a1' })
        expect(result.ok).toBe(true)
        if (result.ok) seq = result.seq
      }
      now += 1001
    }
    flush()

    expect(seq).toBe(1100)
    expect(events).toHaveLength(MAX_QUEUED_EVENTS)
    expect(events[0]?.seq).toBe(101)
    expect(events.at(-1)?.seq).toBe(1100)
    expect(errors).toEqual([{ topic: 'local/state', code: 'rate-limited' }])
  })

  it('resets local sequences and subscriptions with the workspace', () => {
    const { bus } = harness()
    const publisher = bus.createSubscriber(collector('publisher', 'a::com.example.a').sink)
    bus.publishLocal(publisher, 'local/state', {}, { from: 'a1' })
    expect(bus.localSequence('a::com.example.a', 'local/state')).toBe(1)
    bus.reset()
    expect(bus.localSequence('a::com.example.a', 'local/state')).toBe(0)
    expect(publisher.active).toBe(false)
  })
})

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

  it('delivers editor/active only to the named identity and sequences it', () => {
    const { bus, flush } = harness()
    const first = collector('first', 'https://a.example.com::com.example.a')
    const second = collector('second', 'https://b.example.com::com.example.b')
    const firstSubscriber = bus.createSubscriber(first.sink)
    const secondSubscriber = bus.createSubscriber(second.sink)
    firstSubscriber.subscribe('editor/active')
    secondSubscriber.subscribe('editor/active')

    bus.publish(
      'editor/active',
      {
        pluginId: 'com.example.a',
        active: true,
        path: '/src/a.ts',
        instanceId: 'session-a',
      },
      { target: 'https://a.example.com::com.example.a' },
    )
    flush()

    expect(first.events).toHaveLength(1)
    expect(first.events[0]?.payload).toEqual({
      pluginId: 'com.example.a',
      active: true,
      path: '/src/a.ts',
      instanceId: 'session-a',
    })
    expect(second.events).toHaveLength(0)
    expect(bus.sequence('editor/active')).toBe(1)

    bus.publish(
      'editor/active',
      { pluginId: 'com.example.a', active: false },
      { target: 'https://a.example.com::com.example.a' },
    )
    flush()

    expect(first.events).toHaveLength(2)
    expect(first.events[1]?.payload).toEqual({ pluginId: 'com.example.a', active: false })
    expect(second.events).toHaveLength(0)
    expect(bus.sequence('editor/active')).toBe(2)
  })

  it('delivers a targeted event only to the named identity and still sequences it', () => {
    const { bus, flush } = harness()
    const first = collector('first', 'https://a.example.com::com.example.a')
    const second = collector('second', 'https://b.example.com::com.example.b')
    const firstSubscriber = bus.createSubscriber(first.sink)
    const secondSubscriber = bus.createSubscriber(second.sink)
    firstSubscriber.subscribe('config/changed')
    secondSubscriber.subscribe('config/changed')

    bus.publish(
      'config/changed',
      { pluginId: 'com.example.a', values: { greeting: 'hi' } },
      { target: 'https://a.example.com::com.example.a' },
    )
    flush()

    expect(first.events).toHaveLength(1)
    expect(second.events).toHaveLength(0)
    expect(bus.sequence('config/changed')).toBe(1)

    bus.publish(
      'config/changed',
      { pluginId: 'com.example.missing', values: {} },
      { target: 'https://missing.example.com::com.example.missing' },
    )
    flush()

    expect(first.events).toHaveLength(1)
    expect(second.events).toHaveLength(0)
    expect(bus.sequence('config/changed')).toBe(2)
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
