# plugin-events Specification

## Purpose

Defines how plugins learn about shell state changes: the subscription messages,
the closed v1 topic catalog, ordering and coalescing rules, and the limits that
keep one slow subscriber from affecting the shell or another plugin.

## Requirements

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

### Requirement: V1 topic catalog

The shell SHALL expose exactly `theme/changed` with `{ theme }`, `workspace/file-changed` with `{ path, kind, version? }`, `workspace/closed` with `{ reason }`, `config/changed` with `{ pluginId, values }`, `view/active` with either `{ pluginId, active: false }` or `{ pluginId, active: true, viewId, instanceId, instanceKey }`, and `editor/active` with either `{ pluginId, active: false }` or `{ pluginId, active: true, path, instanceId }`, and SHALL reject shell topic names outside the lowercase `<namespace>/<event>` form made of `[a-z0-9-]` segments and at most 64 characters. The `local/` namespace is reserved for plugin-authored topics and is governed by the plugin-local requirements. `config/changed` SHALL be produced when a plugin's contributed settings change and SHALL be delivered only to that plugin's subscribed handler frames. `view/active` SHALL be produced when a plugin's active content-view tab changes or clears and SHALL be delivered only to that plugin's subscribed frames. `editor/active` SHALL be produced when a plugin's active file editor changes or clears and SHALL be delivered only to that plugin's subscribed frames.

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

- **WHEN** a plugin subscribes to `config/changed` before any setting has changed
- **THEN** the subscription is accepted, returns the current sequence and no event is delivered yet

#### Scenario: Configuration change

- **WHEN** a plugin's contributed settings change
- **THEN** that plugin's subscribed handler frames receive `config/changed` with its plugin id and the full new values

#### Scenario: Configuration change is targeted

- **WHEN** two plugins have handler frames subscribed to `config/changed` and one plugin's settings change
- **THEN** only the named plugin's frames receive the event

#### Scenario: Active content view changes

- **WHEN** a plugin's active content-view tab becomes active or the tab changes to a file or another plugin
- **THEN** that plugin's subscribed frames receive `view/active` with the new content-view instance or `active: false`

#### Scenario: Active editor changes

- **WHEN** a plugin's active file editor changes, is renamed or clears
- **THEN** that plugin's subscribed frames receive `editor/active` with `active: true` and the new path and instance id, or `active: false`

#### Scenario: Active editor is targeted

- **WHEN** two plugins have subscribed frames and one plugin's active editor changes
- **THEN** only that plugin's frames receive `editor/active` and the other plugin learns nothing about the editor

#### Scenario: Malformed topic name

- **WHEN** a plugin subscribes to a shell topic containing uppercase letters, characters outside `[a-z0-9-]`, more than one slash or more than 64 characters
- **THEN** the shell replies `unsupported-topic` and delivers nothing

### Requirement: Delivery semantics

The shell SHALL sequence shell-catalog events per topic per workspace session and local events per plugin identity and topic, SHALL deliver at most once, SHALL deliver independently to each subscribed handler or view frame, and SHALL NOT replay history. `config/changed`, `view/active` and `editor/active` SHALL be delivered only to the subscribed handler and view frames of the plugin named in the payload. A local event SHALL carry the publisher frame's opaque `exo-session` in `from` and SHALL be delivered only to subscribed frames of the publishing plugin. For an editor frame, that `from` value SHALL equal the `editor.instanceId` advertised in its initialization.

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
- **THEN** the init message already carries the current theme, workspace name, the plugin's settings values and, for a view, the active-editor context

#### Scenario: Unrelated subscriber is skipped

- **WHEN** a plugin's settings change while a frame of another plugin is subscribed to `config/changed`
- **THEN** the shell increments the topic sequence as usual and delivers nothing to the unrelated frame

#### Scenario: Local publisher receives its own event when subscribed

- **WHEN** a frame subscribed to `local/state` publishes on `local/state`
- **THEN** it receives its own event with `from` equal to its frame session id and can choose to ignore it

#### Scenario: Editor instance id is the local source

- **WHEN** an editor frame publishes a local event
- **THEN** `from` equals the `editor.instanceId` in its init and the `instanceId` in the active-editor context for that frame

#### Scenario: View frame receives a shell event

- **WHEN** a view frame subscribes to `theme/changed` and the user changes the theme
- **THEN** the view frame receives the same event shape as an editor frame

### Requirement: Change producers

The shell SHALL publish `workspace/file-changed` for changes observed by the
workspace watcher or its polling fallback, for its own successful writes from
either document surface, and for renames, using one observation path and no
second watcher or polling loop. It SHALL publish `theme/changed` when the active
theme value changes, and `workspace/closed` once before handler frames are
disposed. It SHALL publish `config/changed` when a plugin setting changes, after
the shell-owned store accepts the new value, and SHALL NOT publish it to another
plugin. It SHALL publish `editor/active` when the active file tab's plugin editor
changes or clears, after that handler frame is active, and SHALL NOT publish an
active event for a handler that is merely mounted in a background tab.

#### Scenario: External change is published

- **WHEN** the provider reports an external change or the focus poll observes one
- **THEN** subscribed frames receive one `workspace/file-changed` for the path

#### Scenario: Shell save is published

- **WHEN** a document saved from the shell text surface or a plugin editor writes successfully
- **THEN** subscribed frames receive `workspace/file-changed` with kind `changed` and the new version

#### Scenario: Theme change is published

- **WHEN** the user switches the workbench theme
- **THEN** subscribed frames receive `theme/changed` with `dark`, `light` or `high-contrast`

#### Scenario: Closing a workspace

- **WHEN** the shell releases the active workspace before disposal
- **THEN** subscribed frames may receive one `workspace/closed` with `switch` or `close`

#### Scenario: No duplicate observation

- **WHEN** a shell save succeeds
- **THEN** the shell publishes from that save's result and does not also emit a second event for the same write from a watcher or poll

#### Scenario: Reserved configuration topic stays silent

- **WHEN** no plugin setting has changed in the workspace session
- **THEN** no `config/changed` event is published

#### Scenario: Configuration change is published

- **WHEN** the user changes a declared plugin setting and the shell store accepts it
- **THEN** the plugin's subscribed handler frames receive one `config/changed` with the full new values

#### Scenario: Active editor becomes ready

- **WHEN** a plugin editor for the active file tab completes its handshake
- **THEN** subscribed frames receive one `editor/active` with `active: true`, the path and the instance id, and no event is published while the handler is still mounting

#### Scenario: Active editor clears

- **WHEN** the active tab moves to a shell text file, a content view, another plugin's editor or no tab
- **THEN** the previous plugin's subscribed frames receive one `editor/active` with `active: false`

#### Scenario: Editor switch stays within one plugin

- **WHEN** the active tab moves between two files handled by the same plugin and the new handler is active
- **THEN** that plugin's subscribed frames receive `editor/active` with the new path and instance id, without a false event for the previous editor

#### Scenario: New handler is still mounting

- **WHEN** the active tab moves to a file of the same plugin whose handler has not completed its handshake
- **THEN** the previous context clears with `active: false` and the new context is published when the handler becomes ready

#### Scenario: Active editor rename is published

- **WHEN** the active file handled by a plugin is renamed
- **THEN** that plugin's subscribed frames receive `editor/active` with the new path and the same instance id

#### Scenario: Background handler is not announced

- **WHEN** a handler frame becomes active for a file tab that is not the active tab
- **THEN** no `editor/active` event is published for it

#### Scenario: Workspace switch resets the context

- **WHEN** the workspace switches
- **THEN** the event bus resets and no active-editor event from the previous workspace is delivered

### Requirement: Coalescing and ordering

The shell SHALL coalesce changes to the same path within 50 ms, SHALL prefer
`deleted` over `created` over `changed` when coalescing, SHALL report a rename as
a single `renamed` event on the new path, and SHALL emit a document's save result
before its `workspace/file-changed` event. It SHALL deliver the targeted
`shell/file-changed` notification to the bound document's handler immediately
from the same observation, without coalescing, and SHALL keep that
notification's kind, path and version consistent with the coalesced
`workspace/file-changed` event; the topic event SHALL be the only
subscription-channel form.

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

#### Scenario: Bound handler is notified immediately

- **WHEN** the open document's file changes twice within the coalescing window
- **THEN** its handler receives a targeted `shell/file-changed` for each observed change while subscribers receive one coalesced topic event

#### Scenario: Targeted and topic agree

- **WHEN** a change is delivered both as a targeted notification and as a topic event
- **THEN** both carry the same path and kind, and the same version when the kind is not `deleted`

### Requirement: Event versioning

The shell SHALL version shell topics by name only, SHALL allow additive payload fields within protocol major 1, SHALL require a protocol major change for a breaking payload change on an existing shell topic, SHALL keep the shell catalog closed, and SHALL allow plugins to publish only the reserved `local/` namespace with plugin-defined payloads.

#### Scenario: Additive field

- **WHEN** a shell event payload gains an optional field within protocol major 1
- **THEN** existing subscribers continue to work and must tolerate the unknown field

#### Scenario: Plugin publication

- **WHEN** a plugin attempts to publish a shell topic such as `theme/changed`
- **THEN** the shell rejects the message with `permission-denied` and delivers nothing

#### Scenario: Local topic publication

- **WHEN** a plugin publishes a valid `local/` topic
- **THEN** the shell accepts it without adding the topic to the shell catalog and does not interpret its payload

#### Scenario: Local payloads are plugin-defined

- **WHEN** a plugin changes the shape of its own local payload
- **THEN** the shell imposes no schema and only enforces envelope, size and rate limits

### Requirement: Limits and failure isolation

The shell SHALL cap queued events at 1000 per topic per frame and payloads at 1 MiB, SHALL publish at most 100 events per second per topic except for a coalescing burst, SHALL cap one frame's local publication at 200 events per rolling second across all local topics, SHALL drop the oldest queued events and report `rate-limited` once on overflow, SHALL never let event delivery throw into the render path, and SHALL remove a subscriber that fails three deliveries.

#### Scenario: Slow subscriber

- **WHEN** a frame falls 1000 events behind on a topic
- **THEN** the oldest events are dropped, the newest are delivered, and the frame receives one `rate-limited` error for that topic

#### Scenario: Throwing subscriber

- **WHEN** delivering an event to one frame fails or the frame stops acknowledging
- **THEN** the failure is contained, other subscribers still receive the event, and the shell's rendering is unaffected

#### Scenario: Repeated failures

- **WHEN** a frame fails three deliveries
- **THEN** it is removed from the topic's delivery set and the failure is logged with the plugin id

#### Scenario: Local aggregate limit

- **WHEN** a frame publishes more than 200 local events in one rolling second across its topics
- **THEN** the excess publications are rejected with `rate-limited` and no event is delivered for them

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
