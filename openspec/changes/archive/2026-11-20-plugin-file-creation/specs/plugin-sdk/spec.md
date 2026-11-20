# Spec Delta

## ADDED Requirements

### Requirement: New-file client

`EditorClient` and `ViewClient` SHALL expose `requestNewFile({ text | bytes, suggestedName?, directory? })`, SHALL send one correlated `plugin/request-new-file`, SHALL preflight the support bit, `workspace:write` and the 8 MiB size, and SHALL resolve `{ path, version }` or `null` for a user cancellation.

#### Scenario: Text request

- **WHEN** the plugin calls `requestNewFile({ text: 'hello', suggestedName: 'notes.md' })`
- **THEN** the SDK sends one `plugin/request-new-file` with a fresh id and resolves with the path and version from `shell/new-file-result`

#### Scenario: Bytes request

- **WHEN** the plugin calls `requestNewFile({ bytes })`
- **THEN** the SDK sends the bytes unchanged and resolves with the created path and version

#### Scenario: Cancel is not an error

- **WHEN** the shell replies `{ cancelled: true }`
- **THEN** the SDK resolves `null` and does not reject

#### Scenario: Oversized content

- **WHEN** the text or bytes exceed 8 MiB
- **THEN** the SDK rejects locally with `too-large` and a message naming the actual size and the limit, and sends no message

#### Scenario: Older shell

- **WHEN** `capabilities.createFile` is false or absent
- **THEN** the SDK rejects with `unsupported-message` and sends no message

#### Scenario: Missing write permission

- **WHEN** the manifest lacks `workspace:write`
- **THEN** the SDK rejects with `permission-denied` and sends no message

#### Scenario: Collision

- **WHEN** the shell replies `already-exists`
- **THEN** the SDK rejects with that code and message and the plugin can offer another name

#### Scenario: Disposal

- **WHEN** the frame is disposed while the request is pending
- **THEN** the SDK rejects with `closed` and sends no further create request

#### Scenario: Additive minor

- **WHEN** `requestNewFile()` ships
- **THEN** the SDK takes an additive minor version `1.7.0`, the protocol major remains `1`, and existing methods keep their behavior

### Requirement: New-file registration

`RegistrationClient` SHALL let a controller register declared new-file template ids, SHALL send them in `plugin/register`, and SHALL expose accepted templates and per-kind rejection reasons from `shell/register-ack`.

#### Scenario: Register a template

- **WHEN** a controller registers a declared template id and completes
- **THEN** the SDK sends the id and the acknowledgement exposes the accepted template

#### Scenario: Undeclared template

- **WHEN** the shell rejects a template id with `not-declared`
- **THEN** the SDK exposes the kind, index, reason and optional message without discarding accepted contributions

#### Scenario: Registration only in register mode

- **WHEN** an editor or view client is asked to register a template
- **THEN** the SDK rejects the call locally and sends no registration message

#### Scenario: Additive acknowledgement

- **WHEN** `shell/register-ack` carries accepted globs, panels, content views and new-file templates
- **THEN** the SDK preserves each list and does not reinterpret one as another

### Requirement: New-file capability

The SDK SHALL expose `capabilities.createFile` on editor and view initializations and `capabilities.newFiles` on registration initializations, SHALL parse an absent bit as `false`, and SHALL NOT infer support from `workspace:write`, the shell version or another capability.

#### Scenario: Editor and view creation support

- **WHEN** an editor or view frame receives `capabilities.createFile: true`
- **THEN** `requestNewFile()` is available after the permission check

#### Scenario: Registration support

- **WHEN** a registration frame receives `capabilities.newFiles: true`
- **THEN** `registerNewFile()` is available and sends a registration message

#### Scenario: Older shell omits support

- **WHEN** a support bit is absent
- **THEN** the SDK exposes `false` and rejects the corresponding helper locally with `unsupported-message`

#### Scenario: Support is not permission

- **WHEN** `capabilities.createFile` is true but the manifest lacks `workspace:write`
- **THEN** `requestNewFile()` rejects locally with `permission-denied` and sends no message
