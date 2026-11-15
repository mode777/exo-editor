# plugin-protocol Specification

## Purpose
Defines the only channel between the shell and plugin iframes: a versioned
`postMessage` protocol with a validated envelope, a bounded handshake, a
throwaway registration phase and per-document handler sessions that move content
only on request.

## Requirements

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

#### Scenario: Message from the wrong phase

- **WHEN** a registration frame sends a handler message, or an editor frame sends
  a registration message
- **THEN** the shell replies `protocol-violation`, performs no state change and
  counts the message toward the frame's violation budget

#### Scenario: Registration is closed on completion

- **WHEN** a plugin sends `plugin/register` after `plugin/register-complete`
- **THEN** the registration is rejected as a protocol violation and the approved
  editor set is unchanged

#### Scenario: Duplicate ready

- **WHEN** a frame sends `plugin/ready` a second time
- **THEN** the shell treats it as a protocol violation and does not reinitialize
  the frame

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

#### Scenario: Frame fails to load

- **WHEN** the iframe fires `error` or the document never loads
- **THEN** the shell reports `loading-failed`, removes the frame and rolls back partial state

#### Scenario: Repeated origin violations

- **WHEN** a frame sends three messages from the wrong origin
- **THEN** the shell removes it with `protocol-violation`

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

#### Scenario: No contributions

- **WHEN** a plugin registers nothing and completes
- **THEN** it is recorded as a configuration-only or event-only plugin and no
  editor is created for it

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
one in-flight save request plus one queued request, SHALL accept
`plugin/save-content` only when it answers the live `shell/request-save`, SHALL
treat the content as opaque text or bytes without parsing it, SHALL echo the
request id in `shell/save-result`, SHALL write with the version it last delivered,
and SHALL leave the document dirty when the write conflicts or times out.

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

#### Scenario: Unsolicited save content

- **WHEN** a handler sends `plugin/save-content` without a live `shell/request-save`
- **THEN** the shell performs no write, ignores the content, and counts a protocol violation

#### Scenario: Save result correlation

- **WHEN** the shell accepts save content
- **THEN** `shell/save-result` carries a `replyTo` equal to the request's `id`

#### Scenario: Content is opaque

- **WHEN** `plugin/save-content` arrives
- **THEN** the shell writes the text or bytes unchanged and never parses, formats or validates the editor's syntax

#### Scenario: Own save ordering

- **WHEN** a save succeeds
- **THEN** `shell/save-result` is delivered before the corresponding `workspace/file-changed` event

### Requirement: External change notification

The shell SHALL notify a handler when it observes a change to that handler's
document, SHALL identify the kind (`changed`, `deleted` or `renamed`) and the new
version when one exists, and SHALL NOT auto-reload a dirty buffer.

#### Scenario: External write

- **WHEN** the open file changes outside the handler
- **THEN** the handler receives the new path and version and decides whether to
  reload, keep its buffer or ask the user

#### Scenario: Dirty buffer is not replaced

- **WHEN** a dirty handler receives an external-change notification
- **THEN** the shell leaves the buffer and the dirty state untouched

#### Scenario: Deleted file

- **WHEN** the open file is deleted
- **THEN** the handler is notified with `deleted` and a later save fails with
  `not-found` instead of recreating the file silently

### Requirement: Error reporting

The shell SHALL report protocol failures as `shell/error` with a stable code from
`unsupported-message`, `unsupported-version`, `protocol-violation`, `timeout`,
`loading-failed`, `permission-denied`, `not-found`, `not-a-file`, `too-large`,
`conflict`, `rate-limited` or `internal`, SHALL include a user-safe message at
most, and SHALL NOT expose stack traces, provider text or paths outside the
requested scope.

#### Scenario: Reserved path

- **WHEN** a handler requests `/exo.json`
- **THEN** the error code is `permission-denied` and the message contains no
  content or metadata from the file

#### Scenario: Internal failure

- **WHEN** the provider fails for an unexpected reason
- **THEN** the plugin receives `internal` and the provider's message stays in the
  shell log

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

### Requirement: Registration contribution details

The shell SHALL accept `plugin/register` contributions shaped as
`{ glob, entry, label? }`, SHALL take the priority from the matching manifest
contribution, SHALL default a missing label to that contribution's label, SHALL
reject a label outside 1-40 characters, and SHALL deduplicate identical glob and
entry pairs into one registry contribution. `shell/register-ack` SHALL carry
accepted glob strings and rejected entries with an index and a stable reason.

#### Scenario: Label defaults to the manifest label

- **WHEN** a registration omits `label` for a glob declared with label `Code`
- **THEN** the registered editor is labelled `Code`

#### Scenario: Explicit label is accepted

- **WHEN** a registration supplies a label of 1 to 40 characters
- **THEN** that label is used for the registered editor

#### Scenario: Invalid label is rejected

- **WHEN** a registration supplies a label longer than 40 characters or an empty label
- **THEN** that contribution is rejected with reason `invalid-contribution` and the other valid contributions still activate

#### Scenario: Priority comes from the manifest

- **WHEN** a manifest declares a glob with priority `7` and the registration omits any priority
- **THEN** the registered editor is stored with priority `7`

#### Scenario: Acknowledgement lists accepted globs

- **WHEN** a plugin completes registration with two accepted contributions
- **THEN** `shell/register-ack` contains both glob strings in `accepted`

#### Scenario: Acknowledgement lists rejected entries

- **WHEN** a registration includes an undeclared glob and an entry outside the plugin root
- **THEN** `rejected` contains an entry for each with its index and the reason `not-declared` or `permission-denied`

#### Scenario: Identical registration is deduplicated

- **WHEN** a plugin registers the same glob and entry pair twice before completing
- **THEN** exactly one registry contribution is created

### Requirement: Editor eligibility and write permission

The shell SHALL accept or select a file-editor contribution only from a plugin
that declares `workspace:read` (or `workspace:write`, which implies it), SHALL
offer a save only when the plugin declares `workspace:write` and the workspace
session is writable, and SHALL answer any other save attempt with
`permission-denied` without writing.

#### Scenario: Editor contribution without read permission

- **WHEN** a plugin without `workspace:read` or `workspace:write` registers a file editor
- **THEN** that contribution is rejected with `permission-denied` and never enters the registry

#### Scenario: Read-only editor

- **WHEN** a plugin declares `workspace:read` but not `workspace:write`
- **THEN** its editor opens documents, but the shell offers no Save action for them

#### Scenario: Save without write permission

- **WHEN** a read-only editor's document is saved
- **THEN** the shell returns `permission-denied`, performs no write and leaves the document dirty

#### Scenario: Read-only workspace

- **WHEN** the workspace session is not writable
- **THEN** saving a handler document returns `permission-denied`, performs no write and keeps the tab dirty

#### Scenario: Write implies read

- **WHEN** a plugin declares `workspace:write` without `workspace:read`
- **THEN** it is treated as holding read permission and its editor contribution is accepted

### Requirement: Shell message target origin

The shell SHALL address `shell/*` messages to the plugin's exact origin for a
cross-origin frame and SHALL use `*` only for a same-origin frame whose sandbox
gives it an opaque origin, where no origin can be named. The shell SHALL never
use `*` for a cross-origin frame.

#### Scenario: Cross-origin target

- **WHEN** the shell sends `shell/init` to a plugin served from `https://plugins.example.com`
- **THEN** `postMessage` uses `https://plugins.example.com` as its target origin

#### Scenario: Opaque same-origin target

- **WHEN** the shell sends `shell/init` to a first-party plugin running with `allow-scripts` only
- **THEN** `postMessage` uses `*` because the frame has no nameable origin

#### Scenario: Wildcard is not used cross-origin

- **WHEN** a frame has a non-opaque cross-origin identity
- **THEN** no shell message is posted with `*`

#### Scenario: Init still carries no content

- **WHEN** the shell posts to an opaque same-origin frame
- **THEN** `shell/init` contains only the metadata the contract allows and no file content
