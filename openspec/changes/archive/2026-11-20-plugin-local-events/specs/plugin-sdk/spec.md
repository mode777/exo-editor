# Spec Delta

## MODIFIED Requirements

### Requirement: SDK, protocol and manifest compatibility policy

The SDK SHALL use SemVer with its MAJOR equal to the protocol major it speaks, SHALL allow additive optional fields and API additions only in a minor, SHALL require a new SDK and protocol major to remove or reinterpret a wire field, SHALL keep a deprecated API for the rest of the current major, and SHALL treat the manifest `schemaVersion`, `engines.exo` and shell version as independent inputs. Plugin-local event helpers are an additive minor: they do not change an existing method or the meaning of a shell topic.

#### Scenario: SDK major matches the protocol

- **WHEN** the SDK speaks protocol major `1`
- **THEN** its package major is `1` and it exports the protocol version constant rather than letting a plugin hard-code it

#### Scenario: Additive change stays minor

- **WHEN** a new optional protocol field or a new client helper is added without changing existing meaning
- **THEN** it ships in an SDK minor and an existing plugin continues to work

#### Scenario: Removal requires a major

- **WHEN** a wire field is removed or reinterpreted
- **THEN** the change requires a new SDK and protocol major, and the old major is not silently accepted

#### Scenario: Deprecation window

- **WHEN** an SDK API is deprecated
- **THEN** it remains functional and documented with its replacement for the rest of the current major and is removed only at the next major

#### Scenario: Manifest schema is independent

- **WHEN** a plugin adopts a newer SDK minor
- **THEN** its manifest still declares the same `schemaVersion` and `engines.exo` range unless the manifest contract itself changed, and the SDK does not parse or rewrite a manifest

#### Scenario: Local events stay minor

- **WHEN** `publishLocal()`, `subscribeLocal()` and `onLocalEvent()` ship
- **THEN** the SDK takes an additive minor version, the protocol major remains `1`, and existing editor and subscription methods keep their behavior

## ADDED Requirements

### Requirement: Local events capability

The SDK SHALL expose `capabilities.localEvents` as a boolean initialized from `shell/init`, SHALL parse an absent support bit as `false`, and SHALL NOT infer local-event support from `events:subscribe`, the shell version or the presence of another capability.

#### Scenario: New shell advertises local events

- **WHEN** `shell/init` carries `capabilities.localEvents: true`
- **THEN** the SDK exposes it and allows local publication and subscription after the permission check

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.localEvents` field
- **THEN** the SDK exposes `false`, rejects local calls locally with `unsupported-message` and sends no message

#### Scenario: Permission is separate

- **WHEN** the shell advertises local events but the manifest does not declare `events:subscribe`
- **THEN** the SDK rejects local publication and subscription with `permission-denied` and sends no message

### Requirement: Local event client

The SDK SHALL expose `EditorClient.publishLocal(topic, payload)` and `EditorClient.subscribeLocal(topic)`, SHALL send one correlated `plugin/publish` or `plugin/subscribe`, SHALL validate the local topic and 1 MiB payload limit locally, SHALL resolve the publish from `shell/published`, and SHALL deliver local `shell/event` payloads to `onLocalEvent(topic, listener)`.

#### Scenario: Publish and acknowledge

- **WHEN** the plugin calls `publishLocal('local/state', { ready: true })`
- **THEN** the SDK sends one `plugin/publish` with a fresh id and resolves with the topic and sequence number from the matching `shell/published`

#### Scenario: Subscribe to a local topic

- **WHEN** the plugin calls `subscribeLocal('local/state')`
- **THEN** the SDK sends one `plugin/subscribe` and resolves with the topic and current sequence from `shell/subscribed`

#### Scenario: Local event delivery

- **WHEN** a subscribed frame receives a local `shell/event`
- **THEN** the SDK delivers the topic, sequence, `from` and payload to the registered listener without interpreting the payload

#### Scenario: Oversized local payload

- **WHEN** the plugin publishes a payload larger than 1 MiB
- **THEN** the SDK rejects locally with `too-large` and a message naming the limit, and sends no message

#### Scenario: Malformed local topic

- **WHEN** the plugin publishes or subscribes to `local/`, `local/State` or `local/a/b`
- **THEN** the SDK rejects locally with `unsupported-topic` and sends no message

#### Scenario: Shell topic is rejected locally

- **WHEN** the plugin calls `publishLocal('theme/changed', {})`
- **THEN** the SDK rejects with `permission-denied` and sends no message

#### Scenario: No replay

- **WHEN** the plugin subscribes after a local event was published
- **THEN** the SDK resolves with the current sequence and does not synthesize the missed event

#### Scenario: Publish without the support bit

- **WHEN** `capabilities.localEvents` is false or absent
- **THEN** `publishLocal()` and `subscribeLocal()` reject with `unsupported-message` and the plugin keeps its existing per-frame fallback

#### Scenario: Disposal rejects pending local calls

- **WHEN** the shell sends `shell/dispose` while a local publish or subscribe is pending
- **THEN** the SDK rejects that call with `closed` and sends no further local message

#### Scenario: Throwing local listener is contained

- **WHEN** a plugin's local event listener throws
- **THEN** the SDK contains the error, keeps the connection open and still delivers later events

#### Scenario: Unsubscribe is local and immediate

- **WHEN** the plugin unsubscribes from a local topic
- **THEN** the SDK sends `plugin/unsubscribe`, removes the local listener and does not wait for an acknowledgement the protocol does not define
