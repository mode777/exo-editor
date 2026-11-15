# Spec Delta

## ADDED Requirements

### Requirement: Provider selection and workspace identity

The shell SHALL support more than one provider kind at runtime, SHALL open
exactly one workspace at a time, and SHALL identify the active workspace by its
provider kind plus its workspace identity.

#### Scenario: Local and remote are alternatives

- **WHEN** a local folder workspace is open and the user connects a remote workspace
- **THEN** the folder session is disposed and the remote workspace replaces it, with no tabs or plugin state carried across

#### Scenario: Restore uses the provider kind that stored the workspace

- **WHEN** the shell restarts with a stored workspace record
- **THEN** it restores that workspace with the matching provider kind, and a provider that cannot restore reports no workspace rather than mounting another provider's record

#### Scenario: Folder support does not gate remote workspaces

- **WHEN** the browser cannot open a local folder but a remote connection is available and valid
- **THEN** the remote workspace opens normally and only the folder-backed path is reported as unsupported

## MODIFIED Requirements

### Requirement: Persisted workspace restore

A persistent provider that relies on browser-granted permissions SHALL store its workspace identity in IndexedDB, SHALL query permission on restore, and SHALL keep the restored workspace read-only until the user grants write permission in a user gesture. A remote provider SHALL restore only a connection the user explicitly asked to remember.

#### Scenario: Silent restore with permission

- **WHEN** the page reloads and the stored handle still has read-write permission
- **THEN** the workspace restores with the same identity and writable capability without prompting

#### Scenario: Restore after permission loss

- **WHEN** the page reloads and permission must be requested again
- **THEN** the shell restores the workspace read-only, shows a restore-access action, and requests permission only from that action

#### Scenario: Directory handle cannot live in localStorage

- **WHEN** the shell persists workspace state
- **THEN** the directory handle is written to IndexedDB and `localStorage` holds only JSON-serializable data

### Requirement: Unsupported browsers are explicit

When no provider can open a folder-backed workspace, the shell SHALL present an explicit unsupported state for folder workspaces, SHALL offer the remote-connect path when a remote provider is available, and SHALL NOT degrade into a mock or partially functional explorer.

#### Scenario: Firefox opens the shell

- **WHEN** a browser without the File System Access API loads the shell
- **THEN** the open-folder action explains the limitation, the remote-connect action is offered, and the explorer shows no fabricated files
