# Spec Delta

## Purpose

Defines the typed client for the plugin protocol, its initialization parsing,
capability negotiation and compatibility policy. This delta exposes the bottom
panel location, the editor instance id and the active-editor context.

## MODIFIED Requirements

### Requirement: Editor client

The SDK SHALL expose the initialized file metadata, the opaque editor instance id,
read files by path and encoding with correlated replies, report dirty state,
request a shell save for the bound document, answer save requests with text or
bytes, expose external-change and disposal notifications, and reject outstanding
requests when the frame is disposed.

#### Scenario: Metadata before content

- **WHEN** an editor frame completes its handshake
- **THEN** the SDK exposes the file metadata and no file content until the plugin
  calls the read method

#### Scenario: Editor instance id

- **WHEN** `shell/init` carries `editor.instanceId`
- **THEN** the SDK exposes that value as `EditorClient.instanceId` and uses it only
  as an opaque identifier for local-event targeting

#### Scenario: Older shell omits the instance id

- **WHEN** `shell/init` has no `editor` block
- **THEN** the SDK exposes `instanceId` as `null` and keeps the editor usable

#### Scenario: Read round trip

- **WHEN** the plugin reads a relative or absolute path
- **THEN** the SDK sends one `plugin/request-file` and resolves that request from
  the matching `shell/file-content`

#### Scenario: Read error

- **WHEN** the shell replies with `shell/error` for a read
- **THEN** the SDK rejects that read with the stable error code and leaves other
  pending requests untouched

#### Scenario: Dirty report

- **WHEN** the plugin reports a dirty or clean state
- **THEN** the SDK sends one `plugin/dirty` with the boolean value

#### Scenario: Request a save

- **WHEN** the plugin calls `requestSave()`
- **THEN** the SDK sends one id-less `plugin/request-save` notification with no
  content and does not create a correlated pending request

#### Scenario: Save request and result

- **WHEN** the shell sends `shell/request-save`
- **THEN** the SDK invokes the plugin's save handler, answers with
  `plugin/save-content` using the request's id as `replyTo`, and resolves the
  plugin's save call from the matching `shell/save-result`

#### Scenario: No save handler

- **WHEN** the shell requests a save but the plugin registered no save handler
- **THEN** the SDK sends no content and the shell's five-second timeout leaves
  the document dirty instead of writing an empty or invented payload

#### Scenario: External change notification

- **WHEN** the shell sends `shell/file-changed`
- **THEN** the SDK delivers its path, kind and optional version to the plugin
  without changing the plugin's dirty state

#### Scenario: Disposal

- **WHEN** the shell sends `shell/dispose`
- **THEN** the SDK rejects every outstanding request, marks the client closed,
  sends `plugin/dispose-ack` once, and ignores later messages

### Requirement: View connection and client

The SDK SHALL accept `exo-mode=view` in the browser fragment, SHALL perform the same handshake and sender validation as editor mode, SHALL return a `{ mode: 'view' }` connection with the typed `ViewInit`, SHALL expose the initial `activeContentView`, `activeEditor` and `view.location` (including `bottom`), SHALL type the `view/active` and `editor/active` topics, and SHALL expose a `ViewClient` with mediated reads, listings, file picker, local events, navigation intents and panel requests.

#### Scenario: View mode is parsed

- **WHEN** the fragment carries `exo-mode=view`
- **THEN** the SDK starts a view connection instead of rejecting the mode

#### Scenario: View handshake

- **WHEN** the shell replies with `shell/init` carrying `mode: "view"` and the matching session id
- **THEN** the SDK exposes the view block, active content view, active editor, plugin, shell, workspace, theme, permissions, settings, limits and capabilities

#### Scenario: Bottom panel view

- **WHEN** `shell/init.view.location` is `"bottom"`
- **THEN** the SDK accepts it and exposes the panel as a bottom view

#### Scenario: View reads

- **WHEN** the plugin calls `readFile()` or `listDirectory()` from a view frame
- **THEN** the SDK uses the same correlated request and reply handling as `EditorClient`

#### Scenario: No save or dirty methods

- **WHEN** a plugin holds a view connection
- **THEN** the SDK exposes no save, dirty or `shell/request-save` handling for that client

#### Scenario: View initialization is immutable

- **WHEN** a content view opens with a payload
- **THEN** the SDK exposes the payload and instance id for the lifetime of the connection and does not fetch or rewrite them

#### Scenario: Active content-view context

- **WHEN** `shell/init` carries `activeContentView` or a subscribed frame receives `view/active`
- **THEN** the SDK exposes the validated content-view instance or `null` and leaves routing decisions to the plugin

#### Scenario: Active editor context

- **WHEN** `shell/init` carries `activeEditor` or a subscribed frame receives `editor/active`
- **THEN** the SDK exposes the validated plugin id, path and instance id or `null` and leaves routing decisions to the plugin

#### Scenario: Editor context is metadata

- **WHEN** the SDK exposes `activeEditor`
- **THEN** it contains no file content, bytes, handle or save method

#### Scenario: View disposal

- **WHEN** the shell sends `shell/dispose` to a view frame
- **THEN** the SDK rejects outstanding requests, sends `plugin/dispose-ack` once and ignores later messages

### Requirement: View capability negotiation

The SDK SHALL expose `capabilities.openFile`, `capabilities.openView`, `capabilities.requestPanel`, `capabilities.localEvents` and `capabilities.editorContext` as booleans, SHALL parse an absent bit as `false`, and SHALL NOT infer support from the shell version, another capability or the manifest permissions.

#### Scenario: New shell advertises view intents

- **WHEN** `shell/init` carries the view intent support bits as true
- **THEN** the SDK exposes them and allows the helpers after their permission checks

#### Scenario: New shell advertises editor context

- **WHEN** `shell/init` carries `capabilities.editorContext: true`
- **THEN** the SDK exposes it and allows the plugin to read `instanceId`/`activeEditor` and subscribe to `editor/active`

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the SDK exposes `false` and the corresponding helper or context rejects locally

#### Scenario: Permission is separate

- **WHEN** `capabilities.openFile` is true but the plugin lacks `workspace:read`
- **THEN** `openFile()` rejects locally with `permission-denied` and sends no message

#### Scenario: View and editor agree

- **WHEN** the same plugin opens an editor and a view frame
- **THEN** both initializations expose the same support bits

#### Scenario: Additive minor

- **WHEN** the view client and helpers ship
- **THEN** the SDK takes an additive minor version, the protocol major remains `1`, and existing editor methods keep their behavior

## ADDED Requirements

### Requirement: Bottom panel capability

The SDK SHALL expose `capabilities.bottomPanel` on registration initializations,
SHALL parse an absent bit as `false`, and SHALL NOT infer bottom-panel support
from the shell version or another capability. The SDK SHALL also accept
`view.location: "bottom"` in a view initialization.

#### Scenario: Registration support

- **WHEN** a registration frame receives `capabilities.bottomPanel: true`
- **THEN** the SDK exposes the bit and the controller may register a declared bottom panel

#### Scenario: Older shell omits support

- **WHEN** a registration `shell/init` has no `capabilities.bottomPanel` field
- **THEN** the SDK exposes `false` and does not infer support from the shell version

#### Scenario: Bottom view initialization

- **WHEN** a view frame receives `view.location: "bottom"`
- **THEN** the SDK exposes the bottom location without rejecting the initialization

#### Scenario: Older SDK location behavior is explicit

- **WHEN** a plugin uses a bottom panel with an SDK that predates this location
- **THEN** that SDK rejects the unknown location, so the plugin declares SDK `1.10.0` or a client that accepts it
