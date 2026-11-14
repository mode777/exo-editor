# workspace-access Specification

## Purpose
Defines the single mediated path to the user's files: a provider interface, a
session that enforces paths, versions and reserved names, and a deterministic
teardown that makes workspace isolation possible.

## Requirements

### Requirement: Single mediated access path

All workspace file access SHALL go through a workspace session backed by a
provider that implements the workspace contract. No plugin, view, command or
document renderer SHALL receive a `FileSystemHandle`, a `File` or a `Blob` from
the shell, and no component other than the provider SHALL call a filesystem API
directly.

#### Scenario: Plugin receives bytes only

- **WHEN** a plugin requests a file
- **THEN** it receives a versioned text string or `ArrayBuffer` and never a handle, `File` or `Blob`

#### Scenario: One access path

- **WHEN** the explorer, a document renderer or a save operation needs file data
- **THEN** it calls the workspace session, and the folder provider is the only code holding a directory handle

### Requirement: Path normalization and containment

The session SHALL normalize every path before use as an absolute, `/`-rooted,
`/`-separated path, SHALL reject `..`, `.`, empty segments, `//`, trailing
slashes outside the root, backslashes, NUL, control characters and
over-length segments, and SHALL perform the containment and reserved-path checks
after resolution rather than before.

#### Scenario: Traversal is rejected

- **WHEN** a request resolves to a path outside the workspace root
- **THEN** the session rejects it with `permission-denied` and performs no filesystem operation

#### Scenario: Ambiguous separators are not guessed

- **WHEN** a path contains a backslash
- **THEN** the session rejects it instead of converting it to a separator

#### Scenario: Rejected path has one code

- **WHEN** a path fails normalization or containment
- **THEN** the caller receives `permission-denied` and no provider operation starts

#### Scenario: Case-insensitive reserved path

- **WHEN** the provider is case-insensitive and a plugin requests `EXO.JSON`
- **THEN** the request is treated as the reserved `/exo.json` and denied

### Requirement: Reserved paths

The session SHALL deny plugin-originated reads, writes, stats, listings and
moves that target `/exo.json` or any path under `/.exo/`, independently of
provider permissions, while allowing shell-originated access to those paths.

#### Scenario: Reserved write is denied

- **WHEN** a plugin save targets `/exo.json`
- **THEN** the session rejects it with `permission-denied`, the file is unchanged, and the failure is logged with the plugin id

#### Scenario: Reserved directory is hidden

- **WHEN** a plugin lists the workspace root
- **THEN** `/.exo` is not returned and `exo.json` is not offered as an openable document

### Requirement: Versioned writes

`stat` SHALL return an opaque `version` that changes when content changes, and a
write that supplies `ifVersion` SHALL fail with `conflict` when the current
version differs.

#### Scenario: Stale write does not overwrite

- **WHEN** a document was loaded at version V, another writer changes the file, and the document saves with `ifVersion: V`
- **THEN** the write fails with `conflict`, the newer content remains on disk, and the tab stays dirty

#### Scenario: Unchanged version writes

- **WHEN** a write supplies the current version
- **THEN** the write succeeds and returns a new stat with a new version

### Requirement: Deterministic teardown

The session SHALL expose `dispose()` that, in order, aborts in-flight operations
and stops watchers, tears down plugin handler sessions and then registrations,
unsubscribes event topics and resets their sequence numbers, clears caches, tabs
and workspace-scoped settings, releases the provider, and then prevents any late
callback from the disposed generation from mutating shell state.

#### Scenario: Switch mid-operation

- **WHEN** a workspace switch happens while a read or save is in flight
- **THEN** the operation rejects with `aborted`, the old provider is released and the new session starts with empty state

#### Scenario: Dispose is idempotent

- **WHEN** `dispose()` is called twice
- **THEN** the second call resolves without error and no callback runs twice

### Requirement: Provider capabilities and parity

Every provider SHALL declare `writable`, `watchable`, `persistent`, `caseSensitive`
and an optional maximum file size, and SHALL honor the same error codes and
`conflict` semantics. A provider that cannot honor a rule SHALL declare the
capability as unsupported rather than weaken the contract.

#### Scenario: Read-only provider

- **WHEN** a provider declares `writable: false`
- **THEN** the shell disables editing and save actions and the session rejects writes with `unsupported` without touching the backend

#### Scenario: Provider without watch support

- **WHEN** the folder provider declares `watchable: false`
- **THEN** the session re-stats open documents on focus and visibility change and the shell does not claim live watching

#### Scenario: Picker cancelled

- **WHEN** the user cancels the folder picker
- **THEN** the open operation rejects with `aborted`, no workspace is created and
  no error toast claims a failure

#### Scenario: Test parity

- **WHEN** the provider conformance suite runs
- **THEN** the same path, error, conflict and teardown cases pass against the memory provider and the folder provider

#### Scenario: Memory provider is deterministic

- **WHEN** the conformance suite runs the memory provider twice with the same operations and injected clock
- **THEN** it observes the same paths, versions, mtimes and watch callback order both times

### Requirement: Persisted workspace restore

A persistent provider SHALL store its workspace identity in IndexedDB, SHALL
query permission on restore, and SHALL keep the restored workspace read-only
until the user grants write permission in a user gesture.

#### Scenario: Silent restore with permission

- **WHEN** the page reloads and the stored handle still has read-write permission
- **THEN** the workspace restores with the same identity and writable capability without prompting

#### Scenario: Restore after permission loss

- **WHEN** the page reloads and permission must be requested again
- **THEN** the shell restores the workspace read-only, shows a restore-access action, and requests permission only from that action

#### Scenario: Directory handle cannot live in localStorage

- **WHEN** the shell persists workspace state
- **THEN** the directory handle is written to IndexedDB and `localStorage` holds only JSON-serializable data

### Requirement: Workspace error taxonomy

The session SHALL surface failures as a `WorkspaceError` with a stable code from
`not-found`, `not-a-file`, `not-a-directory`, `already-exists`,
`permission-denied`, `conflict`, `quota-exceeded`, `unsupported`, `too-large`,
`aborted` and `io`, and SHALL never expose provider messages or stack traces to a
plugin.

#### Scenario: Missing path

- **WHEN** a read targets a missing file
- **THEN** the caller receives `not-found` with the requested path and the shell renders an actionable message

#### Scenario: Plugin-facing mapping

- **WHEN** a workspace failure reaches a plugin
- **THEN** it arrives as a protocol error code and contains no provider text, stack trace or path outside the requested scope

### Requirement: Unsupported browsers are explicit

When no provider can open a folder-backed workspace, the shell SHALL present an
explicit unsupported state and SHALL NOT degrade into a mock or partially
functional explorer.

#### Scenario: Firefox opens the shell

- **WHEN** a browser without the File System Access API loads the shell
- **THEN** the open-workspace action explains the limitation and the explorer shows no fabricated files

### Requirement: Caller-scoped session access

The session SHALL serve shell-originated calls directly and SHALL expose a `forPlugin(pluginId)` facade whose calls apply the same normalization, containment, reserved-path and version checks before any provider operation, attributing denials to that plugin id.

#### Scenario: Shell access to reserved paths

- **WHEN** shell code reads or writes `/exo.json`
- **THEN** the session forwards the request to the provider, while the same call through `forPlugin` fails with `permission-denied`

#### Scenario: Plugin traversal is rejected before the provider

- **WHEN** a plugin facade request contains `..`, a backslash or a resolved path outside the root
- **THEN** it fails with `permission-denied` and no provider method is called

#### Scenario: Plugin denial is attributed

- **WHEN** a plugin facade targets `/.exo/state.json`
- **THEN** the failure is logged with that plugin id and no bytes, stat or listing entry are returned

#### Scenario: The facade cannot widen access

- **WHEN** a plugin facade asks for a path the provider would accept but the session resolves outside the workspace root
- **THEN** the session rejects it instead of relying on the provider

### Requirement: External-change refresh

The session SHALL accept the open documents and their loaded versions, SHALL re-stat them on window focus and `visibilitychange` when the provider declares `watchable: false`, and SHALL emit a change only for paths whose version, kind or existence differs, after checking that the owning generation is still current.

#### Scenario: External write is detected

- **WHEN** another program changes an open file and the window regains focus
- **THEN** the session emits `changed` with the new stat for that path

#### Scenario: Deletion is detected

- **WHEN** an open file is removed outside the shell and the window regains focus
- **THEN** the session emits `deleted` for that path

#### Scenario: Unchanged documents stay quiet

- **WHEN** focus occurs and no registered open document has changed
- **THEN** no change callback runs

#### Scenario: Late refresh is dropped

- **WHEN** a refresh resolves after `dispose()`
- **THEN** no callback runs and no shell state changes

### Requirement: Explicit permission escalation

The session SHALL expose a permission-request operation that delegates to the provider only from a user gesture, returns the updated capabilities, and rejects with `unsupported` when the provider cannot escalate permission.

#### Scenario: Restored workspace becomes writable

- **WHEN** a read-only restored workspace calls permission escalation and the user grants write access
- **THEN** the session reports writable capabilities and mutation actions become available

#### Scenario: Denial keeps the workspace read-only

- **WHEN** the user denies the permission request
- **THEN** the session stays read-only and no operation fails silently

#### Scenario: Provider without escalation

- **WHEN** the provider has no permission-request operation
- **THEN** the session rejects with `unsupported` instead of pretending the grant succeeded
