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

When no provider can open a folder-backed workspace, the shell SHALL present an explicit unsupported state for folder workspaces, SHALL offer the remote-connect path when a remote provider is available, and SHALL NOT degrade into a mock or partially functional explorer.

#### Scenario: Firefox opens the shell

- **WHEN** a browser without the File System Access API loads the shell
- **THEN** the open-folder action explains the limitation, the remote-connect action is offered, and the explorer shows no fabricated files

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

### Requirement: Documented browser support matrix

The project SHALL publish and maintain a browser support matrix that classifies
each browser and provider combination as supported, unsupported or unverified,
with verification evidence, and the shell's runtime unsupported states SHALL
match it. A change that adds or verifies a browser or provider combination SHALL
update the matrix.

#### Scenario: Matrix classifies every combination

- **WHEN** `docs/browser-support.md` is inspected
- **THEN** it classifies Chromium desktop folder workspaces as supported,
  Firefox and Safari folder workspaces as unsupported with an explicit runtime
  state, remote workspaces per the verified evidence, and mobile browsers as out
  of scope for v1

#### Scenario: Runtime matches the matrix

- **WHEN** a browser without a directory picker opens the deployed shell
- **THEN** the unsupported state matches the matrix entry, offers the remote
  connect path when the matrix marks remote workspaces supported there, and does
  not fabricate a folder workspace

#### Scenario: Evidence is cited

- **WHEN** a matrix entry is read
- **THEN** it names the browser version, date and verification evidence, or is
  labelled unverified instead of claiming support

#### Scenario: Unverified is not support

- **WHEN** a browser and provider combination has no verification evidence
- **THEN** the matrix labels it unverified and the documentation does not claim
  that combination works

#### Scenario: Provider change updates the matrix

- **WHEN** a change adds a provider or verifies a new browser
- **THEN** the same change updates the matrix and the runtime states it affects

### Requirement: Create-only writes

The session SHALL accept a `createOnly` write option and SHALL pass it to the provider. A create-only write SHALL fail with `already-exists` when the target exists at the time of the provider's check, SHALL NOT truncate or overwrite that target, and SHALL create parent directories only when `create` is also requested.

#### Scenario: Create a new file

- **WHEN** a create-only write targets a path that does not exist and its parent exists
- **THEN** the provider creates the file, writes the bytes and returns a new stat with a new version

#### Scenario: Existing target

- **WHEN** a create-only write targets an existing file
- **THEN** the write fails with `already-exists`, the existing bytes are unchanged and no truncation occurs

#### Scenario: Directory target

- **WHEN** a create-only write targets an existing directory
- **THEN** the write fails with `not-a-file` and writes nothing

#### Scenario: Parent creation

- **WHEN** a create-only write also requests `create` and the parent directory is missing
- **THEN** the provider creates the parent directories and the file

#### Scenario: No partial file on failure

- **WHEN** a create-only write fails after opening a handle or starting a remote request
- **THEN** no empty or partial file is visible and the existing state is unchanged

#### Scenario: Normal writes are unchanged

- **WHEN** a write omits `createOnly`
- **THEN** it keeps the existing create, overwrite and `ifVersion` behavior

### Requirement: Create-only provider parity

The memory provider SHALL use an atomic conditional create. The local folder and
Stratofold providers SHALL use their best available check and SHALL document the
residual check-to-write race; the shell SHALL NOT claim an atomic guarantee the
provider cannot enforce. A create-only write SHALL never truncate a target that
existed at check time.

#### Scenario: Atomic create

- **WHEN** the memory provider performs a create-only write and another writer creates the target between operations
- **THEN** the create fails with `already-exists` and leaves that writer's content intact

#### Scenario: Folder residual race

- **WHEN** the local folder provider cannot use an atomic create primitive and an external writer creates the target between its check and its write
- **THEN** the provider documents the residual race in its provider note and the shell does not claim an atomic guarantee it cannot enforce

#### Scenario: Stratofold residual race

- **WHEN** the Stratofold provider cannot express a target-absent conditional upload
- **THEN** it pre-checks, reports `already-exists` for a target observed at check time, documents the residual race, and never treats `If-Match: "*"` as create-only

#### Scenario: Remote provider parity

- **WHEN** the conformance suite runs the create-only cases against the memory, folder and Stratofold providers
- **THEN** all three return the same paths and error codes, and the existing content is unchanged when the target exists

#### Scenario: Remote conditional upload

- **WHEN** the Stratofold provider performs an update with a known version
- **THEN** it uses its conditional upload rather than an unconditional overwrite
