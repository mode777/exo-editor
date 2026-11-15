# Spec Delta

## MODIFIED Requirements

### Requirement: V1 topic catalog

The shell SHALL expose exactly `theme/changed` with `{ theme }`,
`workspace/file-changed` with `{ path, kind, version? }`, `workspace/closed` with
`{ reason }` and `config/changed` with `{ pluginId, values }`, and SHALL reject
topic names outside the lowercase `<namespace>/<event>` form made of
`[a-z0-9-]` segments and at most 64 characters. `config/changed` SHALL be
produced when a plugin's contributed settings change and SHALL be delivered only
to that plugin's subscribed handler frames.

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
- **THEN** the subscription is accepted, returns the current sequence and no event
  is delivered yet

#### Scenario: Configuration change

- **WHEN** a plugin's contributed settings change
- **THEN** that plugin's subscribed handler frames receive `config/changed` with its plugin id and the full new values

#### Scenario: Configuration change is targeted

- **WHEN** two plugins have handler frames subscribed to `config/changed` and one
  plugin's settings change
- **THEN** only the named plugin's frames receive the event

#### Scenario: Malformed topic name

- **WHEN** a plugin subscribes to a topic containing uppercase letters,
  characters outside `[a-z0-9-]`, more than one slash or more than 64 characters
- **THEN** the shell replies `unsupported-topic` and delivers nothing

### Requirement: Delivery semantics

The shell SHALL sequence events per topic per workspace session, SHALL deliver at
most once, SHALL deliver independently to each subscribed frame, and SHALL NOT
replay history. `config/changed` SHALL be delivered only to the subscribed
handler frames of the plugin named in the payload.

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

#### Scenario: Unrelated subscriber is skipped

- **WHEN** a plugin's settings change while a frame of another plugin is
  subscribed to `config/changed`
- **THEN** the shell increments the topic sequence as usual and delivers nothing
  to the unrelated frame

### Requirement: Change producers

The shell SHALL publish `workspace/file-changed` for changes observed by the
workspace watcher or its polling fallback, for its own successful writes from
either document surface, and for renames, using one observation path and no
second watcher or polling loop. It SHALL publish `theme/changed` when the active
theme value changes, and `workspace/closed` once before handler frames are
disposed. It SHALL publish `config/changed` when a plugin setting changes, after
the shell-owned store accepts the new value, and SHALL NOT publish it to another
plugin.

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
