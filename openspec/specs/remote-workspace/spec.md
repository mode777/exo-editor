# remote-workspace Specification

## Purpose

Lets the shell open a remote workspace directly from the browser with a
user-supplied credential, without a backend, without sync, and without exposing
the credential to a plugin.

## Requirements

### Requirement: Connection entry and validation

The shell SHALL accept a remote workspace connection as a server URL plus either
a bearer token or, for a public directory, a directory identifier with no
credential. It SHALL validate the connection against the remote server before any
workspace is mounted, and SHALL mount either a fully configured workspace or
none.

#### Scenario: Editor token connects writable

- **WHEN** the user connects a server URL with a valid editor-role token
- **THEN** the shell resolves the directory name and role, mounts the workspace as writable, and shows it as the active workspace

#### Scenario: Public directory connects read-only

- **WHEN** the user connects a public directory without a token
- **THEN** the workspace mounts read-only and no credential is created, stored or sent

#### Scenario: Validation failure leaves the current workspace intact

- **WHEN** validation fails for an unreachable server, a wrong token or a token bound to another directory
- **THEN** the connect flow reports the specific failure and the previously open workspace, its tabs and its unsaved documents are unchanged

#### Scenario: No partial workspace

- **WHEN** validation has not completed
- **THEN** no explorer contents, document tab or plugin registration exists for the pending connection

### Requirement: Shell-owned credential

The shell SHALL keep a remote credential inside the shell only, SHALL send it
only in an authorization request header, and SHALL never place it in a URL, a
query string, the application bundle, the workspace log, or any message to a
plugin frame.

#### Scenario: Credential never reaches a plugin

- **WHEN** a plugin requests a file from a remote workspace
- **THEN** the request crosses the shell boundary as bytes and a version, and the credential never appears in the message or in the plugin's reachable state

#### Scenario: Credential never appears in a URL

- **WHEN** the shell reads, lists, stats, writes or moves a remote path
- **THEN** the network request carries the credential in a header, and the URL contains only the server, directory and path

#### Scenario: Credential is not logged

- **WHEN** a remote operation fails and the shell records a workspace log entry or an error state
- **THEN** the entry contains the operation, path and error code only, and never the credential or a token hint

### Requirement: Explicit credential persistence opt-in

Remote connections SHALL be session-only by default. The shell SHALL persist a
connection only after an explicit opt-in, SHALL offer a way to forget it, and
SHALL NOT store any credential for a connection the user did not ask to remember.

#### Scenario: Session-only connection is not stored

- **WHEN** a connection is made without the remember opt-in and the page reloads
- **THEN** no workspace is restored and no credential remains in local storage

#### Scenario: Remembered connection restores after reload

- **WHEN** a connection was remembered and the credential is still valid
- **THEN** the shell restores the same workspace identity, directory and role after reload without asking for the credential again

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
