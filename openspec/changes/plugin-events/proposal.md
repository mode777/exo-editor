# Proposal

## Why

Plugins can currently learn about theme and workspace changes only by polling,
and the only push a handler receives is the per-document `shell/file-changed`
message from layer 5. The ratified `plugin-events` contract defines a topic bus
for `theme/changed`, `workspace/file-changed`, `workspace/closed` and the
reserved `config/changed`, but no runtime implements it, so a plugin cannot react
to the shell theme or to changes in files it does not own. Layer 6 closes that
gap and makes the event bus the single workspace-wide push channel, with bounded
queues so one slow or failing subscriber cannot affect the shell or another
plugin.

## What Changes

- Add a workspace-scoped event bus with the v1 catalog: `theme/changed`,
  `workspace/file-changed`, `workspace/closed` and the reserved `config/changed`.
- Handle `plugin/subscribe` and `plugin/unsubscribe` in handler sessions with the
  `events:subscribe` permission, idempotent subscription, a 32-topic cap,
  `unsupported-topic` for unknown or malformed names, and `shell/subscribed`
  carrying the current per-topic sequence number.
- Deliver `shell/event` to live, subscribed handler frames only, with per-topic
  per-workspace sequence numbers, at-most-once delivery and no replay.
- Publish external changes from the existing session watcher, successful saves
  from both document surfaces, and renames; coalesce changes to one path within
  50 ms with `deleted` > `created` > `changed`, report a rename once on the new
  path, and publish a save's topic event after its `shell/save-result`.
- Publish `theme/changed` from the live workbench theme, and `workspace/closed`
  once with `switch` or `close` before handler frames are disposed. Reset
  sequences and subscriptions on workspace switch; keep `config/changed`
  producer-free until layer 7.
- Keep the layer-5 `shell/file-changed` message as the targeted per-document
  notification and derive it, and the `workspace/file-changed` topic event, from
  one observation path so the two cannot drift. Clarify this split in the
  protocol and events contracts and their specs.
- Enforce the limits: 1000 queued events per topic per frame with oldest-first
  drop and one `rate-limited` error, 1 MiB payloads, 100 events/s per topic, and
  subscriber removal after three delivery failures. Delivery failures are
  contained so they cannot throw into the render path.
- Extend the deployed fixture with a subscribing editor mode and manual checks
  for theme, coalesced file changes, save ordering and disposal.
- Update `docs/contracts/events.md`, `docs/contracts/plugin-protocol.md`,
  `ROADMAP.md` and the fixture README; no new dependency.

**Explicit non-goals:** background frames or subscriptions without an open
document, topic publication by plugins, wildcard topics, replay or persistence
of subscriptions, a `config/changed` producer before layer 7, cross-workspace
delivery, and changing the plugin-protocol envelope or sandbox model.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `plugin-events`: adds the normative producer list and the boundary between the
  targeted `shell/file-changed` message and the coalesced
  `workspace/file-changed` topic; the rest of the ratified contract is
  implemented unchanged.
- `plugin-protocol`: clarifies that `shell/file-changed` is the immediate,
  targeted notification for the bound document and not a subscription event,
  and that both forms derive from the same observed change.

## Impact

- `apps/shell/src/plugins/events.ts` (new): topic catalog, validation, sequence
  numbers, subscriptions, queues, rate limiting, failure isolation and the
  file-change coalescer.
- `apps/shell/src/plugins/handler.ts`, `handlers.ts`, `host.ts`: subscription
  messages, per-frame delivery, unsubscribe on dispose, workspace reset.
- `apps/shell/src/workspace/runtime.ts`, `documents.ts`: publish external
  changes, saves, renames, theme changes and workspace closure from the existing
  observation paths; no second watcher or polling loop.
- `apps/shell/src/App.tsx`, `theme-sync.tsx`: connect the workbench theme to the
  bus.
- `apps/shell/public/plugin-host-fixture/`: subscribing editor mode, event log
  in the page title and `#observation`, README checks.
- `docs/contracts/events.md`, `docs/contracts/plugin-protocol.md`, `ROADMAP.md`.
- Tests: new bus and coalescer unit tests plus handler, runtime, theme and
  workspace-switch coverage; bundle budget re-measured, no dependency added.
