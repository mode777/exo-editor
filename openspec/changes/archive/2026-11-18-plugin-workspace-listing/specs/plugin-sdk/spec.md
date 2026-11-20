# Spec Delta

## ADDED Requirements

### Requirement: Directory listing capability

The SDK SHALL include `workspace:list` in its permission union, SHALL expose `capabilities.directoryListing` as a boolean, SHALL parse an absent support bit as `false`, and SHALL NOT infer listing support from `workspace:read` or from the shell version.

#### Scenario: New shell advertises listing

- **WHEN** `shell/init` carries `capabilities.directoryListing: true`
- **THEN** the SDK exposes it to the plugin and allows `listDirectory()` after the permission check

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.directoryListing` field
- **THEN** the SDK exposes `false`, rejects `listDirectory()` locally with `unsupported-message` and sends no message

#### Scenario: Permission is separate

- **WHEN** the shell advertises listing but the manifest does not declare `workspace:list`
- **THEN** the SDK rejects `listDirectory()` locally with `permission-denied` and sends no message

#### Scenario: Permission union is explicit

- **WHEN** a plugin author writes a manifest permission list with `workspace:list`
- **THEN** the SDK's exported permission type accepts it and adds no inferred permission

### Requirement: Directory listing client

The SDK SHALL expose `EditorClient.listDirectory(path, options?)`, SHALL send one correlated `plugin/request-list` with the path and optional cursor, SHALL resolve with the page's entries and optional `nextCursor`, SHALL reject malformed replies with `protocol-violation`, and SHALL reject a pending listing with `closed` on disposal.

#### Scenario: First page

- **WHEN** the plugin calls `listDirectory('/assets')`
- **THEN** the SDK sends one `plugin/request-list` with a fresh id and resolves with the entries and optional `nextCursor` from the matching `shell/list-result`

#### Scenario: Next page

- **WHEN** the plugin passes the previous `nextCursor`
- **THEN** the SDK sends it unchanged and resolves the next page without exposing a cursor format

#### Scenario: Directory error

- **WHEN** the shell replies `not-a-directory`, `not-found`, `permission-denied`, `rate-limited` or `timeout` for a listing
- **THEN** the SDK rejects that call with the stable code and leaves other pending requests untouched

#### Scenario: Malformed page

- **WHEN** `shell/list-result` does not carry an entry array or carries an invalid entry shape
- **THEN** the SDK rejects the call with `protocol-violation` and exposes no partial entries

#### Scenario: Disposal

- **WHEN** the handler is disposed while a listing request is pending
- **THEN** the SDK rejects the pending call with `closed` and sends no further listing message

#### Scenario: Additive minor

- **WHEN** `listDirectory()` ships
- **THEN** the SDK takes an additive minor version, the protocol major remains `1`, and existing editor methods keep their behavior

#### Scenario: Exact-path fallback

- **WHEN** `listDirectory()` rejects locally with `unsupported-message` because the shell predates the message
- **THEN** the plugin keeps exact-path reads and, when the picker change is present, the user picker as its fallback
