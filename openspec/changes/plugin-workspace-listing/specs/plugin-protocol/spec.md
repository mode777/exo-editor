# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Error reporting

The shell SHALL report protocol failures as `shell/error` with a stable code from
`unsupported-message`, `unsupported-version`, `protocol-violation`, `timeout`,
`loading-failed`, `permission-denied`, `not-found`, `not-a-file`,
`not-a-directory`, `too-large`, `conflict`, `rate-limited` or `internal`, SHALL
include a user-safe message at most, and SHALL NOT expose stack traces, provider
text or paths outside the requested scope.

#### Scenario: Reserved path

- **WHEN** a handler requests `/exo.json`
- **THEN** the error code is `permission-denied` and the message contains no
  content or metadata from the file

#### Scenario: Internal failure

- **WHEN** the provider fails for an unexpected reason
- **THEN** the plugin receives `internal` and the provider's message stays in the
  shell log
