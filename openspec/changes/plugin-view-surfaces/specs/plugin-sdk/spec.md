# Spec Delta

## ADDED Requirements

### Requirement: View connection and client

The SDK SHALL accept `exo-mode=view` in the browser fragment, SHALL perform the same handshake and sender validation as editor mode, SHALL return a `{ mode: 'view' }` connection with the typed `ViewInit`, and SHALL expose a `ViewClient` with mediated reads, listings, file picker, local events, navigation intents and panel requests.

#### Scenario: View mode is parsed

- **WHEN** the fragment carries `exo-mode=view`
- **THEN** the SDK starts a view connection instead of rejecting the mode

#### Scenario: View handshake

- **WHEN** the shell replies with `shell/init` carrying `mode: "view"` and the matching session id
- **THEN** the SDK exposes the view block, plugin, shell, workspace, theme, permissions, settings, limits and capabilities

#### Scenario: View reads

- **WHEN** the plugin calls `readFile()` or `listDirectory()` from a view frame
- **THEN** the SDK uses the same correlated request and reply handling as `EditorClient`

#### Scenario: No save or dirty methods

- **WHEN** a plugin holds a view connection
- **THEN** the SDK exposes no save, dirty or `shell/request-save` handling for that client

#### Scenario: View initialization is immutable

- **WHEN** a content view opens with a payload
- **THEN** the SDK exposes the payload and instance id for the lifetime of the connection and does not fetch or rewrite them

#### Scenario: View disposal

- **WHEN** the shell sends `shell/dispose` to a view frame
- **THEN** the SDK rejects outstanding requests, sends `plugin/dispose-ack` once and ignores later messages

### Requirement: View registration

`RegistrationClient` SHALL let a controller register declared panel and content-view ids, SHALL send them in `plugin/register`, and SHALL expose the shell's accepted contributions and per-kind rejection reasons from `shell/register-ack`.

#### Scenario: Register a panel

- **WHEN** a controller registers a declared panel id and completes
- **THEN** the SDK sends the id in `plugin/register` and the acknowledgement exposes the accepted panel

#### Scenario: Register a content view

- **WHEN** a controller registers a declared content-view id
- **THEN** the SDK sends the id and the acknowledgement exposes the accepted view

#### Scenario: Undeclared id

- **WHEN** the shell rejects a panel or content-view id with `not-declared`
- **THEN** the SDK exposes the kind, index, reason and optional message without discarding accepted contributions

#### Scenario: Registration only in register mode

- **WHEN** an editor or view client is asked to register a panel or content view
- **THEN** the SDK rejects the call locally and sends no registration message

#### Scenario: Additive acknowledgement

- **WHEN** the shell's `shell/register-ack` carries the existing `accepted` globs and the new contribution list
- **THEN** the SDK preserves both and does not reinterpret the glob list

### Requirement: View navigation and panel helpers

The SDK SHALL expose `openFile(path)`, `openView(options)` and `requestPanel(panel, action)` on both `EditorClient` and `ViewClient`, SHALL preflight the support bit, permission, target shape and 64 KiB payload before sending, and SHALL resolve each helper from its correlated result or reject with the shell's stable error code.

#### Scenario: Open a file

- **WHEN** the plugin calls `openFile('/src/a.ts')`
- **THEN** the SDK sends one `plugin/open-file` with a fresh id and resolves from `shell/open-result`

#### Scenario: Relative path deprecation

- **WHEN** an editor client calls `openFile('./sibling.ts')`
- **THEN** the SDK sends the path unchanged and lets the shell resolve it against the document, while a view client rejects a relative path locally with `permission-denied`

#### Scenario: Cross-plugin open

- **WHEN** the plugin calls `openView({ pluginId: 'com.example.other', viewId: 'tutorial', payload: { chapter: 2 } })`
- **THEN** the SDK sends one `plugin/open-view` and resolves from `shell/open-result`

#### Scenario: Same-plugin open

- **WHEN** the plugin calls `openView({ viewId: 'tutorial' })`
- **THEN** the SDK omits `pluginId` and the shell targets the caller's own plugin

#### Scenario: Payload limit

- **WHEN** the payload exceeds 64 KiB
- **THEN** the SDK rejects locally with `too-large` and a message naming the actual size and the limit, and sends no message

#### Scenario: Unsupported shell

- **WHEN** the relevant `capabilities.openFile`, `openView` or `requestPanel` bit is absent
- **THEN** the helper rejects with `unsupported-message` and sends no message

#### Scenario: Panel request

- **WHEN** the plugin calls `requestPanel('outline', 'show')`
- **THEN** the SDK sends one `plugin/request-panel` and resolves with the panel id and resulting open state

#### Scenario: Hidden frame is rejected

- **WHEN** the shell replies `permission-denied` because the frame is hidden or inactive
- **THEN** the helper rejects with that code and the plugin keeps its current layout

#### Scenario: Disposal

- **WHEN** the frame is disposed while a navigation or panel request is pending
- **THEN** the SDK rejects the call with `closed` and sends no further message

### Requirement: View capability negotiation

The SDK SHALL expose `capabilities.openFile`, `capabilities.openView`, `capabilities.requestPanel` and `capabilities.localEvents` as booleans, SHALL parse an absent bit as `false`, and SHALL NOT infer support from the shell version, another capability or the manifest permissions.

#### Scenario: New shell advertises view intents

- **WHEN** `shell/init` carries the view intent support bits as true
- **THEN** the SDK exposes them and allows the helpers after their permission checks

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the SDK exposes `false` and the corresponding helper rejects locally

#### Scenario: Permission is separate

- **WHEN** `capabilities.openFile` is true but the plugin lacks `workspace:read`
- **THEN** `openFile()` rejects locally with `permission-denied` and sends no message

#### Scenario: View and editor agree

- **WHEN** the same plugin opens an editor and a view frame
- **THEN** both initializations expose the same support bits

#### Scenario: Additive minor

- **WHEN** the view client and helpers ship
- **THEN** the SDK takes an additive minor version `1.5.0`, the protocol major remains `1`, and existing editor methods keep their behavior
