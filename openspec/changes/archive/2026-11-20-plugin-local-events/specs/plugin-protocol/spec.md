# Spec Delta

## MODIFIED Requirements

### Requirement: Error reporting

The shell SHALL report protocol failures as `shell/error` with a stable code from `unsupported-message`, `unsupported-version`, `protocol-violation`, `timeout`, `loading-failed`, `permission-denied`, `not-found`, `not-a-file`, `not-a-directory`, `too-large`, `conflict`, `rate-limited`, `unsupported-topic` or `internal`, SHALL include a user-safe message at most, and SHALL NOT expose stack traces, provider text or paths outside the requested scope.

#### Scenario: Reserved path

- **WHEN** a handler requests `/exo.json`
- **THEN** the error code is `permission-denied` and the message contains no content or metadata from the file

#### Scenario: Internal failure

- **WHEN** the provider fails for an unexpected reason
- **THEN** the plugin receives `internal` and the provider's message stays in the shell log

#### Scenario: Unsupported local topic

- **WHEN** a handler publishes or subscribes to a malformed local topic
- **THEN** the plugin receives `unsupported-topic` with a message naming the expected `local/<name>` form

### Requirement: Limits and protocol versioning

The shell SHALL enforce a 64-request in-flight limit per frame, a 16 MiB message payload cap, the advertised per-file read cap, a 10-second ready timeout, a 10-second registration timeout, a 5-second save timeout, a 1-second dispose timeout, a budget of three protocol violations before teardown, and a maximum of 20 concurrently open handler frames per plugin. `plugin/publish` payloads SHALL additionally obey the 1 MiB event payload cap and the event rate limits.

#### Scenario: Oversized payload

- **WHEN** a frame sends a message larger than 16 MiB
- **THEN** the shell rejects it with `too-large` and does not buffer it

#### Scenario: Oversized local event

- **WHEN** a frame publishes a local event whose payload exceeds 1 MiB
- **THEN** the shell rejects it with `too-large` even though the envelope is below the 16 MiB message cap

#### Scenario: Handler frame cap

- **WHEN** a plugin already has 20 handler frames and another matching file opens
- **THEN** the shell mounts no 21st frame and opens that document in the shell fallback renderer with a notice

#### Scenario: Repeated violations

- **WHEN** a frame exceeds its protocol-violation budget
- **THEN** the shell reports `protocol-violation` and unloads the frame

#### Scenario: Additive fields within a major

- **WHEN** a message includes an unknown optional field within protocol major 1
- **THEN** the shell ignores the field and processes the known parts

## ADDED Requirements

### Requirement: Local events capability negotiation

Editor `shell/init` SHALL carry `capabilities.localEvents` as the shell support bit for plugin-local publication and subscription. A shell that implements the feature SHALL send `true`; an older shell omits it, and a plugin SHALL treat absence as `false` and SHALL NOT infer support from `events:subscribe` or the shell version.

#### Scenario: New shell advertises local events

- **WHEN** an editor frame receives `shell/init` with `capabilities.localEvents: true`
- **THEN** the plugin may publish and subscribe to local topics

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.localEvents` field
- **THEN** the plugin treats local events as unsupported and keeps its existing per-frame behavior

#### Scenario: Support is not permission

- **WHEN** `capabilities.localEvents` is `true` but the manifest does not declare `events:subscribe`
- **THEN** the shell answers `permission-denied` and routes no local event

### Requirement: Plugin-local publication message

A handler frame SHALL send `plugin/publish { topic, payload }` with a live request id, and the shell SHALL reply `shell/published { topic, seq }` after accepting it. The shell SHALL reject a publish from a registration frame as a protocol violation and SHALL reject shell topics, malformed local topics, oversized payloads and excess rates with the stable error codes in the limits requirement.

#### Scenario: Publish is acknowledged

- **WHEN** an editor frame publishes a valid local topic
- **THEN** the shell replies `shell/published` with a `replyTo` equal to the request id, the topic and the sequence number

#### Scenario: Registration frame is rejected

- **WHEN** a registration frame sends `plugin/publish`
- **THEN** the shell replies `protocol-violation`, publishes nothing and counts the message toward the frame's budget

#### Scenario: Publishing a shell topic

- **WHEN** an editor frame publishes `workspace/file-changed`
- **THEN** the shell replies `permission-denied`, publishes nothing and leaves the shell topic's sequence unchanged

#### Scenario: Sequence in the acknowledgement

- **WHEN** two local events are accepted on one topic
- **THEN** the two `shell/published` replies carry increasing sequence numbers for that plugin and topic

#### Scenario: Publish without a subscriber

- **WHEN** an editor frame publishes a valid local topic and no frame is subscribed
- **THEN** the shell still acknowledges with the new sequence and queues nothing for later

#### Scenario: Publish after disposal

- **WHEN** a publish arrives from a frame whose session is disposed
- **THEN** the shell drops it, sends no acknowledgement and delivers no event
