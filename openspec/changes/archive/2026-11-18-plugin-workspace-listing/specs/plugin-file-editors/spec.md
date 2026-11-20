# Spec Delta

## ADDED Requirements

### Requirement: Permissioned directory discovery

A handler whose plugin declares `workspace:list` and `workspace:read` SHALL be able to enumerate one directory level at a time. Each page SHALL carry paths, kinds and an optional file size only, and reads of returned paths SHALL still go through `plugin/request-file`.

#### Scenario: List the model directory

- **WHEN** an authorized handler lists the directory of an open glTF file
- **THEN** it receives the direct files and subdirectories with paths and kinds, and no file content

#### Scenario: Walk one level at a time

- **WHEN** a page contains a subdirectory
- **THEN** the handler can list that subdirectory with a second request and receives only its direct children

#### Scenario: Paginate a large directory

- **WHEN** a directory has more entries than one page
- **THEN** the handler receives a `nextCursor` and can request the remaining pages

#### Scenario: Minimal metadata only

- **WHEN** entries are returned
- **THEN** each entry carries a path, a kind and, for files, a size; it carries no mtime, version, content, handle, `File` or `Blob`

#### Scenario: Read after discovery

- **WHEN** the handler wants the bytes of a listed file
- **THEN** it requests that path through `plugin/request-file` and the existing permission, size and reserved-path checks apply

#### Scenario: Missing permission

- **WHEN** a handler whose plugin declares `workspace:read` but not `workspace:list` sends a listing request
- **THEN** the shell replies `permission-denied` and performs no listing

#### Scenario: Listing is not a write grant

- **WHEN** a read-only plugin discovers a file
- **THEN** it can read the file if `workspace:read` allows, and no write to that path becomes possible outside the existing save flow

#### Scenario: Reserved paths stay invisible

- **WHEN** an authorized handler lists the workspace root
- **THEN** `exo.json` and `.exo` are absent, and a request for a reserved directory is denied

### Requirement: Listing snapshot and workspace isolation

A listing page SHALL be served from a stable snapshot for its cursor, SHALL NOT act as a file watcher, and SHALL discard its snapshots and cursors on handler disposal or workspace switch so no entry from a released workspace is returned.

#### Scenario: Snapshot does not follow changes

- **WHEN** a file is created or deleted between two pages of the same cursor
- **THEN** the later page remains consistent with the snapshot and the plugin must make a fresh request to observe the change

#### Scenario: Cursor expires

- **WHEN** a cursor is malformed, belongs to another path or has been evicted
- **THEN** the shell replies `not-found` and returns no entries

#### Scenario: Workspace switch resets state

- **WHEN** the user switches workspaces
- **THEN** every prior listing snapshot and cursor is discarded before the new workspace is ready

#### Scenario: Disposal drops late pages

- **WHEN** a listing page resolves after its handler was disposed
- **THEN** the shell drops it and sends no `shell/list-result`

#### Scenario: No background watching

- **WHEN** a plugin has listed a directory but has not subscribed to an event topic
- **THEN** the shell sends no notification about unopened files in that directory
