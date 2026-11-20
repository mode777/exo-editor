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

The shell SHALL mount registration frames hidden, SHALL mount handler frames
hidden unless the approved contribution declares `rendering: "frame"`, in which
case the active document's handler frame is displayed in the document area, and
SHALL allow no top navigation, popups, modals, downloads or fullscreen in either
case. Every frame SHALL use `referrerpolicy="no-referrer"`, SHALL apply
`sandbox="allow-scripts allow-same-origin"` to cross-origin plugin origins and
`sandbox="allow-scripts"` to plugin origins equal to the shell origin, SHALL pass
the shell origin and session id in the URL fragment, SHALL send `shell/init` only
after receiving a valid `plugin/ready`, and SHALL include in `shell/init` the
plugin's resolved workspace-scoped settings values for both registration and
editor modes.

#### Scenario: Ready starts the session

- **WHEN** a plugin frame sends `plugin/ready` with a supported protocol version
- **THEN** the shell replies with `shell/init` containing the mode, session id, plugin identity, shell version and origin, workspace name, theme, permissions, locale and the plugin's current settings values

#### Scenario: Settings values are initialized

- **WHEN** a plugin declares workspace settings and a handler or registration
  frame sends `plugin/ready`
- **THEN** `shell/init` carries the resolved values for that plugin, including
  declared defaults for settings with no stored value

#### Scenario: No settings means an empty map

- **WHEN** a plugin declares no configuration
- **THEN** `shell/init` carries an empty settings object rather than omitting the
  field or inventing values

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

#### Scenario: Registration frame stays hidden

- **WHEN** a plugin controller performs the registration phase
- **THEN** its iframe is never displayed in the document area even if its
  contributions declare `rendering: "frame"`

#### Scenario: Visible handler frame keeps its sandbox

- **WHEN** a same-origin contribution declares `rendering: "frame"` and its
  handler is displayed
- **THEN** the iframe still uses `sandbox="allow-scripts"` and the visibility
  change adds no storage, popup, navigation or parent access

### Requirement: Registration phase

The shell SHALL accept zero or more additive `plugin/register` messages followed
by exactly one `plugin/register-complete`, SHALL accept only contributions the
manifest declares and pages inside the approved plugin root, SHALL send
`shell/register-ack` with accepted and rejected entries, and SHALL unload the
registration frame after acknowledging.

#### Scenario: Registrations activate only on completion

- **WHEN** a plugin registers contributions but never sends `plugin/register-complete`
- **THEN** no registration becomes active and the frame is removed at the registration timeout

#### Scenario: Undeclared capability

- **WHEN** a plugin registers a file editor although its manifest declares no `fileEditors` contribution
- **THEN** the entry is rejected with `not-declared` and listed in the acknowledgement

#### Scenario: Declared editor is activated

- **WHEN** a plugin registers a declared glob with an entry inside the plugin root
- **THEN** the pair is accepted and becomes active after `plugin/register-complete`

#### Scenario: Declared command is activated

- **WHEN** a plugin registers a declared command id and completes registration
- **THEN** the command is accepted and becomes active after `plugin/register-complete`

#### Scenario: Registration cannot add globs

- **WHEN** a plugin registers a glob the manifest did not declare
- **THEN** that entry is rejected with `not-declared` and the manifest's approved glob set is unchanged

#### Scenario: Registration cannot add commands

- **WHEN** a plugin registers a command id the manifest did not declare
- **THEN** that entry is rejected with `not-declared` and no command becomes active

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
and SHALL leave the document dirty when the write conflicts or times out. The
shell SHALL also accept an id-less `plugin/request-save` notification as a request
to run that same save flow for the handler's document, without accepting content
from the notification, and SHALL reject a `plugin/request-save` that carries an
`id` as a protocol violation.

#### Scenario: Dirty drives the tab

- **WHEN** a handler reports `plugin/dirty` with `true`
- **THEN** the tab shows an unsaved indicator and closing it prompts for confirmation

#### Scenario: Save round trip

- **WHEN** the shell sends `shell/request-save` and the plugin answers with content within 5 seconds
- **THEN** the shell writes with `ifVersion`, returns `shell/save-result` with the new version, and clears dirty only if the plugin has not reported dirty again

#### Scenario: Plugin requests a save

- **WHEN** an active handler sends an id-less `plugin/request-save`
- **THEN** the shell starts the same save as the Save action, sends `shell/request-save`, and accepts content only in reply to that request

#### Scenario: Save intent carries no content

- **WHEN** a `plugin/request-save` message carries an `id` or a non-empty payload
- **THEN** the shell rejects it as a protocol violation, performs no write and sends no content request

#### Scenario: Save intent coalesces

- **WHEN** a handler sends `plugin/request-save` while a save is already in flight
- **THEN** the shell creates no second write and the plugin receives the result of the existing save

#### Scenario: Save intent on a clean or read-only document

- **WHEN** a handler requests a save for a document that is clean, read-only or no longer active
- **THEN** the shell performs no write and returns no new save result

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
version when one exists, and SHALL NOT auto-reload a dirty buffer. This
`shell/file-changed` message SHALL be the immediate, targeted notification for
the bound document and SHALL NOT be a topic subscription event; the same
observation also feeds the coalesced `workspace/file-changed` topic for
subscribers.

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

#### Scenario: Notification does not require a subscription

- **WHEN** a handler for the open document has not subscribed to `workspace/file-changed`
- **THEN** it still receives the targeted notification for that document

#### Scenario: Subscription is separate from the targeted notification

- **WHEN** a handler subscribes to `workspace/file-changed`
- **THEN** it receives topic events for every changed path, including its own,
  in addition to the targeted notifications for its document

### Requirement: Error reporting

The shell SHALL report protocol failures as `shell/error` with a stable code from `unsupported-message`, `unsupported-version`, `protocol-violation`, `timeout`, `loading-failed`, `permission-denied`, `not-found`, `not-a-file`, `not-a-directory`, `already-exists`, `too-large`, `conflict`, `rate-limited`, `unsupported-topic` or `internal`, SHALL include a user-safe message at most, and SHALL NOT expose stack traces, provider text or paths outside the requested scope.

#### Scenario: Reserved path

- **WHEN** a handler requests `/exo.json`
- **THEN** the error code is `permission-denied` and the message contains no content or metadata from the file

#### Scenario: Internal failure

- **WHEN** the provider fails for an unexpected reason
- **THEN** the plugin receives `internal` and the provider's message stays in the shell log

#### Scenario: Unsupported local topic

- **WHEN** a handler publishes or subscribes to a malformed local topic
- **THEN** the plugin receives `unsupported-topic` with a message naming the expected `local/<name>` form

#### Scenario: Existing new-file target

- **WHEN** a create request targets an existing file
- **THEN** the plugin receives `already-exists` with a message and the existing file is unchanged

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

The shell SHALL enforce a 64-request in-flight limit per frame, a 16 MiB message payload cap, a 64 KiB content-view payload cap, an 8 MiB generated new-file cap, the advertised per-file read cap, a 10-second ready timeout, a 10-second registration timeout, a 5-second save timeout, a 1-second dispose timeout, a budget of three protocol violations before teardown, a maximum of 20 concurrently open handler frames per plugin, a maximum of eight panels per plugin, a maximum of sixteen declared content views per plugin, a maximum of ten open content-view tabs per plugin, a shell-wide maximum of fifty plugin-initiated open file tabs, one pending new-file dialog per shell, and a ten-per-second new-file request budget per frame.

#### Scenario: Oversized payload

- **WHEN** a frame sends a message larger than 16 MiB
- **THEN** the shell rejects it with `too-large` and does not buffer it

#### Scenario: Oversized content-view payload

- **WHEN** `plugin/open-view` carries a payload larger than 64 KiB
- **THEN** the shell rejects it with `too-large` and a message naming the actual size and the 64 KiB limit, and opens no tab

#### Scenario: Oversized generated file

- **WHEN** `plugin/request-new-file` carries more than 8 MiB of text or bytes
- **THEN** the shell rejects it with `too-large`, names the actual size and the 8 MiB limit, and opens no dialog

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

#### Scenario: One new-file dialog

- **WHEN** a new-file dialog is open and another frame requests one
- **THEN** the shell replies `rate-limited` and opens no second dialog

#### Scenario: New-file request rate

- **WHEN** a frame exceeds ten new-file requests in a rolling second
- **THEN** the shell replies `rate-limited` and opens no dialog for the excess

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

### Requirement: Directory listing capability negotiation

Editor `shell/init` SHALL carry `capabilities.directoryListing` as the shell support bit, separate from the plugin's `workspace:list` permission. A shell that implements listing SHALL send `true`; an older shell omits it, and a plugin SHALL treat absence as `false` and SHALL NOT infer listing support from `workspace:read`.

#### Scenario: New shell advertises listing

- **WHEN** an editor frame receives `shell/init` with `capabilities.directoryListing: true`
- **THEN** the plugin may offer listing actions and may send `plugin/request-list`

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.directoryListing` field
- **THEN** the plugin treats listing as unsupported and keeps exact-path reads as its fallback

#### Scenario: Support is not permission

- **WHEN** `capabilities.directoryListing` is `true` but the manifest does not declare `workspace:list`
- **THEN** the shell answers `permission-denied` and returns no entries

### Requirement: Directory listing request

An editor handler SHALL be able to send one correlated `plugin/request-list` carrying a workspace directory and an optional opaque cursor. The shell SHALL resolve the path, require `workspace:list`, list only the direct children of that directory, and reply `shell/list-result` with a bounded page of entries or `shell/error`.

#### Scenario: First page

- **WHEN** an authorized handler requests a directory with no cursor
- **THEN** the shell replies with the first bounded page of direct children and, when more entries exist, an opaque `nextCursor`

#### Scenario: Relative and absolute paths

- **WHEN** the request names a relative path it resolves against the handler file's directory, and a leading `/` is workspace-absolute
- **THEN** the shell normalizes, contains and lists the resolved directory

#### Scenario: One level only

- **WHEN** a directory contains a child directory
- **THEN** the reply includes that child's entry but does not include its descendants

#### Scenario: Missing directory

- **WHEN** the requested path does not exist
- **THEN** the shell replies `not-found` and returns no entries

#### Scenario: File instead of directory

- **WHEN** the requested path is a file
- **THEN** the shell replies `not-a-directory` and returns no entries

#### Scenario: Missing permission

- **WHEN** a handler whose plugin lacks `workspace:list` sends `plugin/request-list`
- **THEN** the shell replies `permission-denied`, performs no provider listing and returns no entries

#### Scenario: Malformed request

- **WHEN** `plugin/request-list` lacks an `id`, has a non-string `path` or has a non-string `cursor`
- **THEN** the shell rejects it as a protocol violation, performs no listing and returns no entries

#### Scenario: Wrong phase

- **WHEN** a registration frame sends `plugin/request-list`
- **THEN** the shell rejects it as a protocol violation and performs no listing

### Requirement: Directory listing entries and pagination

A listing page SHALL contain at most 1,000 entries sorted with directories before files and then by path using the workspace's case-sensitivity rule, SHALL use the shape `{ path, kind: 'file' | 'directory', size? }`, and SHALL omit `mtime`, content versions, content, handles, `File` or `Blob` values. `size` SHALL be present for files and absent for directories.

#### Scenario: Entry shape is minimal

- **WHEN** the shell returns a page
- **THEN** each entry carries a `/`-rooted path, a kind and, for files, a byte size; it carries no mtime, version or content

#### Scenario: Page bound

- **WHEN** a directory has more than 1,000 direct children
- **THEN** the first page contains 1,000 entries and a `nextCursor`

#### Scenario: Cursor continuation

- **WHEN** the handler sends the `nextCursor` from the previous page
- **THEN** the shell returns the next page from the same snapshot and omits `nextCursor` when no entries remain

#### Scenario: Snapshot stability

- **WHEN** the directory changes between two pages of the same cursor
- **THEN** later pages continue from the snapshot taken for the first page, and a fresh request without a cursor observes the new state

#### Scenario: Invalid or expired cursor

- **WHEN** the handler sends a cursor that is malformed, belongs to another path or has been evicted
- **THEN** the shell replies `not-found` and returns no entries

#### Scenario: No content crosses

- **WHEN** any page is returned
- **THEN** the payload contains entries only and no file bytes, text, handle, `File` or `Blob`

### Requirement: Directory listing access and lifecycle

The shell SHALL filter reserved entries through the plugin-scoped workspace facade, SHALL deny a reserved requested directory, SHALL reset listing snapshots on handler disposal or workspace switch, and SHALL drop late listing results after disposal. It SHALL allow at most four in-flight listing requests per frame and a rolling rate of twenty per second.

#### Scenario: Reserved entries are hidden

- **WHEN** a handler lists the workspace root
- **THEN** `exo.json` and `.exo` are absent from the page

#### Scenario: Reserved directory is denied

- **WHEN** a handler requests `/.exo` or `/exo.json`
- **THEN** the shell replies `permission-denied` and performs no listing

#### Scenario: Too many in-flight pages

- **WHEN** a frame already has four listing requests in flight and sends a fifth
- **THEN** the shell replies `rate-limited` and performs no listing

#### Scenario: Rolling rate limit

- **WHEN** a frame exceeds twenty listing requests in a rolling second
- **THEN** the shell replies `rate-limited` and leaves existing snapshots unchanged

#### Scenario: Page timeout

- **WHEN** a listing page does not complete within five seconds
- **THEN** the shell aborts that page, replies `timeout` and returns no partial entries

#### Scenario: Disposal clears snapshots

- **WHEN** the handler is disposed or the workspace switches
- **THEN** its listing snapshots are discarded, in-flight listings are aborted and no later page is delivered

#### Scenario: Late result after disposal

- **WHEN** a provider listing resolves after the handler was disposed
- **THEN** the shell drops the result and sends no `shell/list-result`

### Requirement: Local events capability negotiation

Editor `shell/init` SHALL carry `capabilities.localEvents` as the shell support bit for plugin-local publication and subscription. A shell that implements the feature SHALL send `true`; an older shell omits it, and a plugin SHALL treat absence as `false` and SHALL NOT infer support from `events:subscribe` or the shell version.

#### Scenario: New shell advertises local events

- **WHEN** an editor frame receives `shell/init` with `capabilities.localEvents: true`
- **THEN** the plugin may publish and subscribe to local topics

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.localEvents` field
- **THEN** the plugin treats local events as unsupported and keeps its existing per-frame behavior

#### Scenario: Support is not permission

- **WHEN** `capabilities.localEvents` is `true` but the manifest does not declare `events:subscribe`
- **THEN** the shell answers `permission-denied` and routes no local event

### Requirement: Plugin-local publication message

A handler frame SHALL send `plugin/publish { topic, payload }` with a live request id, and the shell SHALL reply `shell/published { topic, seq }` after accepting it. The shell SHALL reject a publish from a registration frame as a protocol violation and SHALL reject shell topics, malformed local topics, oversized payloads and excess rates with the stable error codes in the limits requirement.

#### Scenario: Publish is acknowledged

- **WHEN** an editor frame publishes a valid local topic
- **THEN** the shell replies `shell/published` with a `replyTo` equal to the request id, the topic and the sequence number

#### Scenario: Registration frame is rejected

- **WHEN** a registration frame sends `plugin/publish`
- **THEN** the shell replies `protocol-violation`, publishes nothing and counts the message toward the frame's budget

#### Scenario: Publishing a shell topic

- **WHEN** an editor frame publishes `workspace/file-changed`
- **THEN** the shell replies `permission-denied`, publishes nothing and leaves the shell topic's sequence unchanged

#### Scenario: Sequence in the acknowledgement

- **WHEN** two local events are accepted on one topic
- **THEN** the two `shell/published` replies carry increasing sequence numbers for that plugin and topic

#### Scenario: Publish without a subscriber

- **WHEN** an editor frame publishes a valid local topic and no frame is subscribed
- **THEN** the shell still acknowledges with the new sequence and queues nothing for later

#### Scenario: Publish after disposal

- **WHEN** a publish arrives from a frame whose session is disposed
- **THEN** the shell drops it, sends no acknowledgement and delivers no event

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

### Requirement: Command registration details

`plugin/register` SHALL accept an optional `commands` array of command ids declared by the manifest. The shell SHALL preserve arrival order and SHALL deduplicate repeated ids into one registration.

#### Scenario: Command subset

- **WHEN** a manifest declares three commands and `plugin/register` carries one id
- **THEN** `acceptedCommands` contains that id and the other two are not active

#### Scenario: Duplicate command id

- **WHEN** `plugin/register` carries the same command id twice before completion
- **THEN** `acceptedCommands` contains it once

#### Scenario: Additive acknowledgement

- **WHEN** a shell receives `plugin/register` without `commands`
- **THEN** it acknowledges the editors exactly as before and omits or empties `acceptedCommands`

### Requirement: Command registration validation

The shell SHALL reject an undeclared command id with `not-declared`, SHALL reject a command whose panel or content-view target was not registered in the same session with `target-not-registered`, and SHALL return accepted ids in an additive `acceptedCommands` array with a rejected entry's kind identified when it is a command.

#### Scenario: Undeclared command

- **WHEN** `plugin/register` carries a command id the manifest did not declare
- **THEN** the entry is rejected with `not-declared` and remains absent from `acceptedCommands`

#### Scenario: Target was not registered

- **WHEN** a command targets a declared panel that the same registration did not activate
- **THEN** the command is rejected with `target-not-registered` and no surface lists it

#### Scenario: Accepted and rejected together

- **WHEN** one registration carries a valid command and an invalid command
- **THEN** `acceptedCommands` lists the valid id and `rejected` names the invalid one with its kind, index and reason

### Requirement: Command invocation message

The shell SHALL send `shell/command` with a correlated id, a registered command id and optional arguments to an editor or view frame that belongs to the same plugin identity. The arguments SHALL be `{ path, kind }` only for an explorer invocation, where `kind` is `file` or `directory`, and SHALL be absent for a palette or editor-title invocation. The message SHALL contain no file content, bytes, handle, `File` or `Blob`.

#### Scenario: Editor command delivery

- **WHEN** an `activeEditor` command is invoked for the active document
- **THEN** one `shell/command` reaches that document's handler frame with no arguments

#### Scenario: Explorer command delivery

- **WHEN** an explorer context command is invoked on a directory
- **THEN** the payload carries that path and `kind: "directory"` and no content

#### Scenario: Target is not active

- **WHEN** the resolved target frame is not active or has been disposed
- **THEN** the shell sends no command and records the invocation as unavailable

#### Scenario: Plugin sends a shell message

- **WHEN** a plugin frame sends `shell/command`
- **THEN** the shell treats it as a protocol violation, delivers nothing and counts it toward the frame's budget

#### Scenario: Unknown command at delivery

- **WHEN** a stale surface invokes a command that is no longer registered
- **THEN** the shell sends no message and records the stale invocation

### Requirement: Command result and timeout

A target frame SHALL answer `shell/command` with `plugin/command-result` carrying `ok: true` or `ok: false` and an optional message of at most 200 characters. The result SHALL echo the invocation id in `replyTo`. The shell SHALL time out an unanswered invocation after 10 seconds, SHALL ignore a second result for the same invocation, and SHALL ignore a result that arrives after the timeout or after the frame is disposed.

#### Scenario: Successful result

- **WHEN** the target replies `{ ok: true }` with the matching `replyTo`
- **THEN** the invocation completes and the shell shows no error

#### Scenario: Failed result

- **WHEN** the target replies `{ ok: false, message: "..." }`
- **THEN** the shell accepts the bounded message as plain text and logs the failure

#### Scenario: Result timeout

- **WHEN** no result arrives within 10 seconds
- **THEN** the shell records `timeout` and does not dispose the target frame

#### Scenario: Late result

- **WHEN** a result arrives after the timeout
- **THEN** the shell ignores it and changes no pending state

#### Scenario: Result in the wrong phase

- **WHEN** a registration frame sends `plugin/command-result`
- **THEN** the shell treats it as a protocol violation

### Requirement: Command capability negotiation

`shell/init` for an editor or view frame SHALL carry `capabilities.commands` as a shell support bit. The bit SHALL be absent on an older shell, and a plugin SHALL treat absence as `false`. The bit SHALL NOT grant a permission or change the target frame's existing read, write, list or event capabilities.

#### Scenario: Current shell advertises commands

- **WHEN** an editor or view frame receives `shell/init`
- **THEN** `capabilities.commands` is true and the plugin may attach a command handler

#### Scenario: Older shell omits the bit

- **WHEN** `shell/init` has no `capabilities.commands` field
- **THEN** the plugin treats command delivery as unsupported and registers no command-dependent UI

#### Scenario: Capability does not grant access

- **WHEN** a plugin without `workspace:read` receives `capabilities.commands: true`
- **THEN** its command handler still cannot read a workspace file

### Requirement: New-file creation request

An editor or view frame with `workspace:write` SHALL send a correlated `plugin/request-new-file` carrying exactly one of `text` or `bytes`, an optional suggested name and an optional directory hint. The shell SHALL open one shell-owned Save As dialog, write the result create-only and reply `shell/new-file-result { path, version }` or `{ cancelled: true }`.

#### Scenario: Text creation

- **WHEN** a frame sends `{ text, suggestedName }`
- **THEN** the shell opens the dialog, writes the UTF-8 text to the user's chosen path and replies with the path and version

#### Scenario: Binary creation

- **WHEN** a frame sends `{ bytes }`
- **THEN** the shell writes the exact bytes and replies with the path and version

#### Scenario: Exactly one content field

- **WHEN** the request carries both `text` and `bytes`, or neither
- **THEN** the shell rejects it as a protocol violation and opens no dialog

#### Scenario: Suggested name is a hint

- **WHEN** `suggestedName` is invalid, contains a separator or is reserved
- **THEN** the shell ignores the hint, opens the dialog with an empty name and grants nothing

#### Scenario: Directory hint is a hint

- **WHEN** `directory` is missing, invalid or reserved
- **THEN** the shell falls back silently to its normal start directory

#### Scenario: Cancellation

- **WHEN** the user cancels or closes the dialog
- **THEN** the shell writes nothing and replies `{ cancelled: true }`

#### Scenario: Missing write permission

- **WHEN** the frame's plugin lacks `workspace:write` or the workspace is read-only
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Hidden or inactive frame

- **WHEN** the frame is not visible, active or focused
- **THEN** the shell replies `permission-denied` and opens no dialog

#### Scenario: Collision

- **WHEN** the chosen name already exists
- **THEN** the shell reports `already-exists` in the dialog, keeps it open and writes nothing

#### Scenario: Success result

- **WHEN** the create succeeds
- **THEN** the reply carries the workspace-absolute path and the new version and the shell does not open a tab automatically

#### Scenario: Disposal during the dialog

- **WHEN** the frame is disposed while the dialog is open
- **THEN** the dialog closes, no write occurs and the pending request settles without a late write

### Requirement: New-file capability negotiation

`shell/init` SHALL carry `capabilities.createFile` for the runtime request and registration `shell/init` SHALL carry `capabilities.newFiles` for template registration. An older shell omits them, and a plugin SHALL treat absence as `false`.

#### Scenario: New shell advertises creation

- **WHEN** an editor or view frame receives `capabilities.createFile: true`
- **THEN** the plugin may offer its create action

#### Scenario: New shell advertises templates

- **WHEN** a registration frame receives `capabilities.newFiles: true`
- **THEN** the controller may register a declared template

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the plugin does not offer the corresponding action and registers no template

#### Scenario: Support is not permission

- **WHEN** `capabilities.createFile` is true but the manifest lacks `workspace:write`
- **THEN** the shell replies `permission-denied` and opens no dialog
