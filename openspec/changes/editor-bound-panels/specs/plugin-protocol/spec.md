# Spec Delta

## Purpose

Defines the plugin protocol: frame bootstrap, initialization, capabilities,
navigation and panel intents, view lifecycle and compatibility. This delta adds
the bottom panel location, the editor instance id and the active-editor context
while keeping the message shapes and protocol major unchanged.

## MODIFIED Requirements

### Requirement: Handler initialization without content

For an open document the shell SHALL mount a fresh handler frame using the
registered editor entry for the matched contribution, which must be inside the
plugin root, repeat the handshake, and include in `shell/init` a file block
containing the path, name, directory, size, mtime, version and optional language
hint, an `editor` block with an opaque shell-assigned `instanceId` for this
handler frame, capabilities and limits, and SHALL NOT include file content.

#### Scenario: Registered editor page is mounted

- **WHEN** a registration maps a glob to `editors/code.html` inside the plugin root
- **THEN** the handler iframe loads that page, not the controller entry

#### Scenario: Metadata only

- **WHEN** a handler frame receives its initialization message
- **THEN** the payload contains metadata and no file bytes, text or blob

#### Scenario: Editor instance id

- **WHEN** a handler frame completes its handshake
- **THEN** `shell/init.editor.instanceId` is present, opaque and stable for the lifetime of that frame

#### Scenario: Remount gets a new instance id

- **WHEN** a handler frame is reopened, retried or replaced by another matching editor
- **THEN** the new frame receives a different `editor.instanceId` and the old frame receives no further messages

#### Scenario: Content requires a request

- **WHEN** the plugin has not sent `plugin/request-file`
- **THEN** the shell has sent no content for that document

### Requirement: View frame bootstrap and handshake

The shell SHALL mount view frames with the same sandbox, origin, target-origin, referrer, loading and no-navigation rules as handler frames. A view frame SHALL send `plugin/ready` with the fragment session id, and the shell SHALL reply with `shell/init` carrying `mode: "view"` only after validating origin and source. The initialization SHALL NOT carry a `file` block, file content, bytes or a handle; `activeEditor.path` is metadata only.

#### Scenario: Cross-origin view sandbox

- **WHEN** a view frame is served from a plugin origin different from the shell origin
- **THEN** it is mounted with `sandbox="allow-scripts allow-same-origin"`, no top navigation, no popups and no fullscreen

#### Scenario: Same-origin view sandbox

- **WHEN** a view frame is served from the shell origin
- **THEN** it is mounted with `sandbox="allow-scripts"` only and has no storage, cookies or parent DOM access

#### Scenario: View ready

- **WHEN** a view frame sends `plugin/ready` with the matching protocol major, mode and session id
- **THEN** the shell replies with the view-mode `shell/init`

#### Scenario: View timeout

- **WHEN** a view frame does not send `plugin/ready` within 10 seconds
- **THEN** the shell reports `timeout` naming the plugin and view, removes the frame and leaves the panel or tab in an error state

#### Scenario: Wrong view origin

- **WHEN** a message arrives from the expected view origin but not the mounted frame's window
- **THEN** the shell drops it and counts it toward the frame's violation budget

#### Scenario: View target origin

- **WHEN** the shell sends `shell/init` to a cross-origin view frame
- **THEN** `postMessage` uses the plugin's exact origin and never `*`

#### Scenario: View init carries no file

- **WHEN** a view frame receives `shell/init`
- **THEN** the payload contains no `file` block, file content, bytes, `File`, `Blob` or handle; `activeEditor.path` is metadata only

### Requirement: View frame initialization

`shell/init` for a view frame SHALL carry a `view` object with `kind` (`panel` or `content`), `id`, `title`, `instanceId`, optional `location` (`primary`, `secondary` or `bottom`), optional `payload` and optional `openedBy`, an `activeEditor` object with `pluginId`, `path` and `instanceId` or `null`, plus the plugin's resolved settings, theme, limits and capabilities.

#### Scenario: Panel block

- **WHEN** a panel frame is initialized
- **THEN** `view` carries `kind: "panel"`, its id, title, location and instance id and no payload

#### Scenario: Bottom panel block

- **WHEN** a bottom panel frame is initialized
- **THEN** `view.location` is `"bottom"` and the frame receives no payload

#### Scenario: Content block

- **WHEN** a content-view frame is initialized with a payload
- **THEN** `view` carries `kind: "content"`, its id, title, instance id and the payload

#### Scenario: Active editor block

- **WHEN** a view frame initializes while the active tab is a file handled by an active editor of the same plugin identity
- **THEN** `activeEditor` carries that plugin id, workspace path and editor instance id

#### Scenario: No active editor

- **WHEN** the active tab is another plugin's editor, a shell text file, a content view or no tab
- **THEN** `activeEditor` is `null`

#### Scenario: Opened by another plugin

- **WHEN** a plugin opens another plugin's content view
- **THEN** `view.openedBy` carries the caller's plugin id, name and origin and the payload is passed unchanged

#### Scenario: Payload is data

- **WHEN** a content view receives a payload
- **THEN** it is structured-cloneable data with no file content, handle, `File` or `Blob` added by the shell

#### Scenario: Active editor is metadata

- **WHEN** a view frame receives `activeEditor`
- **THEN** it contains only the plugin id, path and instance id, with no bytes, handle or save path

#### Scenario: View limits

- **WHEN** a view frame is initialized
- **THEN** `limits` carries the read caps that apply to `plugin/request-file` and `plugin/request-list`, and no save limit

#### Scenario: View settings

- **WHEN** a plugin with contributed settings opens a panel or content view
- **THEN** `shell/init` carries the current resolved values

### Requirement: View navigation intents

`plugin/open-file`, `plugin/open-view` and `plugin/request-panel` SHALL be correlated editor- and view-phase requests. The shell SHALL validate that the frame is active and visible, the target path or view or panel, the plugin permission and the per-frame rate limit, and SHALL reply with `shell/open-result`, `shell/panel-result` or `shell/error`. A panel request SHALL resolve the panel's manifest location, including `bottom`, without changing the message shape.

#### Scenario: Open-file request

- **WHEN** an active view or editor frame with `workspace:read` sends `plugin/open-file` with a valid path
- **THEN** the shell opens or activates the file tab and replies `shell/open-result` with the request id in `replyTo`

#### Scenario: Relative editor path

- **WHEN** an editor frame for `/src/editor.ts` opens `./types.ts`
- **THEN** the shell resolves `/src/types.ts`

#### Scenario: View path is absolute

- **WHEN** a view frame opens `types.ts` without a leading slash
- **THEN** the shell replies `permission-denied` and opens nothing

#### Scenario: Reserved path

- **WHEN** an intent names `/exo.json` or a path under `/.exo/`
- **THEN** the shell replies `permission-denied` and opens nothing

#### Scenario: Missing read permission

- **WHEN** a frame whose plugin lacks `workspace:read` sends `plugin/open-file`
- **THEN** the shell replies `permission-denied` and performs no read

#### Scenario: Missing or directory path

- **WHEN** the requested path does not exist or is a directory
- **THEN** the shell replies `not-found` or `not-a-file` and opens no tab

#### Scenario: Open-view request

- **WHEN** an active frame sends `plugin/open-view` for a registered content view
- **THEN** the shell opens or activates the tab and replies `shell/open-result`

#### Scenario: Panel request

- **WHEN** an active frame sends `plugin/request-panel` for its own registered panel
- **THEN** the shell applies `show`, `hide` or `toggle` and replies `shell/panel-result` with the panel id and resulting open state

#### Scenario: Bottom panel request

- **WHEN** an active frame sends `plugin/request-panel` for its own registered bottom panel
- **THEN** the shell shows, hides or toggles the bottom region, activates that panel for a show or opening toggle, and replies with the resulting open state

#### Scenario: Unknown panel

- **WHEN** a frame requests a panel its plugin did not register
- **THEN** the shell replies `not-found` and changes no layout

#### Scenario: Hidden frame

- **WHEN** a frame that is not visible or active sends any navigation or panel intent
- **THEN** the shell replies `permission-denied` and performs no action

#### Scenario: Intent rate limit

- **WHEN** a frame exceeds ten navigation or panel requests in a rolling second
- **THEN** the shell replies `rate-limited` and performs no action for the excess

#### Scenario: Invalid intent shape

- **WHEN** an intent lacks an `id`, carries an unknown field or has a non-string path or target
- **THEN** the shell treats it as a protocol violation and performs no action

### Requirement: View and intent capability negotiation

`shell/init` SHALL carry `capabilities.openFile`, `capabilities.openView`, `capabilities.requestPanel`, `capabilities.localEvents` and `capabilities.editorContext` as shell support bits for both editor and view frames. `capabilities.editorContext` SHALL be true when the shell sends `editor.instanceId` and `activeEditor` and publishes `editor/active`. An older shell omits them, and a plugin SHALL treat absence as `false`.

#### Scenario: New shell advertises intents

- **WHEN** a frame receives `shell/init` with the intent support bits true
- **THEN** the plugin may offer the corresponding actions

#### Scenario: New shell advertises editor context

- **WHEN** an editor or view frame receives `capabilities.editorContext: true`
- **THEN** the plugin may read `editor.instanceId` or `activeEditor` and subscribe to `editor/active`

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.openView` or `capabilities.editorContext` field
- **THEN** the plugin treats view opening or editor context as unsupported and keeps its existing behavior

#### Scenario: Support is not permission

- **WHEN** `capabilities.openFile` is true but the manifest lacks `workspace:read`
- **THEN** the shell replies `permission-denied`

#### Scenario: Editor and view frames agree

- **WHEN** an editor frame and a view frame from the same plugin receive `shell/init`
- **THEN** both carry the same support bits and the same permission-derived capabilities

### Requirement: View frame lifecycle and disposal

View frames SHALL mount lazily on first reveal, remain hidden without disposal while inactive, and dispose with `shell/dispose` and `plugin/dispose-ack` on tab close, plugin removal, workspace switch or error, with the same 1-second acknowledgement and late-message rules as handler frames. A bottom panel frame SHALL mount only when its tab becomes the active bottom tab.

#### Scenario: Lazy mount

- **WHEN** a panel is registered but never revealed
- **THEN** no iframe is created for it

#### Scenario: Inactive bottom tab

- **WHEN** a bottom panel tab is not the active bottom tab
- **THEN** its iframe is not created until that tab becomes active

#### Scenario: Hide without disposal

- **WHEN** a panel or content view becomes inactive
- **THEN** the shell hides its iframe and sends no `shell/dispose`

#### Scenario: Close disposes

- **WHEN** a content-view tab is closed
- **THEN** the shell sends `shell/dispose` with `closed` and removes the frame after the acknowledgement or the 1-second limit

#### Scenario: Plugin removal disposes

- **WHEN** a plugin is disabled, removed or revoked
- **THEN** every view frame of that plugin is disposed and its content-view tabs are closed

#### Scenario: Workspace switch disposes

- **WHEN** the workspace switches
- **THEN** every view frame is disposed before the old session is released

#### Scenario: Late view message

- **WHEN** a message arrives from a disposed view frame
- **THEN** the shell drops it and does not recreate the panel or tab

## ADDED Requirements

### Requirement: Bottom panel capability negotiation

Registration `shell/init` SHALL carry `capabilities.bottomPanel` as the shell support bit for the bottom panel location. An older shell SHALL omit it, and a plugin SHALL treat absence as `false`. The bit SHALL NOT change the manifest engine requirement: a manifest that declares a bottom panel SHALL still declare an `engines.exo` range that excludes shells without the location.

#### Scenario: New shell advertises bottom panels

- **WHEN** a registration frame receives `capabilities.bottomPanel: true`
- **THEN** the controller may register a declared bottom panel

#### Scenario: Older shell omits bottom panels

- **WHEN** a registration `shell/init` has no `capabilities.bottomPanel` field
- **THEN** the plugin treats the location as unsupported and registers no bottom panel

#### Scenario: Support is not permission

- **WHEN** `capabilities.bottomPanel` is true
- **THEN** no new permission is granted and the plugin's workspace access is unchanged

#### Scenario: Engine guard is still required

- **WHEN** a manifest declares a bottom panel but its `engines.exo` includes an older shell
- **THEN** the older shell reports `incompatible-engine` before it can read `capabilities.bottomPanel`
