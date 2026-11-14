# Spec Delta

## Purpose

Defines how plugins learn about shell state changes: the subscription messages,
the closed v1 topic catalog, ordering and coalescing rules, and the limits that
keep one slow subscriber from affecting the shell or another plugin.

## ADDED Requirements

### Requirement: Subscription API

The shell SHALL deliver events only to handler frames whose plugin holds the
`events:subscribe` permission, SHALL treat subscription as idempotent, SHALL stop
delivery to a frame after `plugin/unsubscribe`, SHALL reject unknown topics
without wildcard matching, and SHALL cap a frame at 32 topics.

#### Scenario: Permission required

- **WHEN** a plugin without `events:subscribe` sends `plugin/subscribe`
- **THEN** the shell replies with `permission-denied` and delivers no events

#### Scenario: Idempotent subscribe

- **WHEN** a frame subscribes to the same topic twice
- **THEN** it receives one stream and the second call returns the current sequence number

#### Scenario: Unknown topic

- **WHEN** a plugin subscribes to a topic outside the catalog
- **THEN** the shell replies with `unsupported-topic` and delivers nothing for it

#### Scenario: Registration frames cannot subscribe

- **WHEN** a registration frame attempts to subscribe
- **THEN** the shell rejects the request and the frame is unloaded as usual

#### Scenario: Subscriptions are ephemeral

- **WHEN** a frame is disposed and a new frame is created
- **THEN** the new frame starts with no subscriptions and must subscribe again

#### Scenario: Unsubscribe stops delivery

- **WHEN** a frame unsubscribes from a topic
- **THEN** no later event on that topic is delivered to it and other subscribers
  are unaffected

#### Scenario: Topic limit

- **WHEN** a frame subscribes to a 33rd topic
- **THEN** the shell rejects that subscription without dropping existing ones

### Requirement: V1 topic catalog

The shell SHALL expose exactly `theme/changed` with `{ theme }`,
`workspace/file-changed` with `{ path, kind, version? }`, `workspace/closed` with
`{ reason }` and `config/changed` with `{ pluginId, values }`, and SHALL reject
topic names outside the lowercase `<namespace>/<event>` form made of
`[a-z0-9-]` segments and at most 64 characters. `config/changed` is reserved in
v1: there is no producer until layer 7, but subscribing to it is valid and
remains silent until settings exist.

#### Scenario: Theme payload

- **WHEN** the user switches the theme
- **THEN** subscribers receive `theme/changed` with `dark`, `light` or `high-contrast`

#### Scenario: File payload

- **WHEN** a workspace file changes
- **THEN** subscribers receive `workspace/file-changed` with the path, a kind of `created`, `changed`, `deleted` or `renamed`, and a version when one exists

#### Scenario: Workspace closure

- **WHEN** the shell releases a workspace
- **THEN** subscribers may receive `workspace/closed` with `switch` or `close` before disposal, and the shell does not rely on that delivery

#### Scenario: Configuration change is reserved in v1

- **WHEN** a plugin subscribes to `config/changed` before layer 7 ships
- **THEN** the subscription is accepted and no event is delivered

#### Scenario: Configuration change

- **WHEN** a plugin's contributed settings change after layer 7
- **THEN** its live frames receive `config/changed` with its plugin id and the new values

#### Scenario: Malformed topic name

- **WHEN** a plugin subscribes to a topic containing uppercase letters,
  characters outside `[a-z0-9-]`, more than one slash or more than 64 characters
- **THEN** the shell replies `unsupported-topic` and delivers nothing

### Requirement: Delivery semantics

The shell SHALL sequence events per topic per workspace session, SHALL deliver at
most once, SHALL deliver independently to each subscribed frame, and SHALL NOT
replay history.

#### Scenario: Monotonic sequence

- **WHEN** several events are published on one topic
- **THEN** each subscriber receives strictly increasing sequence numbers for that topic

#### Scenario: No cross-topic ordering

- **WHEN** events on two topics are published close together
- **THEN** the shell guarantees order within each topic only

#### Scenario: Sequence resets on switch

- **WHEN** a new workspace session starts
- **THEN** sequence numbers restart and no subscriber observes events from the previous session

#### Scenario: No replay

- **WHEN** a frame subscribes after events have already been published
- **THEN** it receives the current sequence number and only subsequent events, relying on initialization data for current state

#### Scenario: Initial state

- **WHEN** a handler frame is initialized
- **THEN** the init message already carries the current theme, workspace name and the plugin's settings values

### Requirement: Coalescing and ordering

The shell SHALL coalesce changes to the same path within 50 ms, SHALL prefer
`deleted` over `created` over `changed` when coalescing, SHALL report a rename as
a single `renamed` event on the new path, and SHALL emit a document's save result
before its `workspace/file-changed` event.

#### Scenario: Burst of writes

- **WHEN** the same file is written three times within 50 ms
- **THEN** subscribers receive one `changed` event for that path

#### Scenario: Create then delete

- **WHEN** a path is created and deleted within the coalescing window
- **THEN** the shell emits `deleted` rather than both events

#### Scenario: Rename

- **WHEN** a file is renamed
- **THEN** subscribers receive one `renamed` event carrying the new path and no separate deletion for the old path

#### Scenario: Self-save ordering

- **WHEN** a plugin saves its own document
- **THEN** its `shell/save-result` arrives before the `workspace/file-changed` event for that write

### Requirement: Event versioning

The shell SHALL version topics by name only, SHALL allow additive payload fields
within protocol major 1, SHALL require a protocol major change for a breaking
payload change on an existing topic, and SHALL keep the v1 catalog closed so a
plugin cannot publish topics.

#### Scenario: Additive field

- **WHEN** an event payload gains an optional field within protocol major 1
- **THEN** existing subscribers continue to work and must tolerate the unknown
  field

#### Scenario: Plugin publication

- **WHEN** a plugin attempts to publish a topic
- **THEN** the shell rejects the message as unsupported and delivers nothing

### Requirement: Limits and failure isolation

The shell SHALL cap queued events at 1000 per topic per frame and payloads at
1 MiB, SHALL publish at most 100 events per second per topic except for a
coalescing burst, SHALL drop the oldest queued events and report `rate-limited`
once on overflow, SHALL never let event delivery throw into the render path, and
SHALL remove a subscriber that fails three deliveries.

#### Scenario: Slow subscriber

- **WHEN** a frame falls 1000 events behind on a topic
- **THEN** the oldest events are dropped, the newest are delivered, and the frame receives one `rate-limited` error for that topic

#### Scenario: Throwing subscriber

- **WHEN** delivering an event to one frame fails or the frame stops acknowledging
- **THEN** the failure is contained, other subscribers still receive the event, and the shell's rendering is unaffected

#### Scenario: Repeated failures

- **WHEN** a frame fails three deliveries
- **THEN** it is removed from the topic's delivery set and the failure is logged with the plugin id
