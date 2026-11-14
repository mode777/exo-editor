# Spec Delta

## ADDED Requirements

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
