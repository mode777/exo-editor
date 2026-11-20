# Design

## Context

See `proposal.md` for motivation. The current event path is:

- one `EventBus` per workspace; one `EventSubscriber` per handler frame;
- `plugin/subscribe` / `plugin/unsubscribe` / `shell/subscribed` / `shell/event`;
- `EventSink.identity` already tags a subscriber with its plugin identity;
- the shell topic catalog is a closed union, sequences are per topic, and
  `publish(topic, payload, { target })` already scopes `config/changed` to one
  identity.

`HandlerSession` creates its subscriber after init and closes it on disposal.
The bus does not know which frame published an event because only the shell
publishes today. The handler phase has a strict message matrix; the registration
frame is short-lived and must stay out of any subscription channel.

`plugin-file-picker` and the directory-listing change establish the support-bit
pattern: a shell capability in `shell/init` is separate from a manifest
permission, an older shell omits it, and the SDK treats absence as `false`.

## Goals / Non-Goals

**Goals:**

- Let the frames of one plugin exchange structured-cloneable messages through
  the existing event bus.
- Keep the shell topic catalog closed and the existing subscription, sequence,
  queue and error model intact.
- Make failures observable and explainable: topic, size, rate and permission.
- Ship additively within protocol major 1 so old shells and old plugins keep
  working.

**Non-Goals:**

- Cross-plugin messaging.
- Request/response RPC, acknowledgements from peers, or replay.
- Typed schemas for plugin-authored payloads.
- View-frame subscriptions in this change; the view-surfaces change extends the
  same rule once view frames exist.
- Background frames or a persistent hub for a plugin with no open document.
- Any change to shell event payloads, coalescing or the target-origin rules.

## Decisions

### D1 - The `local/` namespace, scoped by plugin identity

`local/<name>` is reserved for plugin-authored topics. The name is 1-64
characters of lowercase letters, digits, dots, underscores or hyphens. The bus
keys a local subscription and its sequence by `(sink.identity, topic)`, so two
plugins may both use `local/state` without seeing each other.

Alternatives rejected: `BroadcastChannel` and storage events fail for a
same-origin plugin in an opaque origin and would create a second channel with
different lifecycle rules. A direct frame-to-frame `postMessage` is impossible
across opaque origins and would bypass the shell's validation. A new broker API
would duplicate the existing queues, limits and permission checks.

### D2 - Correlated publish with an acknowledgement

`plugin/publish { topic, payload }` carries a request id and the shell replies
`shell/published { topic, seq }`. This makes a rejected payload, topic or rate
observable to the caller. An id-less notification would force every failure into
an uncorrelated `shell/error`, which is hard to attribute when a frame publishes
several messages.

The publisher may also be a subscriber. It receives its own event if subscribed;
`from` lets it ignore itself. There is no ordering guarantee between
`shell/published` and delivery to the publisher.

### D3 - Reuse `events:subscribe`, no new permission

Both publish and subscribe require the existing `events:subscribe` permission.
A local event stays inside one plugin's frames, so it adds no new data source;
the permission already describes the plugin's event channel. A new permission
would re-prompt every plugin that wants frame-to-frame messaging and would create
a second consent concept for the same trust boundary.

### D4 - Editor frames now, view frames in the next change

This change adds `plugin/publish` to the editor phase and lets handler frames
subscribe to local topics. The view-surfaces change will extend the same rule to
view frames. Keeping this change editor-only makes it independently shippable
and testable against the current shell.

### D5 - One sequence per identity and topic

Shell sequences remain per topic. Local sequences use a composite key
`${identity}\u0000${topic}` in the bus so two plugins do not share a counter.
`shell/subscribed` returns the current value for the caller's identity. No
history is retained.

### D6 - `from` is set by the shell, never by the payload

The shell knows the publishing frame's `exo-session` from the session object. It
sets `from` when it publishes the event. A plugin cannot forge another frame's
id through the payload. The field is optional on shell events and present on
local events.

### D7 - Reuse the event limits and add one aggregate

Local events use the existing 1 MiB payload cap, 1,000 queued events per topic
per frame, 32 topics per frame and 100 events/s per topic. A single frame may
publish at most 200 local events per rolling second across all local topics.
Exceeding the aggregate rejects the publication with `rate-limited`; it does not
tear the frame down. Queue overflow on the receiving side behaves exactly as it
does for shell topics.

### D8 - One bus per workspace, owned by the runtime

The current `HandlerPool` creates a bus unless one is injected. The view change
will add a second pool that must share the same bus, so this change moves
ownership to the workspace runtime: it creates the bus, injects it into the
handler pool, and resets it once on attach/detach. Pools must not call `reset()`
on a shared bus.

### D9 - SDK helpers and a support bit

`capabilities.localEvents` is added to editor `shell/init` (and the registration
init for feature detection). The SDK exposes `publishLocal()`,
`subscribeLocal()` and `onLocalEvent()`. Each helper preflights the support bit,
the permission, the topic form and the 1 MiB size; a failed preflight sends no
message. Errors use the existing stable codes, with `unsupported-topic` added to
the shell error vocabulary.

### D10 - Payloads are opaque

The shell validates the envelope, the topic, the size and the rate. It does not
interpret, log or persist the payload. Plugin authors own their local payload
shapes and should include a correlation id for request/reply patterns.

## Risks / Trade-offs

- **Event storm from one frame** -> 200/s aggregate, per-topic 100/s, 1,000-event
  queue, and `rate-limited` without teardown. A dedicated test publishes across
  many local topics to prove the aggregate applies.
- **Late-joining frame misses state** -> no replay is deliberate. Frames use
  `shell/init`, an `open-view` payload, a workspace read, or a peer request over
  local topics.
- **Permission meaning widens** -> `events:subscribe` now also covers messaging
  between a plugin's own frames. The consent text is updated; existing grants
  keep working because the permission string is unchanged.
- **Cross-plugin leak** -> delivery filters on `sink.identity`; a mutation test
  removes the filter and must fail a two-plugin isolation test.
- **Bus reset race** -> the runtime owns the single reset. A pool-level reset
  would wipe the other pool's subscriptions, so it is removed from the pools.
- **Publish ack is not peer delivery** -> `shell/published` means the shell
  accepted the event, not that a peer processed it. This is documented and is
  sufficient for fire-and-forget state updates.

## Migration Plan

1. Ship the shell with protocol major `1`, shell `0.2.0`, manifest schema `1` and
   SDK `1.4.0`. No manifest field, permission string or consent fingerprint
   changes.
2. Old shells omit `capabilities.localEvents` and ignore `plugin/publish`; the
   SDK rejects local calls locally instead of waiting for an error.
3. Rollback is a shell redeploy: no persisted state, schema or migration is
   involved. A plugin that uses local events must keep a working fallback for a
   shell without the support bit.

## Verification

Deployed on 2026-11-20 at commit `877cfdf`
(`https://mode777.github.io/exo-editor/`, JS asset `index-W51L97VC.js`) in Chrome
Headless Shell 131.0.6778.264 on the verification server. The workspace was an
OPFS directory containing `exo.json` with the main fixture manifest and the
second-identity manifest, `one.local.txt`, `two.local.txt`,
`three.local-other.txt` and `alpha.txt`.

- `shell/init` carried `capabilities.localEvents: true`; the editor and
  registration init shapes both parse it in the SDK tests.
- The first frame subscribed to `local/fixture` at sequence 0. Pressing Publish
  produced `shell/published { topic: 'local/fixture', seq: 1 }` and one
  `shell/event` with `from` equal to that frame's `exo-session`; the payload
  arrived unchanged.
- A second frame opened later received `seq: 1` on subscribe (the current
  late-join value, no replay). A later publish from the first frame arrived at
  the second frame with the first frame's `from`, and a publish from the second
  frame arrived at both frames with the second frame's `from`.
- The second-identity plugin (`com.example.exo.fixture.other`) subscribed to the
  same `local/fixture` name. A publish from the first identity produced no event
  in the second identity, and a publish from the second produced none in the
  first; each still received its own event.
- An oversized local payload returned `too-large` with the 1 MiB limit and did
  not advance the sequence. `theme/changed` returned `permission-denied` and
  `local/State` returned `unsupported-topic`; no event was delivered for either.
- The page reported no errors.

Cross-plugin isolation is enforced in `EventBus.publishLocal` by the identity
filter; the mutation check removed that filter and failed the named
`events.test.ts` case. The registration-frame rejection, disposed-frame drop,
topic budget and queue overflow are covered by the shell unit tests.

## Open Questions

None that change the specs or task breakdown. Cross-plugin messaging, replay and
a request/response RPC layer remain explicit non-goals.
