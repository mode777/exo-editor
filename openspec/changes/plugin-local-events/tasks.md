# Tasks

## 1. Event bus

- [x] 1.1 Add local-topic validation and types (`local/<name>`, 1-64 chars, lowercase letters, digits, dots, underscores, hyphens) and verify valid and invalid names with unit tests.
- [x] 1.2 Implement identity-scoped local publication with per-`(identity, topic)` sequences, delivery to subscribed frames of the same identity, and the `from` field; verify a two-plugin isolation test and a same-plugin delivery test.
- [x] 1.3 Enforce the 1 MiB payload, 1,000-event queue, 100/s per-topic and 200/s per-frame aggregate limits; verify rate, queue-overflow and oversized-payload tests.
- [x] 1.4 Move the single `EventBus` instance and its reset to the workspace runtime, inject it into the handler pool and verify no pool resets another pool's subscriptions.
- [x] 1.5 Add a mutation test that removes the identity filter and fails the cross-plugin isolation test; record the result in the security review.

## 2. Protocol and handler

- [x] 2.1 Add `plugin/publish` and `shell/published` payload types, the `unsupported-topic` error code and the local event constants; verify the protocol unit tests.
- [x] 2.2 Dispatch `plugin/publish` from editor frames: validate the request id, topic and payload, require `events:subscribe`, publish, and reply with `shell/published` or a specific `shell/error`; verify handler tests for success, oversized payload, shell topic and malformed topic.
- [x] 2.3 Accept and validate local topics in `plugin/subscribe` and `plugin/unsubscribe`; verify subscribe, unsubscribe and shared 32-topic budget tests.
- [x] 2.4 Add `capabilities.localEvents` to editor and registration `shell/init`; verify an older-shell init shape parses as `false`.
- [x] 2.5 Reject `plugin/publish` from registration frames and from disposed frames; verify both cases publish nothing and count or drop correctly.
- [x] 2.6 Verify a publisher that also subscribes receives its own event with its own session id in `from`, and that no payload is written to the plugin log.

## 3. SDK

- [x] 3.1 Add `LocalEventTopic` types, `capabilities.localEvents` parsing and the absent-as-false rule; verify init and handshake tests.
- [x] 3.2 Implement `publishLocal()`, `subscribeLocal()` and `onLocalEvent()` with local preflight for the support bit, `events:subscribe`, topic form and 1 MiB payload; verify editor client tests for each rejected preflight.
- [x] 3.3 Resolve publish from `shell/published`, subscribe from `shell/subscribed`, deliver `from` to listeners, and reject pending local calls on disposal; verify tests.
- [x] 3.4 Bump `SDK_VERSION` and the package to `1.4.0`, update the compatibility notes and verify typecheck and the SDK test suite.
- [x] 3.5 Run the SDK against a real `HandlerSession` with two frames: publish from one, subscribe from the other, and verify the ack, event and no cross-plugin delivery.

## 4. Contracts and documentation

- [x] 4.1 Update `docs/contracts/events.md` with the `local/` namespace, publication, identity scoping, `from`, limits and the operator/permission wording; verify links and examples.
- [x] 4.2 Update `docs/contracts/plugin-protocol.md` with `plugin/publish`, `shell/published`, the editor-phase rule, the error code and the limits; update `docs/contracts/plugin-sdk.md` with the helpers and support bit.
- [x] 4.3 Update the author guide with a two-frame messaging example and a no-replay/late-join note; verify the guide test that checks documented commands and links.
- [x] 4.4 Update `docs/security-review.md` with identity scoping, payload opacity, rate limits and the mutation result.
- [x] 4.5 Add the `ROADMAP.md` follow-up paragraph and the `CHANGELOG.md` entry naming shell `0.2.0`, protocol `1`, schema `1` and SDK `1.4.0`; verify the changelog test.

## 5. Fixture and deployed verification

- [x] 5.1 Extend the plugin-host fixture with a two-frame local-event check that reports the ack, the received `from` and the received payload in its page state; verify the fixture test.
- [x] 5.2 Build, deploy and verify the two-frame check, cross-plugin isolation and the error messages against the deployed URL; record the deployed commit and date.
- [x] 5.3 Run the full local gate from `AGENTS.md`, including lint, format, typecheck, unit tests, build, bundle budget, CSP, custom elements, no-SDK, no-Monaco and secrets checks.

## Workflow follow-up

- Archive the change after review and sync its deltas into the main specs.
- Verify the archived result and keep the `ROADMAP.md` follow-up consistent.
