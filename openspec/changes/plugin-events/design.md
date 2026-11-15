# Design

## Context

See `proposal.md`. The ratified `docs/contracts/events.md` and
`openspec/specs/plugin-events/spec.md` already define the topic bus; layer 6 is
the first runtime that implements them. The pieces it plugs into exist:

- `HandlerSession` (`apps/shell/src/plugins/handler.ts`) owns one handler frame,
  its ready/active/disposing phases and its `postMessage` boundary.
- `HandlerPool` (`apps/shell/src/plugins/handlers.ts`) owns every handler frame
  for one workspace and is the only place that counts, renames or closes them.
- `WorkspaceRuntime` (`apps/shell/src/workspace/runtime.ts`) owns the session,
  attaches/detaches the pool, receives external changes through
  `session.onExternalChange`, and is the only place that knows whether a
  workspace is being switched or closed.
- `DocumentStore` (`apps/shell/src/workspace/documents.ts`) completes plugin
  saves (sending `shell/save-result`) and forwards observed changes to the bound
  handler.
- Both providers report `watchable: false`, so "external" changes are observed by
  the session's focus/visibility poll over open documents; a watchable provider
  would use `handle.watch` with the same callback.
- `shell/init` already carries the current theme and workspace name; settings
  values arrive with layer 7.

The layer-5 targeted `shell/file-changed` message and the layer-0
`workspace/file-changed` topic describe the same observations. The design keeps
both, derives them from one producer path, and makes the split explicit.

## Goals / Non-Goals

**Goals:**

- One workspace-scoped bus with the four v1 topics, per-topic sequences,
  per-frame subscriptions, bounded queues, rate limiting and failure isolation.
- Producers wired into the observation paths that already exist, with no second
  watcher, poll or save notification path.
- Coalescing and save ordering that a unit test can control with fake timers and
  the deployed fixture can observe end to end.
- Workspace switch resets sequences, subscriptions, queues, failure counters and
  pending coalesced changes before new frames can subscribe.

**Non-Goals:**

- Background frames, subscriptions without an open document, or replay.
- Publishing changes for files the shell does not observe. Both providers are
  non-watchable, so v1 emits for open documents (plus the shell's own writes);
  whole-tree watching needs a provider capability and is not part of this layer.
- A `config/changed` producer before layer 7, or any settings payload in
  `shell/init` beyond what layer 5 already sends.
- Delivery acknowledgements from plugins. The protocol stays fire-and-forget.

## Decisions

### D1 - A standalone `EventBus`, owned by the handler pool

`apps/shell/src/plugins/events.ts` exports a DOM-free `EventBus`. `HandlerPool`
constructs one (or accepts an injected one in its options) and resets it in
`attach()`; `HandlerSession` receives a subscriber handle from the pool and
forwards `plugin/subscribe` / `plugin/unsubscribe` to it. Producers call
`handlers.publish(topic, payload)`.

Alternatives: put the bus in `PluginHost` (it detaches before handlers and does
not own frame lifetimes); put it in React state (render-path coupling and no
per-workspace reset); let each session keep its own bus (no shared sequences and
no fan-out). A pure module keeps the queue and failure logic testable without an
iframe.

The bus API:

```ts
type EventSink = { deliver(topic: string, event: ShellEvent): void }

createSubscriber(sink: EventSink): EventSubscriber   // per handler frame
subscribe(sub: EventSubscriber, topic: string): SubscribeResult
unsubscribe(sub: EventSubscriber, topic: string): void
removeSubscriber(sub: EventSubscriber): void         // dispose
publish(sink: TopicName, payload: unknown): void
publishImmediate(topic, payload): void               // workspace/closed only
reset(): void
```

`SubscribeResult` is `{ ok: true; seq } | { ok: false; code }` so the session can
choose `shell/subscribed` versus `shell/error` without knowing bus internals.

### D2 - Synchronous postMessage behind a microtask-bounded queue

`postMessage` is fire-and-forget, so the shell cannot know whether a plugin has
processed an event. The queue limit still has to be real: `publish` appends to a
per-subscriber, per-topic buffer and schedules a microtask flush; synchronous
bursts larger than 1000 hit the cap, drop the oldest events and produce one
`rate-limited` error per topic. Normal publishes flush in the same task before
the next paint, so latency is unchanged and delivery order per topic is stable.

`workspace/closed` bypasses the queue with `publishImmediate` and is posted
before `HandlerPool.detach()` closes the frames. Otherwise the coalescer or the
microtask would drop the last event during teardown.

Alternatives: deliver synchronously and treat the 1000 limit as theoretical
(makes the limit untestable and the spec unenforceable); wait for an ack the
protocol does not define; use a Web Worker (more moving parts for no benefit).

### D3 - One observation path for targeted and topic events

`WorkspaceRuntime.publishChange(change)` is the single entry point:

1. `documents.applyExternal(change)` keeps the layer-5 behaviour: it renames or
   marks the document and immediately posts the targeted `shell/file-changed` to
   the bound handler through `HandlerPool.notifyChange`.
2. `FileChangeCoalescer.push(change)` merges the change and, when its 50 ms
   window closes, calls `handlers.publish('workspace/file-changed', payload)`.

Successful saves call the same function from `DocumentStore`: after
`editors.completeSave(...)` has posted `shell/save-result` (plugin surface) or
after the write resolved (text surface), so the topic event cannot overtake the
save result. The coalescer's timer adds a second guarantee.

`shell/file-changed` stays the immediate, uncoalesced, targeted message; the
topic is the coalesced subscription form. Both use the same `path`, `kind` and
`version` mapping helper, and a test asserts they agree for one change.

A shell write records `path → version` in a short-lived `selfWrites` map. A
poll/watch change for that path with the same version within one second is an
echo and is not published again; a different version is a real external change.
With both providers non-watchable the echo case is rare, but the rule keeps the
"No duplicate observation" scenario honest.

Alternatives: retire `shell/file-changed` and require `events:subscribe` for
external-change notification (breaks layer 5 and its deployed guarantee); let the
bus own the targeted message (the bus would need document state); keep two
independent producers (drift between the two forms).

### D4 - A timer-injected coalescer

`FileChangeCoalescer` is a small class in `events.ts` with injected
`setTimeout`/`clearTimeout`. The window starts at the first change for a path;
later changes merge into it. Merge rules: `deleted` beats `created`, `created`
beats `changed`; `renamed` is emitted once on the new path and never as a
separate deletion of the old path; a `deleted` that arrives after a `renamed`
for the same new path wins. Pending timers are cleared by `reset()` so no event
from the old workspace leaks into the new one.

Alternatives: coalesce inside the bus by topic (the bus would need path
semantics); debounce with a trailing edge only (delays a lone event by 50 ms with
no merge benefit); use `requestAnimationFrame` (hidden frames and tests).

### D5 - Limits, rate limiting and failure isolation

- Topics per frame: 32, enforced by the subscriber; the 33rd is rejected and
  existing subscriptions stay.
- Queue: 1000 per topic per subscriber; oldest dropped; one `rate-limited` error
  per topic until the queue drains.
- Payload: 1 MiB, checked with the existing `payloadTooLarge` helper before
  queueing; an oversize event is dropped and logged, never sent.
- Publish rate: a per-topic token bucket (100 events per rolling second). Around
  a coalescing burst the bucket is allowed to refill, matching the spec's
  exception. Dropped events are not replayed.
- Delivery: every sink call is wrapped in `try/catch`; a throw or a missing
  window counts as a failure, the event is not retried, other subscribers still
  receive it, and the third failure removes that subscriber and logs plugin id,
  topic and code through `HandlerPoolHost.logHandler`.

`handlers.publish` is called from timers and watcher callbacks, never during
React render, and never throws; a producer failure is logged and does not reach
the render path.

### D6 - Theme and workspace closure producers

`ThemeSync` gains an `onChange` callback. It skips the first render (the initial
value is already in `shell/init`) and calls `runtime.publishTheme(theme)` only
when the store value actually changes. The runtime forwards
`theme/changed { theme }` to the pool.

`WorkspaceRuntime.deactivate(reason)` gains `'switch' | 'close'`. It calls
`handlers.publishWorkspaceClosed(reason)` and flushes it before
`handlers.detach()`; `activate()` passes `'switch'`, `disconnect()` and
`dispose()` pass `'close'`. `attach()` resets the bus, which also resets
sequences to zero.

### D7 - Protocol surface unchanged

`plugin/subscribe`, `plugin/unsubscribe`, `shell/subscribed` and `shell/event`
already exist in `docs/contracts/plugin-protocol.md` and `events.md`; the envelope,
origin checks, violation budget and sandbox stay untouched. Permission failure
uses `shell/error permission-denied` with `replyTo`; an unknown or malformed
topic uses `shell/subscribed { topic, code: 'unsupported-topic' }`; the 32-topic
cap and queue overflow use `shell/error rate-limited`. Registration frames
already treat subscription messages as violations.

## Risks / Trade-offs

- **The queue is an approximation of "slow subscriber".** → postMessage has no
  acknowledgement; document the limit as a burst/queue bound, test it with
  synchronous publishes, and keep the failure-removal rule for sinks that throw.
- **Version-based echo suppression can drop a genuine write** when a provider
  reuses a version string (folder versions are `lastModified:size`). → limit the
  suppression window to one second and require the same path and version; treat
  any different version as a real change. Both providers rotate versions on save.
- **Coalescing delays a lone file event by up to 50 ms.** → accepted by the
  contract; save results are not delayed and `workspace/closed` bypasses the
  queue.
- **Non-watchable providers only see changes on focus.** → the bus publishes what
  the shell observes; whole-tree watching stays a provider feature. Document it
  in the fixture checks so the deployed evidence is not overstated.
- **Two file-change forms could drift.** → one producer function, one payload
  mapper, a shared test for both, and contract text that names the split.
- **Timer leaks across a switch.** → `reset()` cancels coalescer timers and
  clears queues/failure counters before the next session attaches; a generation
  guard drops late callbacks.
- **Bundle growth.** → new code is a few KB; re-measure the existing budget and
  raise it only with the measured number and headroom.

## Migration Plan

No persisted data changes and no protocol version bump. Existing plugins that do
not subscribe see exactly the layer-5 behaviour; a plugin that already sends
`plugin/subscribe` stops receiving `unsupported-message` and starts receiving
`shell/subscribed`. Rollback is a revert of this change; the removed runtime
leaves `shell/file-changed`, saves and workspace switching untouched.

## Open Questions

None.
