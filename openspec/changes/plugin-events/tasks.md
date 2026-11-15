# Tasks

## 1. Event bus core

- [x] 1.1 Add `apps/shell/src/plugins/events.ts` with the v1 topic catalog, payload types and the `<namespace>/<event>` validator (lowercase `[a-z0-9-]`, one slash, 64 characters) and the `events:subscribe` permission helper; verify unit tests accept the four catalog topics and reject uppercase, `*`, multiple slashes, empty segments and a 65-character name
- [x] 1.2 Implement per-frame subscriber creation, idempotent `subscribe`, `unsubscribe`, the 32-topic cap and subscription removal, returning `{ ok, seq }` or a stable error code; verify tests cover a duplicate subscribe returning the current sequence, unsubscribe stopping later delivery without affecting another subscriber, and a rejected 33rd topic leaving the first 32 intact
- [x] 1.3 Implement per-topic per-workspace sequence numbers starting at 1, at-most-once delivery to each subscribed frame, `shell/event` envelope construction and the current sequence in the subscribe result; verify tests assert strictly increasing per-topic sequences, one delivery per subscriber, no cross-topic ordering promise and no replay to a late subscriber
- [x] 1.4 Implement the per-subscriber per-topic queue (1000, oldest-first drop), one `rate-limited` error per topic on overflow, the 1 MiB payload check, the 100 events/s per-topic limit and microtask flushing; verify tests overflow a queue with synchronous publishes, assert the newest events survive and exactly one `rate-limited` arrives, and drop an oversize payload without delivering it
- [x] 1.5 Contain delivery failures: wrap every sink call, count failures, keep other subscribers working, remove a subscriber after three failures and log plugin id plus topic; verify a throwing sink does not propagate out of `publish` and the third throw removes it
- [x] 1.6 Add `reset()` and a workspace-session generation guard so sequences, queues, failure counters and pending flushes are cleared on attach; verify a test publishes in session A, resets, and observes session B start at sequence 1 with no event from A

## 2. File-change coalescing

- [x] 2.1 Add `FileChangeCoalescer` with injected timers: a 50 ms window per path, `deleted` > `created` > `changed`, one `renamed` on the new path with no separate deletion, and deleted-after-rename precedence; verify fake-timer tests for a three-write burst, create-then-delete, rename and rename-then-delete
- [x] 2.2 Add short-lived self-write echo suppression keyed by path and version (one second) so a poll/watch report of the shell's own write is not published twice while a different version is still a real change; verify tests for the echo case, a later different version and a different path
- [x] 2.3 Cancel pending coalescer timers and drop late callbacks on `reset()`; verify a test schedules a change, resets, advances timers and observes no publish, and that a rename resets the old path's pending window

## 3. Handler subscription wiring

- [x] 3.1 Replace the layer-5 `unsupported-message` branch for `plugin/subscribe` and `plugin/unsubscribe` in `HandlerSession` with real dispatch: permission check, catalog validation and `shell/subscribed { topic, seq }`, using `shell/error permission-denied` with `replyTo` when the plugin lacks `events:subscribe`; verify fake-transport tests for a granted subscribe, a denied subscribe and an unknown topic
- [x] 3.2 Return `shell/subscribed { topic, code: 'unsupported-topic' }` for malformed or unknown topics, reject the 33rd subscription with `shell/error rate-limited`, and keep registration frames on the existing protocol-violation path; verify tests assert no event is delivered for a rejected topic and the registration-frame case still unloads
- [x] 3.3 Unsubscribe every topic synchronously on `shell/dispose`, frame close, plugin removal and pool detach, and drop any queued event for that frame; verify a test disposes a frame, publishes afterwards and observes no delivery and no late message handling
- [x] 3.4 Give `HandlerPool` an injectable `EventBus`, expose `publish`, `publishWorkspaceClosed` and `reset`, and pass a subscriber handle into each `HandlerSession`; verify a pool test publishes to one of two frames and only the subscribed frame receives it

## 4. Producers

- [x] 4.1 Route `session.onExternalChange` through one `WorkspaceRuntime.publishChange` that keeps the targeted `shell/file-changed` notification and pushes the same change to the coalescer; verify a runtime test asserts the bound handler gets the targeted message and a subscribed frame gets the matching topic event with the same path, kind and version
- [x] 4.2 Publish successful saves from both document surfaces after `shell/save-result` (plugin) or after the write resolves (text), and suppress the poll echo; verify a test asserts the save result precedes the topic event and that one save yields one event
- [x] 4.3 Publish renames as one `workspace/file-changed` with kind `renamed` on the new path, while the targeted notification still follows the open document; verify a runtime test renames an open file and observes one topic event with no old-path deletion
- [x] 4.4 Publish `theme/changed` from the workbench theme through a `ThemeSync` `onChange` callback, skipping the initial value already present in `shell/init`; verify an App test toggles dark to light and observes one event, and that mounting the shell publishes none
- [x] 4.5 Add the `switch`/`close` reason to `WorkspaceRuntime.deactivate`, publish `workspace/closed` immediately before handler disposal, and reset the bus in `attach`; verify tests for a switch and a close assert the event arrives before `shell/dispose` and sequences restart afterwards
- [x] 4.6 Accept a `config/changed` subscription without a producer, gate every subscription on `events:subscribe`, and ensure a plugin without the permission receives no event; verify tests for the accepted-but-silent topic and the permission gate

## 5. Contracts and documentation

- [x] 5.1 Update `docs/contracts/events.md` with the producer list, the targeted-versus-topic boundary, the observable scope (open documents plus shell writes) and the queue/rate behavior implemented here; verify the text matches the `plugin-events` delta requirement and its scenarios
- [x] 5.2 Update `docs/contracts/plugin-protocol.md` section 5.4 to name `shell/file-changed` as the immediate targeted notification, not a subscription event, and cross-reference `workspace/file-changed`; verify the text matches the `plugin-protocol` delta
- [x] 5.3 Update the `docs/architecture.md` ownership row and lifecycle notes so "topics are the only push channel" is stated as the only broadcast/subscription channel, with targeted document messages listed separately; verify no other section contradicts the two contracts

## 6. Fixture

- [x] 6.1 Add an `events` mode to `apps/shell/public/plugin-host-fixture/editor-common.js`: subscribe to `theme/changed`, `workspace/file-changed`, `workspace/closed` and `config/changed`, record `shell/subscribed` sequences and `shell/event` payloads in `#observation` and the title, and keep the existing default behaviour unchanged
- [x] 6.2 Add `editor-events.html` with a `**/*.events.txt` contribution and `events:subscribe` in the fixture manifest, plus a read-only variant check, and update the fixture README manual steps for theme, coalescing, save ordering and workspace closure; verify the manifest validates and each documented file exists

## 7. Integration and deployed verification

- [x] 7.1 Run the full local gate (`npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, bundle budget, dist CSP, dist elements) and confirm every command passes
- [x] 7.2 Measure the bundle delta, confirm `apps/shell/budget.json` still passes, and record any deliberate limit change with the measured number and headroom
- [x] 7.3 Against `https://mode777.github.io/exo-editor/`, open the events fixture on a `.events.txt` file and confirm `shell/subscribed` reports sequence 0 for the four topics and `shell/init` already carries theme and workspace name; record the observation
- [x] 7.4 Against the deployed shell, toggle the theme and confirm the subscribed frame records one `theme/changed` while an unsubscribed editor frame records none; record both observations
- [x] 7.5 Against the deployed shell, change the open file externally, write it three times rapidly, then save; confirmed the bound handler got its targeted `shell/file-changed`, the burst produced one observed `workspace/file-changed`, and the save's event followed `shell/save-result`; recorded the event log
- [x] 7.6 Against the deployed shell, switch the workspace and confirmed the subscribed frame recorded `workspace/closed` with `switch` before disposal and received no event afterwards; the `close` reason is covered by `runtime.test.ts` because the deployed UI has no close action for folder workspaces
- [x] 7.7 Confirmed on the deployed shell that a plugin without `events:subscribe` is denied every subscription; the 33rd-topic cap and queue overflow are covered by `events.test.ts` because v1's four-topic catalog and manual runs cannot reach them
- [x] 7.8 Update `ROADMAP.md` layer 6 status and exit criteria with the deployed evidence, and confirm `openspec validate --all` passes

## Workflow follow-up

- Archive the change after the deployed evidence and the project review requirements are satisfied.
- Sync the delta specs into `openspec/specs/` and confirm `openspec validate --all` passes afterwards.
