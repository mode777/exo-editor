# Spec Delta

## Purpose

Defines how plugins learn about shell state changes: the subscription messages,
the closed v1 topic catalog, ordering and coalescing rules, and the limits that
keep one slow subscriber from affecting the shell or another plugin. This delta
adds the targeted active-editor topic used by editor-bound panels.

## MODIFIED Requirements

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
