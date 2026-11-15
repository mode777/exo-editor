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

### Requirement: Explicit credential persistence opt-in

Remote connections SHALL be session-only by default. The shell SHALL persist a
connection only after an explicit opt-in, SHALL offer a way to forget it, and
SHALL NOT store any credential for a connection the user did not ask to remember.
A remembered connection SHALL be stored as its server, directory, display name,
role and token fields; the raw connection string SHALL NOT be persisted.

#### Scenario: Session-only connection is not stored

- **WHEN** a connection is made without the remember opt-in and the page reloads
- **THEN** no workspace is restored and no credential remains in local storage

#### Scenario: Remembered connection restores after reload

- **WHEN** a connection was remembered and the credential is still valid
- **THEN** the shell restores the same workspace identity, directory and role after reload without asking for the credential again

#### Scenario: Remembered connection string stores only its fields

- **WHEN** the user remembers a connection that was supplied as a connection string
- **THEN** the stored record contains the server, directory, display name, role and token, and not the connection string

#### Scenario: Remembered connection is revalidated

- **WHEN** a remembered connection is restored and the remote server rejects the credential
- **THEN** the shell does not mount the workspace and presents the reconnect state instead of a silent retry

#### Scenario: Forget removes the stored credential

- **WHEN** the user forgets a remembered connection
- **THEN** the stored record is deleted, the workspace is released, and a later reload does not restore it

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
