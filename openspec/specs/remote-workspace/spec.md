# remote-workspace Specification

## Purpose

Lets the shell open a remote workspace directly from the browser with a
user-supplied credential, without a backend, without sync, and without exposing
the credential to a plugin.

## Requirements

### Requirement: Connection entry and validation

The shell SHALL accept a remote workspace connection as a server URL plus either
a bearer token or, for a public directory, a directory identifier with no
credential, or as an `sfconn_v1_` connection string. It SHALL parse a connection
string locally, SHALL validate the resolved connection against the remote server
before any workspace is mounted, and SHALL mount either a fully configured
workspace or none.

#### Scenario: Editor token connects writable

- **WHEN** the user connects a server URL with a valid editor-role token
- **THEN** the shell resolves the directory name and role, mounts the workspace as writable, and shows it as the active workspace

#### Scenario: Public directory connects read-only

- **WHEN** the user connects a public directory without a token
- **THEN** the workspace mounts read-only and no credential is created, stored or sent

#### Scenario: Connection string connects with its embedded facts

- **WHEN** the user pastes a valid `sfconn_v1_` connection string
- **THEN** the shell takes the server, directory and token from it, resolves the directory name and role with the token scope, and mounts the workspace without asking for the three facts separately

#### Scenario: Malformed connection string fails locally

- **WHEN** the supplied connection string has a wrong prefix, an unknown version, invalid base64url or JSON, or a missing or invalid field
- **THEN** the shell reports a configuration error before any network request and mounts no workspace

#### Scenario: Embedded origin can be corrected

- **WHEN** a valid connection string names an unreachable or stale origin and the user corrects the server URL
- **THEN** the corrected origin is used for requests while the directory and token still come from the connection string

#### Scenario: Validation failure leaves the current workspace intact

- **WHEN** validation fails for an unreachable server, a wrong token or a token bound to another directory
- **THEN** the connect flow reports the specific failure and the previously open workspace, its tabs and its unsaved documents are unchanged

#### Scenario: No partial workspace

- **WHEN** validation has not completed
- **THEN** no explorer contents, document tab or plugin registration exists for the pending connection

### Requirement: Shell-owned credential

The shell SHALL keep a remote credential, including a connection string and the
token it carries, inside the shell only, SHALL send the token only in an
authorization request header, and SHALL never place either value in a URL, a
query string, the application bundle, the workspace log, a stored record, or any
message to a plugin frame. A connection string SHALL be parsed and discarded,
not retained after it resolves the connection.

#### Scenario: Credential never reaches a plugin

- **WHEN** a plugin requests a file from a remote workspace
- **THEN** the request crosses the shell boundary as bytes and a version, and the credential never appears in the message or in the plugin's reachable state

#### Scenario: Credential never appears in a URL

- **WHEN** the shell reads, lists, stats, writes or moves a remote path
- **THEN** the network request carries the credential in a header, and the URL contains only the server, directory and path

#### Scenario: Connection string is never sent or retained

- **WHEN** the shell parses a connection string
- **THEN** it extracts the server, directory and token locally, never sends the string to any server, and discards the raw value after the connection resolves

#### Scenario: Credential is not logged

- **WHEN** a remote operation fails and the shell records a workspace log entry or an error state
- **THEN** the entry contains the operation, path and error code only, and never the credential, the connection string or a token hint

### Requirement: Role-derived capabilities

The shell SHALL derive a remote workspace's writable capability from the
credential's role: an editor credential is writable, and a viewer credential or a
public directory is read-only.

#### Scenario: Read-only workspace rejects writes locally

- **WHEN** a read-only remote workspace receives a write, create, rename or delete request
- **THEN** the session rejects it with `unsupported` without sending a mutation request, and the explorer and save actions are disabled

#### Scenario: Role is fixed for the session

- **WHEN** the remote server later reports a lower effective permission
- **THEN** the affected operation fails with `permission-denied` and the shell moves to the reconnect state rather than silently continuing as writable

### Requirement: Reconnect state

The shell SHALL surface a rejected, expired or revoked credential as an explicit
reconnect state that names the workspace and offers reconnecting or disconnecting,
and SHALL NOT report it as a generic IO failure or retry it silently.

#### Scenario: Revoked credential is named

- **WHEN** an operation fails because the remote server rejects the credential
- **THEN** the shell shows a reconnect action naming the remote workspace, and no further request is made until the user acts

#### Scenario: Reconnect succeeds

- **WHEN** the user supplies a valid credential for the same directory from the reconnect action
- **THEN** the workspace becomes usable again with capabilities from the new role, and no cached content, version or tab from the rejected session is carried into it

#### Scenario: Disconnect releases the workspace

- **WHEN** the user disconnects a workspace in the reconnect state
- **THEN** the session is disposed, tabs and workspace-scoped plugin state are cleared, and the shell returns to no workspace

### Requirement: No remote URL capabilities

The shell SHALL NOT expose a remote direct-file URL or a temporary media URL to
a plugin, the document renderer or a tab, and SHALL keep file bytes on the
requested path only.

#### Scenario: Only requested bytes cross

- **WHEN** a document or plugin needs file content from a remote workspace
- **THEN** it receives the bytes it requested through the workspace session and no link that would bypass the session's path and version checks

### Requirement: Empty remote files

The shell SHALL support zero-byte files in a remote workspace: creating an empty
file, reading an empty file, and replacing a non-empty file with empty content
SHALL each succeed through the normal upload and read paths. A successful write
SHALL return the new file metadata with a rotated version.

#### Scenario: New empty file is created

- **WHEN** the user creates a new file without content in a writable remote workspace
- **THEN** the zero-byte upload succeeds, the file exists with size 0, and the shell reports its new metadata and version

#### Scenario: Empty file reads as empty bytes

- **WHEN** the user opens a zero-byte remote file
- **THEN** the read succeeds with no bytes and no error, and the document is presented as an empty file

#### Scenario: Empty content replaces a non-empty file

- **WHEN** the user saves empty content over a file that had content
- **THEN** the remote file becomes zero bytes, the previous content is gone, and its version differs from the version before the write

#### Scenario: Empty write still honors the version check

- **WHEN** an empty write supplies an `ifVersion` that no longer matches the remote file
- **THEN** the write fails with `conflict`, the existing content is unchanged, and the tab stays dirty

### Requirement: Automatic connection persistence

The shell SHALL persist every successfully validated remote connection in the
`exo-remote` IndexedDB database before the workspace is mounted, keyed by
workspace identity. A token connection SHALL store its token with the record; a
public connection SHALL store no credential. If storage is unavailable, the
workspace SHALL still mount as session-only and report that it is not stored.

#### Scenario: Token connection is stored without an opt-in

- **WHEN** a server URL and token validate successfully
- **THEN** the shell stores the server, directory, name, role and token under the workspace identity before mounting the workspace

#### Scenario: Public connection stores no credential

- **WHEN** a public directory validates successfully
- **THEN** the stored record contains the server, directory, name and role but no token

#### Scenario: Storage failure does not block the workspace

- **WHEN** IndexedDB is unavailable or a write fails
- **THEN** the workspace mounts for the session, the shell reports that the connection is not stored, and no partial record is treated as restorable

### Requirement: Recent workspaces list

The shell SHALL keep remote connections in a newest-first recent list capped at
ten entries, SHALL update an existing entry rather than duplicate its workspace
identity, and SHALL expose only non-secret metadata to the UI. The connect UI
SHALL list the entries and allow each one to be opened or removed.

#### Scenario: A new connection becomes the most recent

- **WHEN** a validated connection is added while other recent entries exist
- **THEN** it appears first and the existing entries remain available

#### Scenario: Reopening the same workspace updates its entry

- **WHEN** the user connects or reconnects a workspace identity that is already in the list with a new token
- **THEN** the token and last-opened time are replaced on that entry and no duplicate is created

#### Scenario: The list is capped

- **WHEN** an eleventh distinct connection is stored
- **THEN** the oldest entry and its token are deleted and the list still contains ten entries

#### Scenario: The UI never receives a token

- **WHEN** the recent list is rendered or included in the workspace snapshot
- **THEN** it contains server, directory, name, role, identity and timestamp only, and the token appears in no DOM text, snapshot or plugin-visible state

#### Scenario: Removing one entry deletes only its credential

- **WHEN** the user removes one recent workspace
- **THEN** that record is deleted, the other entries are unchanged, and the workspace is released if it was active

### Requirement: Recent workspace restore

The shell SHALL restore the active remote workspace from the recent entry named
by the persisted active marker, SHALL revalidate a stored connection before
mounting it, and SHALL NOT mount a connection that the server rejects. Opening a
recent entry from the UI SHALL follow the same validation and reconnect rules as
a new connection.

#### Scenario: Active entry restores after reload

- **WHEN** the page reloads and the active marker names a recent entry whose credential is still valid
- **THEN** the shell revalidates that entry and restores the same workspace identity, directory and role

#### Scenario: Rejected recent entry does not mount

- **WHEN** the server rejects a stored credential
- **THEN** no workspace is mounted, the entry stays listed, and the shell presents the reconnect state without a silent retry

#### Scenario: Reconnect updates the stored credential

- **WHEN** the user supplies a new valid token for the same workspace identity from the reconnect state
- **THEN** the recent entry is updated and the workspace mounts with capabilities from the new role

#### Scenario: Opening a recent entry fails safely

- **WHEN** opening a recent entry fails validation or the entry no longer exists
- **THEN** the previously open workspace, its tabs and its unsaved documents are unchanged, and the failure is reported

### Requirement: Stored connection migration

The shell SHALL upgrade the existing single `last` connection record into the
recent list without dropping it, SHALL key the migrated record by its workspace
identity, and SHALL NOT persist a raw connection string.

#### Scenario: v1 record survives the upgrade

- **WHEN** a database containing one v1 `last` record is opened after the upgrade
- **THEN** that connection appears in the recent list under its workspace identity

#### Scenario: Raw connection string is never stored

- **WHEN** a connection was supplied as an `sfconn_v1_` value and is persisted
- **THEN** the stored record contains only the decomposed server, directory, name, role and token fields

#### Scenario: Disconnect retains the entry

- **WHEN** the user disconnects an active remote workspace without removing it from the recent list
- **THEN** the workspace is released and the stored connection remains available for reopening

#### Scenario: No workspace token in localStorage

- **WHEN** any connection is persisted
- **THEN** the record is written to IndexedDB and no token is written to `localStorage`
