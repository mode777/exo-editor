# Spec Delta

## MODIFIED Requirements

### Requirement: Subscription API

The shell SHALL deliver shell-catalog and local events to handler and view frames whose plugin holds the `events:subscribe` permission, SHALL treat subscription as idempotent, SHALL stop delivery to a frame after `plugin/unsubscribe`, SHALL reject unknown shell topics without wildcard matching, SHALL accept only valid `local/<name>` plugin-local topics, and SHALL cap a frame at 32 topics across both namespaces.

#### Scenario: Permission required

- **WHEN** a plugin without `events:subscribe` sends `plugin/subscribe`
- **THEN** the shell replies with `permission-denied` and delivers no events

#### Scenario: Idempotent subscribe

- **WHEN** a frame subscribes to the same topic twice
- **THEN** it receives one stream and the second call returns the current sequence number

#### Scenario: Unknown topic

- **WHEN** a plugin subscribes to a topic outside the shell catalog and outside the `local/` namespace
- **THEN** the shell replies with `unsupported-topic` and delivers nothing for it

#### Scenario: Malformed local topic

- **WHEN** a plugin subscribes to `local/`, to a local name with uppercase letters or a second slash, or to a name longer than 64 characters
- **THEN** the shell replies `unsupported-topic` and delivers nothing for it

#### Scenario: Registration frames cannot subscribe

- **WHEN** a registration frame attempts to subscribe
- **THEN** the shell rejects the request and the frame is unloaded as usual

#### Scenario: View frames may subscribe

- **WHEN** a panel or content-view frame sends `plugin/subscribe`
- **THEN** the shell accepts it under the same identity, permission and topic rules as an editor frame

#### Scenario: Subscriptions are ephemeral

- **WHEN** a frame is disposed and a new frame is created
- **THEN** the new frame starts with no subscriptions and must subscribe again

#### Scenario: Unsubscribe stops delivery

- **WHEN** a frame unsubscribes from a topic
- **THEN** no later event on that topic is delivered to it and other subscribers are unaffected

#### Scenario: Topic limit

- **WHEN** a frame subscribes to a 33rd topic across shell and local namespaces
- **THEN** the shell rejects that subscription without dropping existing ones

### Requirement: Delivery semantics

The shell SHALL sequence shell-catalog events per topic per workspace session and local events per plugin identity and topic, SHALL deliver at most once, SHALL deliver independently to each subscribed handler or view frame, and SHALL NOT replay history. `config/changed` SHALL be delivered only to the subscribed handler and view frames of the plugin named in the payload. A local event SHALL carry the publisher frame's opaque `exo-session` in `from` and SHALL be delivered only to subscribed frames of the publishing plugin.

#### Scenario: Monotonic sequence

- **WHEN** several events are published on one shell topic
- **THEN** each subscriber receives strictly increasing sequence numbers for that topic

#### Scenario: Local sequences are per plugin

- **WHEN** two plugins each publish on `local/state`
- **THEN** each plugin's subscribers see a sequence that starts at 1 and is independent of the other plugin

#### Scenario: No cross-topic ordering

- **WHEN** events on two topics are published close together
- **THEN** the shell guarantees order within each topic only

#### Scenario: Sequence resets on switch

- **WHEN** a new workspace session starts
- **THEN** sequence numbers restart and no subscriber observes events from the previous session

#### Scenario: No replay

- **WHEN** a frame subscribes after events have already been published
- **THEN** it receives the current sequence number and only subsequent events, relying on initialization data or a peer request for current state

#### Scenario: Initial state

- **WHEN** a handler or view frame is initialized
- **THEN** the init message already carries the current theme, workspace name and the plugin's settings values

#### Scenario: Unrelated subscriber is skipped

- **WHEN** a plugin's settings change while a frame of another plugin is subscribed to `config/changed`
- **THEN** the shell increments the topic sequence as usual and delivers nothing to the unrelated frame

#### Scenario: Local publisher receives its own event when subscribed

- **WHEN** a frame subscribed to `local/state` publishes on `local/state`
- **THEN** it receives its own event with `from` equal to its frame session id and can choose to ignore it

#### Scenario: View frame receives a shell event

- **WHEN** a view frame subscribes to `theme/changed` and the user changes the theme
- **THEN** the view frame receives the same event shape as an editor frame

### Requirement: Plugin-local topic namespace

The shell SHALL reserve `local/<name>` for plugin-authored topics. The name SHALL be 1-64 characters of lowercase letters, digits, dots, underscores or hyphens, starting with a letter or digit. Local topics SHALL be scoped to the publishing plugin's identity and SHALL NOT be routed to another plugin.

#### Scenario: Same-plugin delivery

- **WHEN** one handler frame publishes `local/state` and a panel or another handler frame of the same plugin subscribes to it
- **THEN** the subscriber receives the event and no frame of another plugin does

#### Scenario: Cross-plugin isolation

- **WHEN** two plugins both use `local/state`
- **THEN** each plugin's subscribers receive only events published by their own plugin

#### Scenario: Identity includes the origin

- **WHEN** two plugins with the same manifest id run on different origins in one workspace
- **THEN** their local topics are separate because identity includes the manifest origin

#### Scenario: Namespace is reserved

- **WHEN** a plugin publishes or subscribes outside the `local/` namespace without a shell catalog topic
- **THEN** the shell rejects it with `unsupported-topic` and routes nothing

#### Scenario: Local name syntax

- **WHEN** a plugin subscribes or publishes to `local/state.v1` or `local/my_state`
- **THEN** the shell accepts the name, while `local/State`, `local/`, `local/a/b` and a name longer than 64 characters remain invalid

#### Scenario: Late joiner has no history

- **WHEN** a frame subscribes after local events were published
- **THEN** it receives the current sequence number and only later events

#### Scenario: Permission required for local topics

- **WHEN** a plugin without `events:subscribe` subscribes to or publishes a local topic
- **THEN** the shell replies `permission-denied` and delivers nothing

#### Scenario: Registration frame cannot publish

- **WHEN** a registration frame sends `plugin/publish`
- **THEN** the shell treats it as a protocol violation, publishes nothing and counts it toward the violation budget

#### Scenario: Shared topic budget

- **WHEN** a frame already has 32 shell or local subscriptions
- **THEN** a 33rd local subscription is rejected without dropping the existing ones

#### Scenario: View frame publishes

- **WHEN** a content-view frame publishes a local topic
- **THEN** the shell scopes and delivers it exactly as it does for an editor frame

### Requirement: Plugin-local publication

A handler or view frame SHALL send a correlated `plugin/publish` carrying a local topic and a structured-cloneable payload. The shell SHALL validate the topic and payload, require `events:subscribe`, deliver one `shell/event` to every subscribed frame of the same plugin, and reply `shell/published` with the topic and sequence.

#### Scenario: Successful publication

- **WHEN** a handler or view frame publishes a valid local topic with a structured-cloneable payload
- **THEN** the shell delivers one event to each subscribed frame of that plugin and replies `shell/published` with the topic and the sequence number

#### Scenario: No subscriber still acknowledges

- **WHEN** a frame publishes a local topic with no subscribers
- **THEN** the sequence advances and the publisher still receives `shell/published`

#### Scenario: Shell topic is rejected

- **WHEN** a frame publishes `theme/changed`
- **THEN** the shell replies `shell/error` with `permission-denied`, delivers no event and does not change the shell topic's sequence

#### Scenario: Oversized payload is explained

- **WHEN** a local payload exceeds 1 MiB
- **THEN** the shell replies `too-large` with a message naming the limit and delivers nothing

#### Scenario: Malformed publication

- **WHEN** `plugin/publish` lacks an `id`, names a non-string topic, or carries a payload that is not structured-cloneable
- **THEN** the shell treats it as a protocol violation, publishes nothing and sends no event

#### Scenario: Publish from an editor frame

- **WHEN** an editor-mode frame sends `plugin/publish`
- **THEN** the shell accepts it under the same rules as any other handler frame

#### Scenario: View frame publishes

- **WHEN** a panel or content-view frame sends `plugin/publish`
- **THEN** the shell accepts it under the same rules as any other frame

#### Scenario: Disposed frame cannot publish

- **WHEN** a message arrives from a frame after its session was disposed
- **THEN** the shell drops it and delivers no event

#### Scenario: Payload is opaque

- **WHEN** the shell routes a local event
- **THEN** it does not inspect, log or persist the payload and the event carries only the topic, sequence, `from` and payload
