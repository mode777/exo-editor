# Spec Delta

## MODIFIED Requirements

### Requirement: Limits and protocol versioning

The shell SHALL enforce a 64-request in-flight limit per frame, a 16 MiB message payload cap, a 64 KiB content-view payload cap, the advertised per-file read cap, a 10-second ready timeout, a 10-second registration timeout, a 5-second save timeout, a 1-second dispose timeout, a budget of three protocol violations before teardown, a maximum of 20 concurrently open handler frames per plugin, a maximum of eight panels per plugin, a maximum of sixteen declared content views per plugin, a maximum of ten open content-view tabs per plugin and a shell-wide maximum of fifty plugin-initiated open file tabs.

#### Scenario: Oversized payload

- **WHEN** a frame sends a message larger than 16 MiB
- **THEN** the shell rejects it with `too-large` and does not buffer it

#### Scenario: Oversized content-view payload

- **WHEN** `plugin/open-view` carries a payload larger than 64 KiB
- **THEN** the shell rejects it with `too-large` and a message naming the actual size and the 64 KiB limit, and opens no tab

#### Scenario: Oversized local event

- **WHEN** a frame publishes a local event whose payload exceeds 1 MiB
- **THEN** the shell rejects it with `too-large` even though the envelope is below the 16 MiB message cap

#### Scenario: Handler frame cap

- **WHEN** a plugin already has 20 handler frames and another matching file opens
- **THEN** the shell mounts no 21st frame and opens that document in the shell fallback renderer with a notice

#### Scenario: Content-view tab cap

- **WHEN** a plugin already has ten content-view tabs open and requests another
- **THEN** the shell replies `rate-limited` with a message and creates no tab

#### Scenario: Plugin-initiated tab cap

- **WHEN** plugin-initiated open requests would exceed fifty open file tabs in one workspace
- **THEN** the shell replies `rate-limited` with a message and opens no further tab

#### Scenario: Repeated violations

- **WHEN** a frame exceeds its protocol-violation budget
- **THEN** the shell reports `protocol-violation` and unloads the frame

#### Scenario: Additive fields within a major

- **WHEN** a message includes an unknown optional field within protocol major 1
- **THEN** the shell ignores the field and processes the known parts

## ADDED Requirements

### Requirement: View frame bootstrap and handshake

The shell SHALL mount view frames with the same sandbox, origin, target-origin, referrer, loading and no-navigation rules as handler frames. A view frame SHALL send `plugin/ready` with the fragment session id, and the shell SHALL reply with `shell/init` carrying `mode: "view"` only after validating origin and source.

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
- **THEN** the payload contains no `file` block, file path, bytes or metadata

### Requirement: View frame initialization

`shell/init` for a view frame SHALL carry a `view` object with `kind` (`panel` or `content`), `id`, `title`, `instanceId`, optional `location`, optional `payload` and optional `openedBy`, plus the plugin's resolved settings, theme, limits and capabilities.

#### Scenario: Panel block

- **WHEN** a panel frame is initialized
- **THEN** `view` carries `kind: "panel"`, its id, title, location and instance id and no payload

#### Scenario: Content block

- **WHEN** a content-view frame is initialized with a payload
- **THEN** `view` carries `kind: "content"`, its id, title, instance id and the payload

#### Scenario: Opened by another plugin

- **WHEN** a plugin opens another plugin's content view
- **THEN** `view.openedBy` carries the caller's plugin id, name and origin and the payload is passed unchanged

#### Scenario: Payload is data

- **WHEN** a content view receives a payload
- **THEN** it is structured-cloneable data with no file content, handle, `File` or `Blob` added by the shell

#### Scenario: View limits

- **WHEN** a view frame is initialized
- **THEN** `limits` carries the read caps that apply to `plugin/request-file` and `plugin/request-list`, and no save limit

#### Scenario: View settings

- **WHEN** a plugin with contributed settings opens a panel or content view
- **THEN** `shell/init` carries the current resolved values

### Requirement: View navigation intents

`plugin/open-file`, `plugin/open-view` and `plugin/request-panel` SHALL be correlated editor- and view-phase requests. The shell SHALL validate that the frame is active and visible, the target path or view or panel, the plugin permission and the per-frame rate limit, and SHALL reply with `shell/open-result`, `shell/panel-result` or `shell/error`.

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

`shell/init` SHALL carry `capabilities.openFile`, `capabilities.openView`, `capabilities.requestPanel` and `capabilities.localEvents` as shell support bits for both editor and view frames. An older shell omits them, and a plugin SHALL treat absence as `false`.

#### Scenario: New shell advertises intents

- **WHEN** a frame receives `shell/init` with the intent support bits true
- **THEN** the plugin may offer the corresponding actions

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.openView` field
- **THEN** the plugin treats view opening as unsupported and keeps its existing behavior

#### Scenario: Support is not permission

- **WHEN** `capabilities.openFile` is true but the manifest lacks `workspace:read`
- **THEN** the shell replies `permission-denied`

#### Scenario: Editor and view frames agree

- **WHEN** an editor frame and a view frame from the same plugin receive `shell/init`
- **THEN** both carry the same support bits and the same permission-derived capabilities

### Requirement: View frame lifecycle and disposal

View frames SHALL mount lazily on first reveal, remain hidden without disposal while inactive, and dispose with `shell/dispose` and `plugin/dispose-ack` on tab close, plugin removal, workspace switch or error, with the same 1-second acknowledgement and late-message rules as handler frames.

#### Scenario: Lazy mount

- **WHEN** a panel is registered but never revealed
- **THEN** no iframe is created for it

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
