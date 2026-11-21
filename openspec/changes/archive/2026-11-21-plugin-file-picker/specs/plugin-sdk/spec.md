# Spec Delta

## ADDED Requirements

### Requirement: File picker client

The SDK SHALL expose `EditorClient.requestFiles(options?)`, SHALL send one correlated `plugin/request-files` only when `capabilities.filePicker` and `capabilities.requestFiles` are true, SHALL resolve with the selected paths as a `string[]`, SHALL allow at most one pending picker request per client, and SHALL treat an absent `filePicker` bit as unsupported.

#### Scenario: Request round trip

- **WHEN** the plugin calls `requestFiles({ multiple: true })` and the shell accepts it
- **THEN** the SDK sends one `plugin/request-files` with a fresh id and resolves the call with the `string[]` from the matching `shell/files-selected`

#### Scenario: User cancels

- **WHEN** the shell replies with an empty `paths` array
- **THEN** the SDK resolves the call with `[]` and does not treat it as an error

#### Scenario: Older shell omits support

- **WHEN** `shell/init` has no `capabilities.filePicker` field
- **THEN** the SDK parses it as `false`, rejects `requestFiles()` locally with `unsupported-message`, and sends no message

#### Scenario: Missing read permission

- **WHEN** `capabilities.requestFiles` is `false`
- **THEN** the SDK rejects `requestFiles()` locally with `permission-denied` and sends no message

#### Scenario: One pending picker

- **WHEN** the plugin calls `requestFiles()` while a previous picker request is still pending in the same client
- **THEN** the second call rejects locally with `rate-limited` and sends no second message

#### Scenario: Shell error is correlated

- **WHEN** the shell replies `shell/error` with `replyTo` equal to the picker request id
- **THEN** the SDK rejects that call with the shell's stable code and leaves other pending requests untouched

#### Scenario: Malformed selection reply

- **WHEN** `shell/files-selected` does not carry an array of strings in `paths`
- **THEN** the SDK rejects the picker request with `protocol-violation` and does not expose the payload

#### Scenario: Disposal while the picker is pending

- **WHEN** the handler is disposed while a picker request is pending
- **THEN** the SDK rejects the pending call with `closed` and sends no further picker message

#### Scenario: Additive minor release

- **WHEN** the helper ships
- **THEN** the SDK version is `1.2.0`, the protocol major remains `1`, and existing editor methods keep their behavior
