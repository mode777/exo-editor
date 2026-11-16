# plugin-file-editors Specification

## Purpose
Defines how a plugin editor opens, edits and saves a workspace file: one handler
frame per document, content only through mediated reads, plugin-owned dirty
state, conflict-safe saves and teardown that never leaves a stale buffer.

## Requirements

### Requirement: One handler per open document

The shell SHALL mount exactly one handler frame for a document when the registry
offers a matching contribution from an enabled, consented, active plugin that has
`workspace:read`, SHALL load the contribution's registered editor page rather
than the controller entry, and SHALL otherwise open the document in the shell's
built-in text surface. Selecting a handler SHALL NOT require the shell to read or
decode the file first.

#### Scenario: Matching file mounts one frame

- **WHEN** the user opens a file whose path matches one registered editor
- **THEN** the shell mounts one handler frame for that document and no second frame for the same tab

#### Scenario: Highest priority candidate wins

- **WHEN** two plugins match a path with priorities `10` and `0`
- **THEN** the `10` editor is mounted and the other is only offered as an alternative

#### Scenario: No match uses the text surface

- **WHEN** no registered editor matches the path
- **THEN** the document opens in the shell text surface and no frame is mounted

#### Scenario: Editor without read permission is not selected

- **WHEN** a matching contribution belongs to a plugin that does not declare `workspace:read`
- **THEN** the contribution is not offered or mounted and the document uses the text surface

#### Scenario: Format-agnostic selection

- **WHEN** a matching file contains NUL bytes, is not valid UTF-8 or exceeds the shell's text limit
- **THEN** the plugin editor is still selected and the shell text surface's no-editor verdict does not apply

#### Scenario: Frame cap keeps the document usable

- **WHEN** the plugin already has 20 handler frames and another matching file opens
- **THEN** the shell mounts no 21st frame, opens the file in the text surface and shows a notice naming the limit

### Requirement: Alternative editor selection

When several contributions match a path, the shell SHALL offer the ordered
candidates as an "Open with..." choice for that document, and choosing one SHALL
replace the document's handler with the chosen editor without changing the
registry, other documents or the persisted selection order.

#### Scenario: Open with lists the others

- **WHEN** three contributions match a document
- **THEN** "Open with..." lists all three, with the current editor marked

#### Scenario: Choosing an alternative remounts

- **WHEN** the user chooses a lower-priority editor for a clean document
- **THEN** the original handler is disposed, the chosen editor mounts, and the tab shows that editor's label

#### Scenario: Choice is scoped to the document

- **WHEN** the user chooses an alternative editor for one tab
- **THEN** another tab for the same glob still opens with the highest-priority editor

### Requirement: Handler initialization carries metadata only

A handler frame SHALL complete the protocol handshake and receive `shell/init`
with the document's path, name, directory, size, mtime, version, optional
language hint, plugin capabilities, limits, theme, locale and workspace name, and
SHALL receive no file text, bytes, blob or handle until it sends
`plugin/request-file` with a live request id.

#### Scenario: Init has no content

- **WHEN** a handler frame receives `shell/init`
- **THEN** the payload contains metadata and no file content

#### Scenario: Content requires a request

- **WHEN** a handler has received its initialization and sent no file request
- **THEN** the shell has transferred no content for that document

#### Scenario: Unready handler falls back

- **WHEN** a handler frame does not send `plugin/ready` within the protocol's ready timeout
- **THEN** the shell removes the frame, logs the timeout and opens the document in the text surface with a notice

#### Scenario: Reopening mounts a new frame

- **WHEN** the user closes and reopens a document handled by a plugin
- **THEN** a new handler frame is mounted and the previous frame is not reused

### Requirement: Mediated reads only

The shell SHALL answer `plugin/request-file` only for a path that resolves inside
the workspace after normalization, is not a reserved shell path, is a file, fits
`maxRequestBytes` and is covered by `workspace:read`, resolving a relative path
against the handler file's directory and treating a leading `/` as
workspace-absolute, and SHALL return no content for any rejected request.

#### Scenario: Relative path resolution

- **WHEN** a handler for `/src/editor.ts` requests `./types.ts`
- **THEN** the shell reads `/src/types.ts` and replies with its content and version

#### Scenario: Escape is denied

- **WHEN** a request normalizes outside the workspace root
- **THEN** the shell replies `permission-denied` and performs no read

#### Scenario: Reserved paths stay shell-only

- **WHEN** a handler requests `/exo.json` or any path under `/.exo/`
- **THEN** the shell replies `permission-denied` with no content or metadata

#### Scenario: Read permission is enforced at the session

- **WHEN** a plugin without `workspace:read` sends a file request
- **THEN** the shell denies it before reaching the provider and logs the denial

#### Scenario: Oversized request is refused

- **WHEN** a requested file exceeds the handler's advertised `maxRequestBytes`
- **THEN** the shell replies `too-large` and transfers no partial content

#### Scenario: Repeated reads are served consistently

- **WHEN** a handler requests the same path twice without an intervening change
- **THEN** the shell may serve the cached bytes for the same version and both replies name that version

#### Scenario: No handle crosses the boundary

- **WHEN** the shell replies to any read
- **THEN** the message contains text or an `ArrayBuffer` and never a `FileSystemHandle`, `File` or `Blob`

### Requirement: Plugin-owned dirty state

For a plugin-backed document the shell SHALL derive dirty state only from
`plugin/dirty`, SHALL show it on the tab, SHALL include the document in the
unsaved-changes warning and close prompt, and SHALL NOT infer dirty state from
content the plugin does not send.

#### Scenario: Dirty report marks the tab

- **WHEN** a handler sends `plugin/dirty` with `true`
- **THEN** the tab shows the unsaved indicator and a close request prompts before closing

#### Scenario: Clean report clears the tab

- **WHEN** a handler reports `false` and no save is pending
- **THEN** the tab indicator clears without a write

#### Scenario: Unload warns

- **WHEN** a plugin-backed document is dirty and the page is reloaded
- **THEN** the browser receives the before-unload warning

#### Scenario: Silent handler is clean

- **WHEN** a handler never reports dirty state
- **THEN** the shell treats the document as clean and does not claim unsaved changes

### Requirement: Save round trip is opaque and conflict-safe

The shell SHALL save a plugin-backed document by sending at most one live
`shell/request-save` plus one queued request, SHALL write exactly the returned
text or bytes with the version it last delivered as `ifVersion` and no
transformation, SHALL answer within the protocol's save timeout with
`shell/save-result`, and SHALL leave the document dirty when the write conflicts,
times out or is denied. The shell SHALL also let an active handler trigger the
same save through an id-less `plugin/request-save`, SHALL coalesce the trigger
with a pending save, and SHALL NOT let the trigger supply content or a version.

#### Scenario: Save writes exact bytes

- **WHEN** a handler answers `shell/request-save` with bytes
- **THEN** the provider receives those bytes unchanged and the result carries the new version

#### Scenario: Plugin-initiated save writes the same way

- **WHEN** an active writable handler sends `plugin/request-save`
- **THEN** the shell sends `shell/request-save`, writes the returned content with
  the last delivered version and returns the same `shell/save-result`

#### Scenario: Plugin-initiated save coalesces

- **WHEN** the handler requests a save while one is already pending
- **THEN** the shell performs one write and the handler receives one result

#### Scenario: Plugin-initiated save respects state

- **WHEN** a clean, read-only or inactive document receives a save trigger
- **THEN** the shell writes nothing and offers no bypass around the Save action's
  permission and dirty checks

#### Scenario: Conflict preserves disk content

- **WHEN** the file changed after the handler's last read or notification
- **THEN** the write fails with `conflict`, the on-disk content remains, and the tab stays dirty

#### Scenario: Timeout keeps the tab dirty

- **WHEN** the handler does not answer within 5 seconds
- **THEN** the save fails with `timeout`, no write occurs, and the tab remains dirty

#### Scenario: Read-only plugin editor has no save

- **WHEN** the plugin lacks `workspace:write` or the session is not writable
- **THEN** no Save action is offered and a save attempt returns `permission-denied` without writing

#### Scenario: Save ordering

- **WHEN** a save succeeds
- **THEN** `shell/save-result` is delivered before any change notification for that save

#### Scenario: Late save content is ignored

- **WHEN** content arrives for a request that already timed out or was cancelled
- **THEN** the shell ignores it, writes nothing and counts a protocol violation

### Requirement: External changes reach the handler

The shell SHALL forward an observed change to the open document's handler with
the change kind and, when one exists, the new path and version, SHALL NOT
auto-reload a dirty buffer, and SHALL fail a later save after deletion with
`not-found` without recreating the file.

#### Scenario: External write is forwarded

- **WHEN** the open file changes outside the shell
- **THEN** the handler receives the new version and the tab shows the external-change notice while local state is preserved

#### Scenario: Deleting the open file

- **WHEN** the open file is deleted
- **THEN** the handler is notified with `deleted`, the tab shows the deleted state, and no save recreates the file

#### Scenario: Renaming the open file

- **WHEN** the open file is renamed
- **THEN** the handler receives the new path and version, and the tab follows the rename without a second tab

### Requirement: Disposal never leaves a stale buffer

The shell SHALL dispose a document's handler on tab close, plugin removal,
disable or revocation, workspace switch or handler failure, SHALL send
`shell/dispose` with the reason and wait at most the protocol's dispose timeout,
SHALL cancel an in-flight save, and SHALL accept no message from the frame
afterwards. It SHALL NOT claim a document is saved when the plugin held the only
copy of its edits.

#### Scenario: Closing a tab disposes

- **WHEN** a clean tab handled by a plugin is closed
- **THEN** the shell sends `shell/dispose` with `closed`, removes the frame and drops the document state

#### Scenario: Removing a plugin with dirty documents prompts

- **WHEN** the user disables, removes or revokes a plugin that has dirty documents
- **THEN** the shell offers save, discard or cancel before tearing the plugin down

#### Scenario: Workspace switch cancels a save

- **WHEN** the workspace switches while a handler save is in flight
- **THEN** the save is cancelled, no write reaches either workspace, and the handler is disposed before the old session is released

#### Scenario: Late message is dropped

- **WHEN** a message arrives from a frame that was already disposed
- **THEN** the shell drops it and creates no document state

#### Scenario: Handler failure is explicit

- **WHEN** a handler violates the protocol budget or fails to load
- **THEN** the tab shows a plugin-failure notice and the shell never presents an empty buffer as the saved file

### Requirement: Handler failures stay inside the document

The shell SHALL surface every handler failure in the affected document or the
workspace plugin log, SHALL keep the workspace, other tabs and other plugins
usable, and SHALL log only plugin identity, path, phase and error code, never file
content or another document's path.

#### Scenario: One failure does not close other tabs

- **WHEN** a handler fails for one document
- **THEN** other documents and plugins keep working unchanged

#### Scenario: Log excludes content

- **WHEN** a handler read, save or disposal event is logged
- **THEN** the entry contains no file text, bytes or path outside the document scope

### Requirement: Visible handler frame surface

When the selected contribution declares `rendering: "frame"`, the shell SHALL
display its handler iframe in the measured document area for the active
document, SHALL keep the tab strip, document header, Save action and shell
notices outside the frame, and SHALL hide the frame when another tab is active
without disposing the handler session. The shell SHALL NOT give the plugin a
shell DOM node, reparent the live iframe or create a second handler for the same
document.

#### Scenario: Frame appears for the active document

- **WHEN** a document handled by a `rendering: "frame"` contribution becomes the
  active tab
- **THEN** its handler iframe is visible inside the document area and the shell's
  header and Save button remain outside it

#### Scenario: Tab switch hides without disposal

- **WHEN** the user switches to another tab and back
- **THEN** the first document's iframe is hidden while inactive, no
  `shell/dispose` is sent, and the same handler session is visible again on return

#### Scenario: Shell chrome stays outside

- **WHEN** a visible plugin frame is displayed
- **THEN** the tab, breadcrumbs, file size, editor label, Save action, read-only
  notice and external-change banners are rendered by the shell and are not part
  of the plugin document

#### Scenario: Frame failure hides the surface

- **WHEN** a visible handler fails to load, times out or violates the protocol
- **THEN** the shell removes the frame surface and shows its normal failure or
  text fallback state

#### Scenario: Hidden contributions are unchanged

- **WHEN** a contribution omits `rendering` or declares `rendering: "hidden"`
- **THEN** its handler stays out of the document area and the existing headless
  behavior is unchanged

#### Scenario: No shell DOM access

- **WHEN** a visible handler runs
- **THEN** it can render only inside its own iframe and receives no shell element,
  `FileSystemHandle`, `File`, `Blob` or synchronous callback
