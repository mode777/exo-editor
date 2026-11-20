# Proposal

## Why

A plugin no longer has one frame. Each open document gets its own handler iframe, and the follow-up view-surfaces change adds panels and content views. Those frames cannot share state directly: cross-origin frames are isolated, and a first-party plugin runs in an opaque origin with no storage, cookies or parent DOM access. The shell already owns a per-workspace event bus with identity-tagged subscribers, sequences, queues and limits. What is missing is a way for a plugin's own frames to publish to each other through that bus, without adding a second messaging stack.

## What Changes

- Reserve a `local/` topic namespace whose events are scoped to one plugin identity. Two plugins may use `local/state` independently and never observe each other.
- Add a correlated `plugin/publish { topic, payload }` and a `shell/published { topic, seq }` acknowledgement. Errors are reported through `shell/error` with a clear code and message.
- Extend `plugin/subscribe` and `plugin/unsubscribe` to accept `local/<name>` topics in addition to the closed shell catalog.
- Allow editor frames to publish and subscribe to local topics. Registration frames may not. View frames join the same rule in the view-surfaces change.
- Require the existing `events:subscribe` permission for both publish and subscribe. No new permission and no new consent category.
- Carry `from` (the publisher frame's opaque `exo-session`) on local events so a frame can ignore its own event and peers can address replies. Shell topics keep their current shape.
- Sequence local events per `(plugin identity, topic)` and keep the existing at-most-once, no-replay delivery model. Reuse the 1 MiB payload, 1,000 queued-event, 32-topic and 100/s-per-topic limits; add a 200/s per-frame aggregate for local publishes.
- Add SDK `publishLocal()`, `subscribeLocal()` and `onLocalEvent()`, an optional `capabilities.localEvents` support bit in `shell/init`, and an SDK minor version.
- Bump the shell to `0.2.0` and the SDK to `1.4.0`. The change is additive within protocol major `1`; a shell that predates the messages answers `unsupported-message` and the SDK gates on the support bit.

**Not breaking:** no existing topic changes meaning, no shell topic becomes publishable, and a plugin without `events:subscribe` or without the support bit keeps its current behavior.

**Explicit non-goals:** cross-plugin messaging, a request/response RPC layer, typed schemas for plugin-authored topics, event replay or persistence, background frames, and delivery of workspace or shell events to another plugin.

## Capabilities

### New Capabilities

None. This extends existing event and protocol behavior.

### Modified Capabilities

- `plugin-events`: reserves the `local/` namespace, defines identity-scoped publication, subscription, delivery, sequencing and limits, and changes the "a plugin cannot publish topics" rule.
- `plugin-protocol`: adds `plugin/publish` and `shell/published`, extends the phase matrix and limits, and keeps the envelope, sandbox and error model unchanged.
- `plugin-sdk`: adds local publish/subscribe helpers, the `from` field, the `capabilities.localEvents` support bit, and the compatibility rules for older shells.

## Impact

- `apps/shell/src/plugins/events.ts`: local topic validation, identity-scoped sequences and rates, `publishLocal`, local delivery.
- `apps/shell/src/plugins/handler.ts`: dispatch `plugin/publish`, extend subscribe/unsubscribe validation, attach the publisher session id.
- `apps/shell/src/plugins/protocol.ts`: message types, limits and error codes.
- `packages/plugin-sdk/src/protocol.ts`, `editor.ts`, `init.ts`: local topic types, `publishLocal`, `subscribeLocal`, `onLocalEvent`, support bit, SDK version.
- `docs/contracts/events.md`, `docs/contracts/plugin-protocol.md`, `docs/contracts/plugin-sdk.md`, the author guide and `ROADMAP.md`.
- Tests: cross-plugin isolation, topic validation, shell-topic rejection, rate and queue limits, no replay, SDK conformance, and a mutation check that removing identity scoping fails.
- The deployed fixture gains a two-frame local-event check so the behavior is demonstrated against the deployed shell.
