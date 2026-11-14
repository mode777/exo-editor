# Spec Delta

## Purpose

Defines the only channel between the shell and plugin iframes: a versioned
`postMessage` protocol with a validated envelope, a bounded handshake, a
throwaway registration phase and per-document handler sessions that move content
only on request.

## ADDED Requirements

### Requirement: Validated envelope

Every message SHALL be an object carrying the protocol marker `exo: 1`, a
namespaced `type`, optional `id` and `replyTo`, and an optional structured-cloneable
payload. The shell SHALL validate the event source against the frame's
`contentWindow`, validate the origin according to the sandbox mode, and validate
the envelope shape before acting, SHALL ignore unknown types, and SHALL not reply
to messages that fail origin or source validation.

#### Scenario: Foreign origin is dropped

- **WHEN** a cross-origin frame sends a message from an origin other than its manifest origin
- **THEN** the shell drops it without replying and does not mutate plugin state

#### Scenario: Opaque origin is bound to the frame

- **WHEN** a same-origin plugin runs with `allow-scripts` only and reports `event.origin` as `"null"`
- **THEN** the shell accepts the message only if `event.source` is the exact iframe and `plugin/ready` echoed the frame's session id

#### Scenario: Unknown type

- **WHEN** a message has a valid origin and source but an unknown `type`
- **THEN** the shell ignores it and, if it carried an `id`, replies with `shell/error` code `unsupported-message`

#### Scenario: Request correlation

- **WHEN** a plugin answers with a `replyTo` that does not match a live request
- **THEN** the shell discards the answer and the original request remains pending or times out

### Requirement: Bootstrap and handshake

The shell SHALL mount plugin frames hidden with no top navigation, popups, modals,
downloads or fullscreen, and `referrerpolicy="no-referrer"`, SHALL apply
`sandbox="allow-scripts allow-same-origin"` to cross-origin plugin origins and
`sandbox="allow-scripts"` to plugin origins equal to the shell origin, SHALL pass
the shell origin and session id in the URL fragment, and SHALL send `shell/init`
only after receiving a valid `plugin/ready`.

#### Scenario: Ready starts the session

- **WHEN** a plugin frame sends `plugin/ready` with a supported protocol version
- **THEN** the shell replies with `shell/init` containing the mode, session id, plugin identity, shell version and origin, workspace name, theme, permissions and locale

#### Scenario: Same-origin plugin gets the stricter sandbox

- **WHEN** a plugin is served from the shell origin
- **THEN** its iframe is created with `sandbox="allow-scripts"` and no `allow-same-origin`, so it has an opaque origin, no storage and no parent DOM access

#### Scenario: Ready timeout

- **WHEN** `plugin/ready` does not arrive within 10 seconds of mounting
- **THEN** the shell reports `timeout` naming the plugin and phase, removes the iframe and rolls back any partial state

#### Scenario: Protocol major mismatch

- **WHEN** a plugin reports a protocol major the shell does not support
- **THEN** the shell replies with `unsupported-version`, mounts nothing further and unloads the frame

#### Scenario: Ready from the wrong source

- **WHEN** a message shaped like `plugin/ready` arrives from the expected origin but not from the mounted frame's window
- **THEN** it is dropped and counts toward the frame's protocol-violation budget

### Requirement: Registration phase

The shell SHALL accept zero or more additive `plugin/register` messages followed
by exactly one `plugin/register-complete`, SHALL accept only globs declared by the
manifest and entry pages inside the approved plugin root, SHALL NOT allow a
registration to add a glob or load a page outside the root, SHALL send
`shell/register-ack` with accepted and rejected entries, and SHALL unload the
registration frame after acknowledging.

#### Scenario: Registrations activate only on completion

- **WHEN** a plugin registers globs but never sends `plugin/register-complete`
- **THEN** no registration becomes active and the frame is removed at the registration timeout

#### Scenario: Undeclared capability

- **WHEN** a plugin registers a file editor although its manifest declares no `fileEditors` contribution
- **THEN** the entry is rejected with `not-declared` and listed in the acknowledgement

#### Scenario: Declared editor is activated

- **WHEN** a plugin registers a declared glob with an entry inside the plugin root
- **THEN** the pair is accepted and becomes active after `plugin/register-complete`

#### Scenario: Registration cannot add globs

- **WHEN** a plugin registers a glob the manifest did not declare
- **THEN** that entry is rejected with `not-declared` and the manifest's approved glob set is unchanged

#### Scenario: Registration cannot escape the root

- **WHEN** a plugin registers an entry outside the plugin root
- **THEN** that entry is rejected with `permission-denied` before any URL reaches the browser

#### Scenario: Registration may narrow the manifest

- **WHEN** a manifest declares three editors and the plugin registers one of them
- **THEN** only that editor becomes active and the other two remain available but unregistered

#### Scenario: Invalid glob

- **WHEN** a registration contains an invalid glob
- **THEN** that entry is rejected with `invalid-glob` and the remaining valid entries still activate

#### Scenario: Frame is gone afterwards

- **WHEN** the acknowledgement is sent
- **THEN** the registration iframe is removed within 250 ms and contributes no further messages

### Requirement: Handler initialization without content

For an open document the shell SHALL mount a fresh handler frame using the
registered editor entry for the matched contribution, which must be inside the
plugin root, repeat the handshake, and include in `shell/init` a file block
containing the path, name, directory, size, mtime, version, optional language
hint, capabilities and limits, and SHALL NOT include file content.

#### Scenario: Registered editor page is mounted

- **WHEN** a registration maps a glob to `editors/code.html` inside the plugin root
- **THEN** the handler iframe loads that page, not the controller entry

#### Scenario: Metadata only

- **WHEN** a handler frame receives its initialization message
- **THEN** the payload contains metadata and no file bytes, text or blob

#### Scenario: Content requires a request

- **WHEN** the plugin has not sent `plugin/request-file`
- **THEN** the shell has sent no content for that document

### Requirement: On-demand mediated reads

The shell SHALL serve `plugin/request-file` only for paths that resolve inside the
workspace, are not reserved, satisfy the plugin's permissions and fit the
declared size limits, resolving relative paths against the handler file's
directory and treating a leading `/` as workspace-absolute.

#### Scenario: Relative resolution

- **WHEN** a handler for `/src/editor.ts` requests `./types.ts`
- **THEN** the shell reads `/src/types.ts` after normalization

#### Scenario: Escape attempt

- **WHEN** a request resolves outside the workspace root
- **THEN** the shell replies with `permission-denied` and performs no read

#### Scenario: Reserved path

- **WHEN** a handler requests `/exo.json`
- **THEN** the shell replies with `permission-denied` and returns neither content nor metadata

#### Scenario: Size limit

- **WHEN** a requested file exceeds the handler's `maxRequestBytes`
- **THEN** the shell replies with `too-large` and does not transfer partial content

#### Scenario: Missing permission

- **WHEN** a plugin without `workspace:read` requests a file
- **THEN** the shell replies with `permission-denied`

### Requirement: Dirty state and save flow

The shell SHALL track dirty state only from `plugin/dirty`, SHALL allow at most
one in-flight save request plus one queued request, SHALL write with the version
it last delivered, and SHALL leave the document dirty when the write conflicts or
times out.

#### Scenario: Dirty drives the tab

- **WHEN** a handler reports `plugin/dirty` with `true`
- **THEN** the tab shows an unsaved indicator and closing it prompts for confirmation

#### Scenario: Save round trip

- **WHEN** the shell sends `shell/request-save` and the plugin answers with content within 5 seconds
- **THEN** the shell writes with `ifVersion`, returns `shell/save-result` with the new version, and clears dirty only if the plugin has not reported dirty again

#### Scenario: Conflict

- **WHEN** the file changed on disk since the handler last read it
- **THEN** the write fails with `conflict`, the on-disk content is preserved, and the tab remains dirty

#### Scenario: Save timeout

- **WHEN** the plugin does not answer `shell/request-save` within 5 seconds
- **THEN** the save fails with `timeout`, no write occurs, and the tab remains dirty

#### Scenario: Own save ordering

- **WHEN** a save succeeds
- **THEN** `shell/save-result` is delivered before the corresponding `workspace/file-changed` event

### Requirement: Disposal and cancellation

The shell SHALL dispose a handler session on tab close, plugin removal, workspace
switch or error with a reason, SHALL wait up to 1 second for
`plugin/dispose-ack`, then remove the frame, and SHALL accept no further messages
from a disposed session.

#### Scenario: Tab close

- **WHEN** a tab handled by a plugin is closed
- **THEN** the shell sends `shell/dispose`, removes the frame after the acknowledgement or the 1-second limit, and creates a new frame if the tab is reopened

#### Scenario: Workspace switch during save

- **WHEN** a workspace switch occurs while a save is in flight
- **THEN** the save is cancelled, no write is attempted against the old workspace, and the handler is disposed before the workspace session is released

#### Scenario: Late message

- **WHEN** a message arrives from a frame after its session was disposed
- **THEN** the shell drops it and does not re-create state

### Requirement: Limits and protocol versioning

The shell SHALL enforce a 64-request in-flight limit per frame, a 16 MiB payload
cap, the advertised per-file read cap, a 10-second ready timeout, a 10-second
registration timeout, a 5-second save timeout, a 1-second dispose timeout, a
budget of three protocol violations before teardown, and a maximum of 20
concurrently open handler frames per plugin.

#### Scenario: Oversized payload

- **WHEN** a frame sends a message larger than 16 MiB
- **THEN** the shell rejects it with `too-large` and does not buffer it

#### Scenario: Handler frame cap

- **WHEN** a plugin already has 20 handler frames and another matching file opens
- **THEN** the shell mounts no 21st frame and opens that document in the shell fallback renderer with a notice

#### Scenario: Repeated violations

- **WHEN** a frame exceeds its protocol-violation budget
- **THEN** the shell reports `protocol-violation` and unloads the frame

#### Scenario: Additive fields within a major

- **WHEN** a message includes an unknown optional field within protocol major 1
- **THEN** the shell ignores the field and processes the known parts
