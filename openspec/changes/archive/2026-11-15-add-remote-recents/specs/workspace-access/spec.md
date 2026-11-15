# Spec Delta

## MODIFIED Requirements

### Requirement: Persisted workspace restore

A persistent provider that relies on browser-granted permissions SHALL store its workspace identity in IndexedDB, SHALL query permission on restore, and SHALL keep the restored workspace read-only until the user grants write permission in a user gesture. A remote provider SHALL persist every validated connection and SHALL restore the active one from its recent-workspaces entry after reload.

#### Scenario: Silent restore with permission

- **WHEN** the page reloads and the stored handle still has read-write permission
- **THEN** the workspace restores with the same identity and writable capability without prompting

#### Scenario: Restore after permission loss

- **WHEN** the page reloads and permission must be requested again
- **THEN** the shell restores the workspace read-only, shows a restore-access action, and requests permission only from that action

#### Scenario: Directory handle cannot live in localStorage

- **WHEN** the shell persists workspace state
- **THEN** the directory handle is written to IndexedDB and `localStorage` holds only JSON-serializable data

#### Scenario: Remote active entry restores

- **WHEN** the page reloads and the active marker names a stored remote connection
- **THEN** the shell revalidates that recent entry and restores the workspace, or presents the reconnect state without mounting it
