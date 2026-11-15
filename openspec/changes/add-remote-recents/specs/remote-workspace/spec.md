# Spec Delta

## REMOVED Requirements

### Requirement: Explicit credential persistence opt-in

**Reason**: Connections are now persisted automatically so that every opened
remote workspace can appear in the recent list and be reopened without retyping
the token. Keeping a session-only default and a per-connection opt-in would make
the recent list incomplete by design.

**Migration**: Every successfully validated connection is written to the recent
list, including its token, and the connect UI states that the token is kept in
this browser. A user removes a credential by removing its recent entry. Existing
v1 `last` records are migrated into the list, so a connection remembered before
this change remains available.

## ADDED Requirements

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
